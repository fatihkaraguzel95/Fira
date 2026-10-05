import { sendMessage, editMessageText, keyboard } from './tg.js'
import { draftView, ref, byRef, esc, ticketCard, ticketUrl, PRIORITY_LABEL } from './view.js'
import * as db from './data.js'

/**
 * Opening a ticket from a phone, one question at a time.
 *
 * The conversation is a small state machine and its state lives in the database
 * (telegram_compose), not in memory: the service may restart between two of the
 * user's messages, and a half-written ticket should survive that.
 *
 * Steps: offer → project → title → description → priority → confirm
 *
 * "offer" is the entry point for a plain message. Someone typing "yazıcı yine
 * bozuk" into the chat almost certainly means it as a task, but guessing and
 * silently opening a ticket would be worse than asking once.
 */

const CANCEL_HINT = 'Vazgeçmek için /iptal'

/** Render the current step: edit the button's own message, or send a new one. */
async function render(chatId, draft, { messageId, prompt, markup } = {}) {
  const name = draft.project_id ? await db.projectName(draft.user_id, draft.project_id) : null
  const text = draftView(draft, name, prompt)
  const extra = markup ? { reply_markup: markup } : {}
  if (messageId) return editMessageText(chatId, messageId, text, extra)
  return sendMessage(chatId, text, extra)
}

// ── Adımlar ─────────────────────────────────────────────────────────────────

async function askProject(chatId, draft, messageId) {
  const projects = await db.listProjects(draft.user_id)
  if (!projects?.length) {
    await db.clearDraft(chatId)
    return sendMessage(chatId, 'Hiç projen yok görünüyor. Önce Fira’da bir projeye katıl.')
  }
  if (projects.length === 1) {
    // Tek proje varsa sormak gürültü: doğrudan başlığa geç.
    return askTitle(chatId, { ...draft, project_id: projects[0].id }, messageId)
  }
  await db.saveDraft(chatId, draft.user_id, { step: 'project' })
  const buttons = projects.map((p) => ({ text: p.name, callback_data: `cp|${ref(p.id)}` }))
  return render(chatId, { ...draft, step: 'project' }, {
    messageId,
    prompt: `Hangi proje? · ${CANCEL_HINT}`,
    markup: keyboard(buttons, projects.length > 6 ? 2 : 1),
  })
}

async function askTitle(chatId, draft, messageId) {
  await db.saveDraft(chatId, draft.user_id, { step: 'title', project_id: draft.project_id })
  return render(chatId, { ...draft, step: 'title' }, {
    messageId,
    prompt: `Görevin başlığını yaz. · ${CANCEL_HINT}`,
  })
}

async function askDescription(chatId, draft, messageId) {
  await db.saveDraft(chatId, draft.user_id, { step: 'description', title: draft.title })
  return render(chatId, { ...draft, step: 'description' }, {
    messageId,
    prompt: `Açıklama? İstersen atla. · ${CANCEL_HINT}`,
    markup: keyboard([{ text: '⏭ Açıklama yok', callback_data: 'skip' }], 1),
  })
}

async function askPriority(chatId, draft, messageId) {
  await db.saveDraft(chatId, draft.user_id, { step: 'priority', description: draft.description ?? null })
  const buttons = [
    { text: '🔴 Kritik', callback_data: 'pri|critical' },
    { text: '🔸 Yüksek', callback_data: 'pri|high' },
    { text: 'Orta', callback_data: 'pri|medium' },
    { text: '⬇️ Düşük', callback_data: 'pri|low' },
    { text: 'Öncelik yok', callback_data: 'pri|none' },
  ]
  return render(chatId, { ...draft, step: 'priority' }, {
    messageId,
    prompt: `Öncelik? · ${CANCEL_HINT}`,
    markup: keyboard(buttons, 2),
  })
}

async function askConfirm(chatId, draft, messageId) {
  await db.saveDraft(chatId, draft.user_id, { step: 'confirm', priority: draft.priority ?? null })
  return render(chatId, { ...draft, step: 'confirm' }, {
    messageId,
    prompt: 'Açayım mı?',
    markup: keyboard([
      { text: '✅ Görevi aç', callback_data: 'go' },
      { text: '✖️ İptal', callback_data: 'x' },
    ], 2),
  })
}

// ── Giriş noktaları ─────────────────────────────────────────────────────────

/** /yeni — anything typed after the command is taken as the title. */
export async function startCompose(chatId, account, titleFromArgs = '') {
  const draft = {
    user_id: account.user_id,
    project_id: account.default_project_id ?? null,
    title: titleFromArgs.trim() || null,
    description: null,
    priority: null,
  }
  await db.clearDraft(chatId)
  await db.saveDraft(chatId, account.user_id, { ...draft, step: 'project' })

  if (!draft.project_id) return askProject(chatId, draft)
  if (!draft.title) return askTitle(chatId, draft)
  return askDescription(chatId, draft)
}

/** A plain message with no draft open: offer to turn it into a ticket. */
export async function offerTicket(chatId, account, text) {
  const draft = {
    user_id: account.user_id,
    project_id: account.default_project_id ?? null,
    title: text.trim(),
    description: null,
    priority: null,
  }
  await db.saveDraft(chatId, account.user_id, { ...draft, step: 'offer' })
  return sendMessage(
    chatId,
    `Bunu görev olarak açayım mı?\n\n📝 <b>${esc(draft.title)}</b>`,
    {
      reply_markup: keyboard([
        { text: '➕ Görev aç', callback_data: 'offer' },
        { text: '✖️ Yok', callback_data: 'x' },
      ], 2),
    },
  )
}

/**
 * Text arrived while a draft is open. Returns false when the current step is not
 * waiting for text, so the router can fall back to its normal reply.
 */
export async function onText(chatId, draft, text) {
  if (draft.step === 'title') {
    return askDescription(chatId, { ...draft, title: text })
  }
  if (draft.step === 'description') {
    return askPriority(chatId, { ...draft, description: text })
  }
  return false
}

/** Button presses that belong to the compose flow. Returns a toast, or null. */
export async function onButton(chatId, account, messageId, kind, value) {
  const draft = await db.getDraft(chatId)
  if (!draft) return 'Taslak kalmadı, /yeni ile baştan başla.'

  if (kind === 'x') {
    await db.clearDraft(chatId)
    await editMessageText(chatId, messageId, '✖️ İptal edildi.')
    return 'İptal'
  }

  if (kind === 'offer') {
    if (!draft.project_id) await askProject(chatId, draft, messageId)
    else await askDescription(chatId, draft, messageId)
    return null
  }

  if (kind === 'cp') {
    const projects = await db.listProjects(draft.user_id)
    const project = byRef(projects, value)
    if (!project) return 'Proje bulunamadı.'
    const next = { ...draft, project_id: project.id }
    if (next.title) await askDescription(chatId, next, messageId)
    else await askTitle(chatId, next, messageId)
    return project.name
  }

  if (kind === 'skip') {
    await askPriority(chatId, { ...draft, description: null }, messageId)
    return null
  }

  if (kind === 'pri') {
    const priority = value === 'none' ? null : value
    await askConfirm(chatId, { ...draft, priority }, messageId)
    return priority ? PRIORITY_LABEL[priority] : 'Öncelik yok'
  }

  if (kind === 'go') {
    if (!draft.project_id || !draft.title) return 'Taslak eksik, /yeni ile baştan başla.'
    let ticket
    try {
      ticket = await db.createTicket(draft.user_id, draft)
    } catch (err) {
      // 403 / 42501 = RLS said no, e.g. a read-only member of that team.
      const denied = err.status === 403 || /42501|permission denied|violates row-level/i.test(err.body ?? '')
      await editMessageText(chatId, messageId, denied
        ? '⛔️ Bu projede görev açma yetkin yok.'
        : `⚠️ Görev açılamadı: ${esc(err.message)}`)
      await db.clearDraft(chatId)
      return denied ? 'Yetki yok' : 'Hata'
    }

    await db.clearDraft(chatId)
    await editMessageText(chatId, messageId, ticketCard(ticket, { header: '✅ <b>Görev açıldı</b>' }), {
      reply_markup: {
        inline_keyboard: [[
          { text: '👤 Bana ata', callback_data: `as|${ref(ticket.id)}` },
          { text: 'Fira’da aç', url: ticketUrl(ticket.id) },
        ]],
      },
    })

    // Varsayılan proje yoksa bir kez kur: sonraki görev tek soruya iner.
    if (!account.default_project_id) {
      await db.setDefaultProject(draft.user_id, draft.project_id)
      const name = await db.projectName(draft.user_id, draft.project_id)
      await sendMessage(chatId, `ℹ️ Bundan sonra görevler varsayılan olarak <b>${esc(name ?? '')}</b> projesine açılacak. Değiştirmek için /proje.`)
    }
    return 'Açıldı'
  }

  return null
}
