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

const fold = (s) => String(s ?? '').toLocaleLowerCase('tr').trim()

/**
 * The one column Telegram tickets go to: "yapılacaklar".
 *
 * Deliberately not a question and not a stored per-user choice. Everything
 * captured from a phone is new work, and new work belongs at the start of the
 * board — asking "which column?" every time only invites a wrong answer.
 *
 * Resolved by name so it survives a renamed column, then by the `backlog`
 * category (what create_default_statuses gives the first column), and only then
 * by position.
 */
export function standardColumn(columns) {
  const list = columns ?? []
  const wanted = fold(config.targetStatus)
  const aliases = [wanted, ...config.targetStatusAliases.map(fold)].filter(Boolean)

  for (const alias of aliases) {
    const hit = list.find((c) => fold(c.name) === alias)
    if (hit) return hit
  }
  for (const alias of aliases) {
    const hit = list.find((c) => fold(c.name).includes(alias))
    if (hit) return hit
  }
  return list.find((c) => c.category === 'backlog') ?? list[0] ?? null
}

/**
 * Where tickets land: a list (project) and, inside it, the standard column.
 *
 * The stored list (set once via /hedef, or on the first created ticket) wins.
 * Otherwise the configured names are matched against the lists this user can
 * actually see — so the target is discovered rather than hardcoded as an id that
 * would differ per environment. The column is never stored or asked: it is
 * always standardColumn() of whatever list we end up with.
 */
export async function resolveTarget(userId, account) {
  let project = null
  if (account.default_project_id) {
    project = await projectWithTeam(userId, account.default_project_id)
  }

  if (!project) {
    const projects = (await listProjects(userId)) ?? []
    let found = null
    for (const wanted of config.targetProjects) {
      found = projects.find((p) => fold(p.name) === fold(wanted))
        ?? projects.find((p) => fold(p.name).includes(fold(wanted)))
      if (found) break
    }
    if (!found) return { project: null, status: null, reason: 'proje-yok' }
    project = (await projectWithTeam(userId, found.id)) ?? found
  }

  const status = standardColumn(await statuses(userId, project.id))
  return { project, status, reason: status ? null : 'sutun-yok' }
}

/**
 * The list plus its team name. The team is what the person actually thinks in
 * ("hangi takımın hangi listesi"), so it goes on the confirm card and into the
 * model's prompt. The embed needs read access to teams; if that query fails for
 * any reason the plain row is still enough to open a ticket.
 */
async function projectWithTeam(userId, projectId) {
  const db = asUser(userId)
  try {
    const rows = await db.select(`projects?id=eq.${projectId}&select=id,name,team:teams(name)`)
    if (rows?.[0]) return rows[0]
  } catch {
    // Takım adı süs: aşağıdaki düz satırla devam.
  }
  const rows = await db.select(`projects?id=eq.${projectId}&select=id,name`)
  return rows?.[0] ?? null
}

export const statuses = (userId, projectId) =>
  asUser(userId).select(
    `ticket_statuses?project_id=eq.${projectId}&select=id,name,category,order_index&order=order_index.asc`,
  )

// ── Görev açma ──────────────────────────────────────────────────────────────

/**
 * Insert the ticket as the user. RLS requires created_by = auth.uid() and write
 * access to the project's team, so a read-only member simply gets a 403 here
 * instead of the bot having to know the rule.
 *
 * The column is the standard one ("yapılacaklar") unless the caller resolved it
 * already, and the card lands at the top of it — the same place the board puts a
 * ticket whose status just changed, and the right place for something captured
 * on a phone: it should be the first thing seen, not buried under a long list.
 */
export async function createTicket(userId, draft) {
  const db = asUser(userId)
  const columns = (await statuses(userId, draft.project_id)) ?? []
  const column = (draft.status_id ? columns.find((c) => c.id === draft.status_id) : null)
    ?? standardColumn(columns)
  if (!column) throw new Error('Bu listede hiç durum (sütun) yok, görev açılamıyor.')

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
