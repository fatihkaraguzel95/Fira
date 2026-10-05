import { openInbox } from './inboxBus'
import { supabase } from './supabase'
import { displayUrl } from './storage'
import { appIcon, notificationIcon, type NotifyActor } from './notifyStyle'
import { popupText, type NotificationEvent, type NotifyItem } from './notifyText'
import { t } from '../i18n'

// The sentences live in notifyText.ts; importers keep reading them from here.
export { VERB, itemText, popupText } from './notifyText'
export type { NotificationEvent, NotifyItem } from './notifyText'

/**
 * In-app notifications.
 *
 * Fira has no server-side notification service (no SMTP, no push backend), so
 * what it can do honestly is tell you about things that happen *while you have
 * it open*: the realtime activity feed is already there, and every change lands
 * in ticket_activity. This module is the small bus between that feed and the
 * user: the realtime handler describes an event, the host component shows it as
 * a toast, and — with permission — the browser shows it even when the tab is in
 * the background.
 */

export interface AppNotification {
  id: string
  event: NotificationEvent
  /** Plain text, as the system notification shows it (and the toast, when the fields below are absent). */
  title: string
  body: string
  ticketId: string
  at: number
  /**
   * The same news in parts (#4029f71c), so the toast can draw it like an inbox
   * row — the actor's face, their name, the status as a chip — and the system
   * notification can carry that face as its icon. Absent for a reminder and for
   * plain messages: nobody caused those.
   */
  actor?: NotifyActor | null
  items?: NotifyItem[]
  ticketTitle?: string
}

type Listener = (n: AppNotification) => void
const listeners = new Set<Listener>()

export function subscribeNotifications(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Guard against the same event arriving twice (realtime retries, two tabs of one window). */
const seen = new Map<string, number>()
function isDuplicate(key: string) {
  const now = Date.now()
  for (const [k, t] of seen) if (now - t > 30_000) seen.delete(k)
  if (seen.has(key)) return true
  seen.set(key, now)
  return false
}

export function emitNotification(
  n: Omit<AppNotification, 'at'>,
  channels: { inApp: boolean; browser: boolean },
  /** The settings screen's test button: show it even though the tab is in front. */
  opts: { force?: boolean } = {},
) {
  if (isDuplicate(n.id)) return
  const full: AppNotification = { ...n, at: Date.now() }
  if (channels.inApp) for (const fn of listeners) fn(full)
  if (channels.browser && canNotify(opts.force) && (opts.force || popupAllowed())) void showPopup(full)
}

// QA: the icon the system notification would get for a person — the popup itself cannot be read back.
if (typeof window !== 'undefined') {
  (window as unknown as { __firaNotifyIcon?: (a: NotifyActor) => Promise<string> }).__firaNotifyIcon = (a) => notificationIcon(a, displayUrl)
}

/** The system notification. Its icon is the actor's face, which has to be drawn first. */
async function showPopup(full: AppNotification) {
  const icon = await notificationIcon(full.actor, displayUrl)
  try {
    const notification = new Notification(full.title, {
      body: full.body,
      icon,
      badge: '/icons/favicon-48.png',
      tag: full.ticketId,
    })
    notification.onclick = () => {
      window.focus()
      // The inbox with this notification picked, not the ticket (#F6EBA5AD).
      openInbox({ ticketId: full.ticketId })
      notification.close()
    }
  } catch {
    // Some browsers refuse the constructor outside a service worker; the toast still shows.
  }
}

export const notificationSupport = () => typeof window !== 'undefined' && 'Notification' in window
export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  (notificationSupport() ? Notification.permission : 'unsupported')
const canNotify = (force = false) =>
  notificationSupport() && Notification.permission === 'granted' && (force || document.visibilityState !== 'visible')

/**
 * OS popups are rate limited: after a few in quick succession the rest collapse
 * into one "N more" popup. Toasts are already capped by the host (four visible).
 */
const POPUP_WINDOW_MS = 30_000
const POPUP_LIMIT = 3
const popupTimes: number[] = []
let collapsed = 0
let collapseTimer: number | undefined
function popupAllowed() {
  const now = Date.now()
  while (popupTimes.length && now - popupTimes[0] > POPUP_WINDOW_MS) popupTimes.shift()
  if (popupTimes.length < POPUP_LIMIT) { popupTimes.push(now); return true }
  collapsed += 1
  window.clearTimeout(collapseTimer)
  collapseTimer = window.setTimeout(() => {
    const n = collapsed
    collapsed = 0
    if (n > 0) void appIcon().then((icon) => { try { new Notification('Fira', { body: t('inbox.notify.moreCollapsed', { n }), icon, tag: 'fira-collapsed' }) } catch { /* ignore */ } })
  }, 5000)
  return false
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationSupport()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

// ─── Bridge: realtime activity → notifications ────────────────────────────────

export interface NotifyConfig {
  userId: string | null
  inApp: boolean
  browser: boolean
  /** Per event, per channel — "comments in the app but not as a popup" is allowed. */
  events: Record<NotificationEvent, { inApp: boolean; browser: boolean }>
  /**
   * Tickets this user stopped following (062). The three persistent channels are
   * muted server-side in `activity_recipients`, but the toast comes straight off
   * the realtime stream and never asks the server who should hear about it — so
   * the same list has to be checked here too, or an unfollowed ticket would
   * still pop up while the tab is open.
   */
  muted: Set<string>
}

let config: NotifyConfig | null = null
export const setNotifyConfig = (c: NotifyConfig) => { config = c }

const KIND_TO_EVENT: Record<string, NotificationEvent> = {
  assignee_added: 'assigned',
  comment_added: 'comment',
  status: 'status',
  child_added: 'subtask',
  attachment_added: 'file',
  mentioned: 'mention',
  reminder: 'reminder',
}

/** Markdown → a short readable line for toasts and system notifications. */
export const plainText = (raw: string) =>
  raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, () => t('inbox.image'))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\s+/g, ' ')
    .trim()

interface ActivityRow { id: string; ticket_id: string; actor_id: string | null; kind: string; from_value: string | null; to_value: string | null; meta: Record<string, unknown> | null }

/**
 * Decide whether a change someone else made is worth telling this user about.
 * "Involved" means assigned to the ticket or its creator — anything looser and a
 * busy list would notify everyone about everything.
 */
export async function notifyFromActivity(row: ActivityRow) {
  const cfg = config
  if (!cfg?.userId || (!cfg.inApp && !cfg.browser)) return
  if (!row?.id || row.actor_id === cfg.userId) return
  // Rows written during an import are flagged bulk; forty toasts in a row help nobody.
  if ((row.meta as { bulk?: boolean } | null)?.bulk) return
  const event = KIND_TO_EVENT[row.kind]
  if (!event) return
  // A mention is personal: it gets through a muted task, and only to the person named.
  if (event === 'mention' && (row.meta as { user_id?: string } | null)?.user_id !== cfg.userId) return
  if (event !== 'mention' && row.ticket_id && cfg.muted.has(row.ticket_id)) return
  const channels = {
    inApp: cfg.inApp && (cfg.events[event]?.inApp ?? false),
    browser: cfg.browser && (cfg.events[event]?.browser ?? false),
  }
  if (!channels.inApp && !channels.browser) return

  const { data } = await supabase
    .from('ticket_activity')
    .select('id, to_value, meta, ticket:tickets!ticket_activity_ticket_id_fkey(id, title, created_by, assignees:ticket_assignees(user_id)), actor:profiles!ticket_activity_actor_id_fkey(id, full_name, email, avatar_url)')
    .eq('id', row.id)
    .maybeSingle()
  const detail = data as unknown as {
    to_value: string | null
    meta: Record<string, unknown> | null
    ticket: { id: string; title: string; created_by: string; assignees: { user_id: string }[] } | null
    actor: { id: string; full_name: string | null; email: string | null; avatar_url: string | null } | null
  } | null
  const ticket = detail?.ticket
  if (!ticket) return

  const assigned = (ticket.assignees ?? []).some((a) => a.user_id === cfg.userId)
  const involved = assigned || ticket.created_by === cfg.userId
  if (event === 'assigned' || event === 'mention') {
    if ((detail?.meta?.user_id as string | undefined) !== cfg.userId) return
  } else if (!involved) return
  // A reminder is about a deadline of this very task: its value is the due time.


  const who = detail?.actor?.full_name || detail?.actor?.email || t('common.someoneElse')
  // Comments are written in Markdown; a one-line preview should read as text,
  // not as asterisks and backticks.
  const value = plainText(detail?.to_value ?? '')
  ticketTitles.set(ticket.id, ticket.title)
  // A reminder has no actor: nobody's face goes on it.
  const actor: NotifyActor | null = detail?.actor && event !== 'reminder'
    ? { id: detail.actor.id, name: who, avatarUrl: detail.actor.avatar_url }
    : null
  // The colour the status had when it was set (038 keeps it on the activity row).
  const color = event === 'status' ? ((detail?.meta?.to_color as string | undefined) ?? null) : null

  queueNotification({ id: row.id, event, ticketId: ticket.id, who, value, color, actor }, channels)
}

/**
 * One person doing three things to one ticket in a row (assign, comment,
 * change the status) is one piece of news, not three. Events for the same
 * ticket and actor are held briefly and shown as a single notification whose
 * body lists what happened; a lone event goes out after the same short delay.
 */
const COALESCE_MS = 4000
type Pending = { key: string; ticketId: string; who: string; actor: NotifyActor | null; items: (NotifyItem & { id: string })[]; channels: { inApp: boolean; browser: boolean }; timer: number }
const pending = new Map<string, Pending>()

function queueNotification(
  n: { id: string; event: NotificationEvent; ticketId: string; who: string; value: string; color: string | null; actor: NotifyActor | null },
  channels: { inApp: boolean; browser: boolean },
) {
  const key = `${n.ticketId}|${n.who}`
  const p = pending.get(key)
  if (p) {
    p.items.push({ event: n.event, value: n.value, color: n.color, id: n.id })
    p.actor = p.actor ?? n.actor
    p.channels = { inApp: p.channels.inApp || channels.inApp, browser: p.channels.browser || channels.browser }
    window.clearTimeout(p.timer)
    p.timer = window.setTimeout(() => flush(key), COALESCE_MS)
    return
  }
  pending.set(key, { key, ticketId: n.ticketId, who: n.who, actor: n.actor, items: [{ event: n.event, value: n.value, color: n.color, id: n.id }], channels, timer: window.setTimeout(() => flush(key), COALESCE_MS) })
}


function flush(key: string) {
  const p = pending.get(key)
  if (!p) return
  pending.delete(key)
  const ticketTitle = ticketTitles.get(p.ticketId) ?? ''
  const lead = p.items.find((i) => i.event === 'assigned') ?? p.items[p.items.length - 1]
  const items: NotifyItem[] = p.items.map(({ event, value, color }) => ({ event, value, color }))
  emitNotification(
    { id: p.items.map((i) => i.id).join('+'), event: lead.event, ...popupText(p.who, !!p.actor, items, ticketTitle), ticketId: p.ticketId, actor: p.actor, items, ticketTitle },
    p.channels,
  )
}

/** Titles seen while resolving events, so a merged message can name the ticket without another query. */
const ticketTitles = new Map<string, string>()
