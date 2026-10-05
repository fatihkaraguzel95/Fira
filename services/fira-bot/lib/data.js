import { service, asUser } from './supa.js'
import { config } from './config.js'

/**
 * Every query the bot runs for a person goes through asUser(): RLS decides what
 * they may see and write. The service role appears only where a user genuinely
 * cannot act for themselves — chat → account lookup, link codes, draft state.
 */

const TICKET_CARD_SELECT = [
  'id', 'title', 'description', 'due_date', 'priority', 'project_id',
  'project:projects(name)',
  'status_info:ticket_statuses!tickets_status_id_fkey(id,name,category)',
  'assignees:ticket_assignees(user:profiles(full_name,email))',
].join(',')

const TICKET_LIST_SELECT = [
  'id', 'title', 'due_date', 'priority',
  'status_info:ticket_statuses!tickets_status_id_fkey!inner(name,category)',
  'assignees:ticket_assignees!inner(user_id)',
].join(',')

const OPEN = 'status_info.category=not.in.(done,closed)'
const localToday = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD

// ── Hesap eşlemesi ──────────────────────────────────────────────────────────

export async function accountForChat(chatId) {
  const rows = await service.select(
    `telegram_accounts?chat_id=eq.${chatId}&select=user_id,blocked_at,default_project_id`,
  )
  return rows?.[0] ?? null
}

export const unblock = (userId) =>
  service.update(`telegram_accounts?user_id=eq.${userId}`, { blocked_at: null })

/**
 * Consume a one-time code produced by Fira → Ayarlar → Bildirimler. Without a
 * valid code no chat can ever be attached to an account, which is the whole
 * point: the bot must never guess who it is talking to.
 */
export async function consumeLinkCode(chatId, rawCode, from) {
  const code = String(rawCode ?? '').trim().toUpperCase()
  if (!code) return null

  const rows = await service.select(
    `telegram_link_codes?code=eq.${encodeURIComponent(code)}&used_at=is.null` +
    `&expires_at=gt.${new Date().toISOString()}&select=code,user_id`,
  )
  const found = rows?.[0]
  if (!found) return null

  // One chat belongs to one account: re-linking replaces the previous owner.
  await service.remove(`telegram_accounts?chat_id=eq.${chatId}`)
  await service.upsert('telegram_accounts', {
    user_id: found.user_id,
    chat_id: chatId,
    username: from?.username ?? null,
    first_name: from?.first_name ?? null,
    linked_at: new Date().toISOString(),
    blocked_at: null,
  })
  await service.update(`telegram_link_codes?code=eq.${encodeURIComponent(code)}`, {
    used_at: new Date().toISOString(),
  })

  const profile = await service.select(`profiles?id=eq.${found.user_id}&select=full_name,email`)
  return {
    userId: found.user_id,
    name: profile?.[0]?.full_name || profile?.[0]?.email || 'Fira hesabın',
  }
}

// ── Projeler ────────────────────────────────────────────────────────────────

/** Projects this user may write to, newest teams and all — RLS does the filtering. */
export const listProjects = (userId) =>
  asUser(userId).select('projects?archived=eq.false&select=id,name&order=name.asc&limit=60')

export const projectName = async (userId, projectId) => {
  if (!projectId) return null
  const rows = await asUser(userId).select(`projects?id=eq.${projectId}&select=name`)
  return rows?.[0]?.name ?? null
}

export const setDefaultProject = (userId, projectId) =>
  service.update(`telegram_accounts?user_id=eq.${userId}`, { default_project_id: projectId })

export const setTarget = (userId, projectId, statusId) =>
  service.update(`telegram_accounts?user_id=eq.${userId}`, {
    default_project_id: projectId,
    default_status_id: statusId,
  })

/**
 * Where AI-made tickets land.
 *
 * A stored choice (set once via /hedef, or on the first created ticket) always
 * wins. Otherwise the configured names are matched against the projects this
 * user can actually see — so the target is discovered rather than hardcoded as
 * an id that would differ per environment.
 */
export async function resolveTarget(userId, account) {
  const fold = (s) => String(s ?? '').toLocaleLowerCase('tr').trim()

  let project = null
  if (account.default_project_id) {
    const rows = await asUser(userId).select(`projects?id=eq.${account.default_project_id}&select=id,name`)
    project = rows?.[0] ?? null
  }

  if (!project) {
    const projects = (await listProjects(userId)) ?? []
    for (const wanted of config.targetProjects) {
      project = projects.find((p) => fold(p.name) === fold(wanted))
        ?? projects.find((p) => fold(p.name).includes(fold(wanted)))
      if (project) break
    }
    if (!project) return { project: null, status: null, reason: 'proje-yok' }
  }

  const columns = (await statuses(userId, project.id)) ?? []
  let status = account.default_status_id
    ? columns.find((c) => c.id === account.default_status_id)
    : null
  status ??= columns.find((c) => fold(c.name) === fold(config.targetStatus))
    ?? columns.find((c) => fold(c.name).includes(fold(config.targetStatus)))
    ?? columns[0]
    ?? null

  return { project, status, reason: status ? null : 'sutun-yok' }
}

export const statuses = (userId, projectId) =>
  asUser(userId).select(
    `ticket_statuses?project_id=eq.${projectId}&select=id,name,order_index&order=order_index.asc`,
  )

// ── Görev açma ──────────────────────────────────────────────────────────────

/**
 * Insert the ticket as the user. RLS requires created_by = auth.uid() and write
 * access to the project's team, so a read-only member simply gets a 403 here
 * instead of the bot having to know the rule.
 *
 * The card lands at the top of the first column — the same place the board puts
 * a ticket whose status just changed, and the right place for something captured
 * on a phone: it should be the first thing seen, not buried under a long list.
 */
export async function createTicket(userId, draft) {
  const db = asUser(userId)
  let column = null
  if (draft.status_id) {
    const columns = await statuses(userId, draft.project_id)
    column = (columns ?? []).find((c) => c.id === draft.status_id) ?? null
  }
  if (!column) {
    const columns = await statuses(userId, draft.project_id)
    column = columns?.[0] ?? null
  }
  if (!column) throw new Error('Bu projede hiç liste (durum) yok, görev açılamıyor.')

  const edge = await db.select(
    `tickets?status_id=eq.${column.id}&select=order_index&order=order_index.asc&limit=1`,
  )
  const orderIndex = (edge?.[0]?.order_index ?? 1) - 1

  const rows = await db.insert('tickets', {
    title: draft.title,
    description: draft.description || null,
    project_id: draft.project_id,
    status_id: column.id,
    priority: draft.priority || null,
    created_by: userId,
    order_index: orderIndex,
  })
  const id = rows?.[0]?.id
  if (!id) throw new Error('Görev yazılamadı.')
  return ticketById(userId, id)
}

export const assignSelf = (userId, ticketId) =>
  asUser(userId).upsert('ticket_assignees', { ticket_id: ticketId, user_id: userId })

// ── Okuma ───────────────────────────────────────────────────────────────────

export async function ticketById(userId, id) {
  const rows = await asUser(userId).select(`tickets?id=eq.${id}&select=${TICKET_CARD_SELECT}`)
  return rows?.[0] ?? null
}

/** Resolve the short id printed on a board card (#118F5C) back to a ticket. */
export async function ticketByShort(userId, code) {
  const hits = await asUser(userId).rpc('ticket_by_short', { p_code: code })
  if (!hits?.length) return null
  return ticketById(userId, hits[0].id)
}

export function myTickets(userId, { dueToday = false } = {}) {
  const filters = [
    `select=${TICKET_LIST_SELECT}`,
    `assignees.user_id=eq.${userId}`,
    OPEN,
    'archived_at=is.null',
    'order=due_date.asc.nullslast,priority.desc',
    // Read past what one message shows so "…ve N görev daha" is honest.
    'limit=100',
  ]
  if (dueToday) filters.push(`due_date=lte.${localToday()}`)
  return asUser(userId).select(`tickets?${filters.join('&')}`)
}

export async function setStatus(userId, ticketId, statusId) {
  const updated = await asUser(userId).update(`tickets?id=eq.${ticketId}`, {
    status_id: statusId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  })
  return Boolean(updated?.length)
}

// ── Taslak (sohbetin hangi adımda olduğu) ───────────────────────────────────

export async function getDraft(chatId) {
  const rows = await service.select(`telegram_compose?chat_id=eq.${chatId}&select=*`)
  const draft = rows?.[0]
  if (!draft) return null

  // An abandoned draft must not swallow tomorrow's first message.
  const age = Date.now() - new Date(draft.updated_at).getTime()
  if (age > config.draftTtlMinutes * 60000) {
    await clearDraft(chatId)
    return null
  }
  return draft
}

export async function saveDraft(chatId, userId, patch) {
  await service.upsert('telegram_compose', {
    chat_id: chatId,
    user_id: userId,
    updated_at: new Date().toISOString(),
    ...patch,
  })
}

export const clearDraft = (chatId) => service.remove(`telegram_compose?chat_id=eq.${chatId}`)

// ── Yapay zekâ sohbeti ──────────────────────────────────────────────────────

export async function getAiSession(chatId) {
  const rows = await service.select(`telegram_ai?chat_id=eq.${chatId}&select=*`)
  const session = rows?.[0]
  if (!session) return null

  // Dünkü konuşmanın kuyruğuna yeni bir derdi eklemek işe yaramaz.
  const age = Date.now() - new Date(session.updated_at).getTime()
  if (age > config.draftTtlMinutes * 60000) {
    await clearAiSession(chatId)
    return null
  }
  return session
}

export async function saveAiSession(chatId, userId, patch) {
  await service.upsert('telegram_ai', {
    chat_id: chatId,
    user_id: userId,
    updated_at: new Date().toISOString(),
    ...patch,
  })
}

export const clearAiSession = (chatId) => service.remove(`telegram_ai?chat_id=eq.${chatId}`)
