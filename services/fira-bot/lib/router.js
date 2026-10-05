import { sendMessage, editMessageText, answerCallback, keyboard } from './tg.js'
import { esc, ref, byRef, ticketCard, ticketLine, shortId } from './view.js'
import { startCompose, offerTicket, onText, onButton } from './compose.js'
import * as chat from './chat.js'
import * as db from './data.js'

/**
 * One update in, one reply out.
 *
 * Nothing here decides what a person is allowed to do: every read and write goes
 * out under that user's own token, so the database answers it. The bot only has
 * to know *who* is talking, which is why an unlinked chat gets nothing but the
 * pairing instructions.
 *
 * Every send is returned, never `void`-ed. Under the polling loop a dropped
 * promise still settled, because the process stayed alive; as a webhook
 * (api/telegram.js) the platform freezes the function the moment the response is
 * written, so anything not awaited is simply never sent and the person gets
 * silence. Keep returning the promise.
 */

const COMPOSE_BUTTONS = new Set(['cp', 'pri', 'skip', 'go', 'x', 'offer'])
const AI_BUTTONS = new Set(['ai_go', 'ai_fix', 'ai_x'])

/**
 * The help text depends on whether an AI key is configured: with one, talking
 * normally is the main path and /yeni is the fallback; without one, only the
 * step-by-step flow exists and promising a conversation would be a lie.
 */
const helpText = () => [
  '<b>Fira botu</b>',
  '',
  ...(chat.aiEnabled()
    ? [
      'Derdini normal yazarak anlat — birkaç mesaj sürebilir. Gerekirse soru sorarım,',
      'sonunda görev kartını önerip onayını isterim.',
      '',
      '/ozet — konuşmayı şimdi görev kartına çevir',
    ]
    : ['Düz mesaj yazarsan bunu görev yapmak isteyip istemediğini sorarım.']),
  '/yeni — adım adım görev aç (yapay zekâsız)',
  '/yeni Yazıcı bozuk — başlığı hemen vererek aç',
  '/hedef — görevlerin açılacağı proje ve sütun',
  '/bana — bana atanmış açık görevler',
  '/bugun — bugünün ve geciken işlerim',
  '/gorev 118F5C — görev kartı (karttaki kısa kimlik)',
  '/iptal — konuşmayı ve taslağı sıfırla',
].join('\n')

const LINK_HINT = 'Önce Fira hesabınla eşleşmen gerekiyor: Fira → Ayarlar → Bildirimler → Telegram, oradaki kodu <code>/start KOD</code> şeklinde gönder.'

// ── Mesajlar ────────────────────────────────────────────────────────────────

export async function handleMessage(msg) {
  const chatId = msg.chat?.id
  const text = (msg.text ?? '').trim()
  if (!chatId || !text) return

  // Groups would blur whose account a ticket belongs to; keep it one-to-one.
  if (msg.chat.type !== 'private') {
    return sendMessage(chatId, 'Beni özel sohbette kullan: görevler kişisel hesabına yazılıyor.')
  }

  const isCommand = text.startsWith('/')
  const [rawCommand, ...args] = text.split(/\s+/)
  const command = isCommand ? rawCommand.toLowerCase().replace(/@.*$/, '') : ''
  const rest = text.slice(rawCommand.length).trim()

  if (command === '/start') {
    if (args[0]) {
      const linked = await db.consumeLinkCode(chatId, args[0], msg.from)
      return sendMessage(chatId, linked
        ? `✅ Bağlandık: <b>${esc(linked.name)}</b>\n\nArtık buradan görev açabilirsin.\n\n${helpText()}`
        : '❌ Kod geçersiz ya da süresi dolmuş. Fira’dan yeni bir kod al.')
    }
    const account = await db.accountForChat(chatId)
    return sendMessage(chatId, account
      ? `Zaten bağlısın.\n\n${helpText()}`
      : `Merhaba! ${LINK_HINT}`)
  }

  if (command === '/yardim' || command === '/help') return sendMessage(chatId, helpText())

  const account = await db.accountForChat(chatId)
  if (!account) return sendMessage(chatId, LINK_HINT)
  // Writing again means the bot is unblocked; let notifications resume.
  if (account.blocked_at) await db.unblock(account.user_id)

  if (command === '/iptal') {
    await db.clearDraft(chatId)
    await chat.reset(chatId)
    return sendMessage(chatId, 'Temizlendi. Yeni bir konuşma başlatabilirsin.')
  }

  if (command === '/ozet' || command === '/özet') {
    if (!chat.aiEnabled()) return sendMessage(chatId, 'Yapay zekâ kapalı (anahtar tanımlı değil). Adım adım açmak için /yeni.')
    return chat.summarize(chatId, account)
  }

  if (command === '/hedef') {
    const target = await db.resolveTarget(account.user_id, account)
    const projects = await db.listProjects(account.user_id)
    if (!projects?.length) return sendMessage(chatId, 'Hiç projen yok görünüyor.')
    const head = target.project
      ? `Görevler şu an <b>${esc(target.project.name)}</b>${target.status ? ` → <b>${esc(target.status.name)}</b>` : ''} altına açılıyor.`
      : 'Hedef proje seçilmemiş.'
    const buttons = projects.map((p) => ({
      text: p.id === target.project?.id ? `✓ ${p.name}` : p.name,
      callback_data: `tp|${ref(p.id)}`,
    }))
    return sendMessage(chatId, `${head}\n\nProjeyi seç:`, {
      reply_markup: keyboard(buttons, projects.length > 6 ? 2 : 1),
    })
  }

  if (command === '/yeni' || command === '/new') {
    return startCompose(chatId, account, rest)
  }

  if (command === '/proje') {
    const projects = await db.listProjects(account.user_id)
    if (!projects?.length) return sendMessage(chatId, 'Hiç projen yok görünüyor.')
    const current = account.default_project_id
      ? await db.projectName(account.user_id, account.default_project_id)
      : null
    const buttons = projects.map((p) => ({
      text: p.id === account.default_project_id ? `✓ ${p.name}` : p.name,
      callback_data: `dp|${ref(p.id)}`,
    }))
    const head = current ? `Varsayılan proje: <b>${esc(current)}</b>` : 'Varsayılan proje seçilmemiş.'
    return sendMessage(chatId, `${head}\n\nYeni görevler hangi projeye açılsın?`, {
      reply_markup: keyboard(buttons, projects.length > 6 ? 2 : 1),
    })
  }

  if (command === '/bana' || command === '/bugun') {
    const dueToday = command === '/bugun'
    const tickets = await db.myTickets(account.user_id, { dueToday })
    if (!tickets?.length) {
      return sendMessage(chatId, dueToday ? '🎉 Bugün için bekleyen işin yok.' : 'Sana atanmış açık görev yok.')
    }
    const header = dueToday ? '<b>Bugün ve gecikenler</b>' : '<b>Sana atanmış açık görevler</b>'
    const lines = tickets.slice(0, 25).map(ticketLine)
    const more = tickets.length > 25 ? `\n\n…ve ${tickets.length - 25} görev daha.` : ''
    return sendMessage(chatId, `${header}\n\n${lines.join('\n')}${more}`)
  }

  if (command === '/gorev') {
    if (!args[0]) return sendMessage(chatId, 'Kullanım: <code>/gorev 118F5C</code>')
    const ticket = await db.ticketByShort(account.user_id, args[0])
    if (!ticket) return sendMessage(chatId, 'Bu kimlikle görebildiğin bir görev bulamadım.')
    return sendMessage(chatId, ticketCard(ticket), {
      reply_markup: await statusMarkup(account.user_id, ticket),
    })
  }

  if (isCommand) return sendMessage(chatId, `Bu komutu bilmiyorum.\n\n${helpText()}`)

  // Plain text. An open step-by-step draft wins — the user is mid-answer there.
  // Otherwise the AI conversation takes it, and without a key we fall back to
  // the old "shall I make this a ticket?" offer.
  const draft = await db.getDraft(chatId)
  if (draft && (await onText(chatId, draft, text)) !== false) return
  if (chat.aiEnabled()) return chat.onText(chatId, account, text)
  return offerTicket(chatId, account, text)
}

// ── Düğmeler ────────────────────────────────────────────────────────────────

async function statusMarkup(userId, ticket) {
  const columns = await db.statuses(userId, ticket.project_id)
  const buttons = (columns ?? [])
    .filter((s) => s.id !== ticket.status_info?.id)
    .map((s) => ({ text: s.name, callback_data: `st|${ref(ticket.id)}|${ref(s.id)}` }))
  return buttons.length ? keyboard(buttons, 2) : undefined
}

export async function handleCallback(query) {
  const chatId = query.message?.chat?.id
  const messageId = query.message?.message_id
  const [kind, a, b] = (query.data ?? '').split('|')

  const account = chatId ? await db.accountForChat(chatId) : null
  if (!account) return answerCallback(query.id, 'Önce Fira hesabınla eşleşmelisin.', true)

  if (COMPOSE_BUTTONS.has(kind)) {
    const toast = await onButton(chatId, account, messageId, kind, a)
    return answerCallback(query.id, toast ?? '')
  }

  if (AI_BUTTONS.has(kind)) {
    const toast = await chat.onButton(chatId, account, messageId, kind)
    return answerCallback(query.id, toast ?? '')
  }

  // /hedef: proje seçildi → o projenin sütunlarını sor.
  if (kind === 'tp') {
    const projects = await db.listProjects(account.user_id)
    const project = byRef(projects, a)
    if (!project) return answerCallback(query.id, 'Proje bulunamadı.', true)
    const columns = await db.statuses(account.user_id, project.id)
    if (!columns?.length) return answerCallback(query.id, 'Bu projede sütun yok.', true)
    await db.setTarget(account.user_id, project.id, null)
    await editMessageText(chatId, messageId, `📁 <b>${esc(project.name)}</b>

Hangi sütuna açılsın?`, {
      reply_markup: keyboard(columns.map((c) => ({ text: c.name, callback_data: `ts|${ref(c.id)}` })), 2),
    })
    return answerCallback(query.id, project.name)
  }

  if (kind === 'ts') {
    const projectId = (await db.accountForChat(chatId))?.default_project_id
    const columns = projectId ? await db.statuses(account.user_id, projectId) : []
    const status = byRef(columns, a)
    if (!status) return answerCallback(query.id, 'Sütun bulunamadı.', true)
    await db.setTarget(account.user_id, projectId, status.id)
    const name = await db.projectName(account.user_id, projectId)
    await editMessageText(chatId, messageId, `🎯 Hedef: <b>${esc(name ?? '')}</b> → <b>${esc(status.name)}</b>

Bundan sonra görevler buraya açılacak.`)
    return answerCallback(query.id, status.name)
  }

  if (kind === 'dp') {
    const projects = await db.listProjects(account.user_id)
    const project = byRef(projects, a)
    if (!project) return answerCallback(query.id, 'Proje bulunamadı.', true)
    await db.setDefaultProject(account.user_id, project.id)
    await editMessageText(chatId, messageId, `📁 Varsayılan proje: <b>${esc(project.name)}</b>\n\nArtık /yeni doğrudan başlığı sorar.`)
    return answerCallback(query.id, project.name)
  }

  if (kind === 'as') {
    const ticket = await db.ticketByShort(account.user_id, a)
    if (!ticket) return answerCallback(query.id, 'Görev bulunamadı.', true)
    try {
      await db.assignSelf(account.user_id, ticket.id)
    } catch {
      return answerCallback(query.id, 'Atama yapılamadı (yetki?).', true)
    }
    const fresh = await db.ticketById(account.user_id, ticket.id)
    if (fresh) await editMessageText(chatId, messageId, ticketCard(fresh, { header: '✅ <b>Görev açıldı</b>' }), {
      reply_markup: await statusMarkup(account.user_id, fresh),
    })
    return answerCallback(query.id, 'Sana atandı')
  }

  if (kind === 'st') {
    const ticket = await db.ticketByShort(account.user_id, a)
    if (!ticket) return answerCallback(query.id, 'Görev bulunamadı.', true)
    const columns = await db.statuses(account.user_id, ticket.project_id)
    const status = byRef(columns, b)
    if (!status) return answerCallback(query.id, 'Durum bulunamadı.', true)

    let ok = false
    try {
      ok = await db.setStatus(account.user_id, ticket.id, status.id)
    } catch {
      ok = false
    }
    if (!ok) return answerCallback(query.id, 'Bu görevi değiştirme yetkin yok.', true)

    const fresh = await db.ticketById(account.user_id, ticket.id)
    await answerCallback(query.id, `Durum: ${status.name}`)
    if (fresh) {
      await editMessageText(chatId, messageId, ticketCard(fresh), {
        reply_markup: await statusMarkup(account.user_id, fresh),
      })
    }
    return
  }

  return answerCallback(query.id)
}

export { helpText, shortId }
