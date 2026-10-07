import { sendMessage, editMessageText, sendTyping, keyboard } from './tg.js'
import { esc, mdToHtml, ticketCard, ticketUrl, ref, PRIORITY_LABEL } from './view.js'
import { turn, aiEnabled, MAX_QUESTIONS } from './ai.js'
import * as db from './data.js'

/**
 * Free-form conversation → one confirmed ticket.
 *
 * The user just talks ("uygulama açılışta donuyor, dün de olmuştu"). Each message
 * goes to the model with the whole history; the model either asks one short
 * follow-up or proposes a finished ticket. The proposal arrives with buttons, so
 * nothing is written until a person approves it — and the write then runs under
 * that person's own token, through RLS.
 *
 * The flow has exactly one outcome: a ticket in the target list. Two things here
 * make sure the conversation actually gets there — the destination is resolved
 * before the model is called (so it is in the prompt, and a missing one is said
 * up front), and the spent questions are counted, so asking cannot go on
 * forever while no card ever arrives.
 *
 * The transcript lives in telegram_ai because the endpoint is stateless and the
 * service may restart between two messages.
 */

// Enough for a long bug report, short enough to keep each call cheap and quick.
const MAX_TURNS = 24

const PROPOSAL_BUTTONS = keyboard([
  { text: '✅ Görevi aç', callback_data: 'ai_go' },
  { text: '✏️ Düzelt', callback_data: 'ai_fix' },
  { text: '✖️ İptal', callback_data: 'ai_x' },
], 2)

const trimHistory = (messages) => messages.slice(-MAX_TURNS)

/**
 * How many follow-up questions have already been spent.
 *
 * Countable because the transcript only ever holds the two canonical shapes (see
 * ai.js → turn), so an assistant turn carrying "ask" was a question. When the
 * budget runs out the next turn is forced to produce the card — which is the
 * whole point of the conversation, and the thing that never arrived when the
 * model just kept asking.
 */
const questionsAsked = (messages) => messages
  .filter((m) => m.role === 'assistant' && /"ask"\s*:/.test(String(m.content ?? '')))
  .length

/** The card the user confirms: what will be written, and exactly where. */
function proposalView(proposal, target) {
  const lines = ['🤖 <b>Önerilen görev</b>', '']
  lines.push(`<b>${esc(proposal.title)}</b>`)

  const meta = [`🚩 ${PRIORITY_LABEL[proposal.priority] ?? proposal.priority}`]
  if (target?.project) {
    const team = target.project.team?.name ? `${esc(target.project.team.name)} / ` : ''
    meta.push(`📁 ${team}${esc(target.project.name)}${target.status ? ` → ${esc(target.status.name)}` : ''}`)
  }
  lines.push(meta.join(' · '))

  if (proposal.description) lines.push('', mdToHtml(proposal.description))
  return lines.join('\n')
}

/**
 * Push one turn through the model and answer in the chat.
 *
 * The target is resolved before the model is called: it goes into the prompt, so
 * the model is filling in a card for a real place instead of talking in the
 * abstract — and when there is no target we say so immediately rather than after
 * a conversation that could never have ended in a ticket.
 */
async function advance(chatId, account, messages, { force = false } = {}) {
  const target = await db.resolveTarget(account.user_id, account)
  if (!target.project) {
    await db.saveAiSession(chatId, account.user_id, { messages: trimHistory(messages), proposal: null })
    return sendMessage(chatId, 'Görevi nereye açacağımı bilmiyorum: ayarlı listeyi göremiyorum. /hedef ile listeyi seç, sonra tekrar yaz.')
  }

  await sendTyping(chatId)

  let result
  try {
    result = await turn(messages, {
      force,
      target,
      questionsLeft: Math.max(0, MAX_QUESTIONS - questionsAsked(messages)),
    })
  } catch (err) {
    console.error('[ai] tur başarısız:', err.message)
    await sendMessage(chatId, `⚠️ Yapay zekâ yanıt vermedi: ${esc(err.message)}\n\nDüğmeli akışı kullanabilirsin: /yeni`)
    return
  }

  // The canonical JSON goes into the transcript, never the model's raw text: a
  // history made of nothing but {"ask"} / {"ticket"} is what keeps the next turn
  // from sliding into free-form chat.
  const history = trimHistory([...messages, { role: 'assistant', content: result.assistant }])

  if (result.kind === 'question') {
    await db.saveAiSession(chatId, account.user_id, { messages: history, proposal: null })
    return sendMessage(chatId, esc(result.text))
  }

  await db.saveAiSession(chatId, account.user_id, { messages: history, proposal: result.proposal })
  return sendMessage(chatId, proposalView(result.proposal, target), { reply_markup: PROPOSAL_BUTTONS })
}

// ── Giriş noktaları ─────────────────────────────────────────────────────────

/** A plain message: start or continue the conversation. */
export async function onText(chatId, account, text) {
  const session = await db.getAiSession(chatId)
  const messages = trimHistory([...(session?.messages ?? []), { role: 'user', content: text }])
  await advance(chatId, account, messages)
}

/** /ozet — stop asking, propose now with whatever was said. */
export async function summarize(chatId, account) {
  const session = await db.getAiSession(chatId)
  if (!session?.messages?.length) {
    return sendMessage(chatId, 'Henüz bir konuşma yok. Derdini yaz, sonunda /ozet ile görev kartına çeviririm.')
  }
  await advance(chatId, account, session.messages, { force: true })
}

export async function reset(chatId) {
  await db.clearAiSession(chatId)
}

/** Buttons under a proposal. Returns the toast text for Telegram. */
export async function onButton(chatId, account, messageId, kind) {
  if (kind === 'ai_x') {
    await db.clearAiSession(chatId)
    await editMessageText(chatId, messageId, '✖️ İptal edildi.')
    return 'İptal'
  }

  const session = await db.getAiSession(chatId)
  const proposal = session?.proposal
  if (!proposal) return 'Öneri kalmadı, konuşmaya baştan başla.'

  if (kind === 'ai_fix') {
    await sendMessage(chatId, '✏️ Neyi değiştirelim? Yaz, düzeltip yeniden öneririm.\n<i>Örnek: "öncelik kritik olsun", "başlık: ödeme ekranı donuyor"</i>')
    return 'Düzeltmeyi yaz'
  }

  if (kind === 'ai_go') {
    const target = await db.resolveTarget(account.user_id, account)
    if (!target.project) return 'Hedef liste bulunamadı, /hedef ile seç.'

    let ticket
    try {
      ticket = await db.createTicket(account.user_id, {
        project_id: target.project.id,
        status_id: target.status?.id ?? null,
        title: proposal.title,
        description: proposal.description,
        priority: proposal.priority,
      })
    } catch (err) {
      const denied = err.status === 403 || /42501|permission denied|violates row-level/i.test(err.body ?? '')
      await editMessageText(chatId, messageId, denied
        ? '⛔️ Bu listede görev açma yetkin yok.'
        : `⚠️ Görev açılamadı: ${esc(err.message)}`)
      return denied ? 'Yetki yok' : 'Hata'
    }

    await db.clearAiSession(chatId)
    // Listeyi bir kere sabitle: sonraki görevler soru sormadan aynı yere gider.
    // Sütun saklanmıyor — her görev listenin standart sütununa açılıyor.
    if (!account.default_project_id) {
      await db.setDefaultProject(account.user_id, target.project.id)
    }

    await editMessageText(chatId, messageId, ticketCard(ticket, { header: '✅ <b>Görev açıldı</b>' }), {
      reply_markup: {
        inline_keyboard: [[
          { text: '👤 Bana ata', callback_data: `as|${ref(ticket.id)}` },
          { text: 'Fira’da aç', url: ticketUrl(ticket.id) },
        ]],
      },
    })
    return 'Açıldı'
  }

  return ''
}

export { aiEnabled }
