import { usePrefs } from './usePrefs'
import { t } from '../i18n'
import type { NotificationEvent } from '../lib/notify'

/**
 * Which events reach the user, and through which channel. Stored server-side
 * (user_preferences, scope `global`) so the choice follows them between
 * browsers; `merge_user_prefs` merges one nested level, so `notifications` can
 * be patched key by key without clobbering the rest.
 *
 * Every event now carries a switch *per channel* — "comments only to Telegram,
 * assignments everywhere" is a reasonable thing to want. Records written before
 * Telegram existed stored one boolean per event; those are read as "on for every
 * channel" so nobody's settings quietly change meaning.
 */
export type NotificationChannel = 'inApp' | 'browser' | 'telegram'

export type EventChannels = Record<NotificationChannel, boolean>

export interface NotificationPrefs {
  inApp: boolean
  browser: boolean
  telegram: boolean
  events: Record<NotificationEvent, EventChannels>
}

/**
 * Both tables are read at render time by the settings screen, so their labels
 * are getters rather than plain strings: a module-level literal would be built
 * once at import and keep the language the app happened to start in. The shape
 * every caller sees (`c.label`, `e.hint`, …) is unchanged.
 */
export const NOTIFICATION_CHANNELS: { id: NotificationChannel; label: string; short: string }[] = [
  { id: 'inApp', get label() { return t('inbox.channel.inApp') }, get short() { return t('inbox.channel.inApp.short') } },
  { id: 'browser', get label() { return t('inbox.channel.browser') }, get short() { return t('inbox.channel.browser.short') } },
  // Telegram is a product name — the same in every locale.
  { id: 'telegram', label: 'Telegram', short: 'Telegram' },
]

export const NOTIFICATION_EVENTS: { id: NotificationEvent; label: string; hint: string }[] = [
  { id: 'assigned', get label() { return t('inbox.event.assigned.label') }, get hint() { return t('inbox.event.assigned.hint') } },
  { id: 'comment', get label() { return t('inbox.event.comment.label') }, get hint() { return t('inbox.event.comment.hint') } },
  { id: 'status', get label() { return t('inbox.event.status.label') }, get hint() { return t('inbox.event.status.hint') } },
  { id: 'subtask', get label() { return t('inbox.event.subtask.label') }, get hint() { return t('inbox.event.subtask.hint') } },
  { id: 'file', get label() { return t('inbox.event.file.label') }, get hint() { return t('inbox.event.file.hint') } },
  { id: 'mention', get label() { return t('inbox.event.mention.label') }, get hint() { return t('inbox.event.mention.hint') } },
  { id: 'reminder', get label() { return t('inbox.event.reminder.label') }, get hint() { return t('inbox.event.reminder.hint') } },
]

const all = (on: boolean): EventChannels => ({ inApp: on, browser: on, telegram: on })

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  inApp: true,
  browser: false,
  telegram: false,
  events: {
    assigned: all(true),
    comment: all(true),
    status: all(false),
    subtask: all(false),
    file: all(false),
    mention: all(true),
    reminder: all(true),
  },
}

type StoredEvent = boolean | Partial<EventChannels>
interface StoredPrefs {
  inApp?: boolean
  browser?: boolean
  telegram?: boolean
  events?: Partial<Record<NotificationEvent, StoredEvent>>
}

const readEvent = (stored: StoredEvent | undefined, fallback: EventChannels): EventChannels => {
  if (stored === undefined || stored === null) return fallback
  if (typeof stored === 'boolean') return all(stored)
  return { ...all(false), ...stored }
}

export function useNotificationPrefs() {
  const prefs = usePrefs('global')
  const stored = (prefs.prefs as { notifications?: StoredPrefs }).notifications

  const events = Object.fromEntries(
    NOTIFICATION_EVENTS.map((e) => [e.id, readEvent(stored?.events?.[e.id], DEFAULT_NOTIFICATION_PREFS.events[e.id])]),
  ) as Record<NotificationEvent, EventChannels>

  const value: NotificationPrefs = {
    inApp: stored?.inApp ?? DEFAULT_NOTIFICATION_PREFS.inApp,
    browser: stored?.browser ?? DEFAULT_NOTIFICATION_PREFS.browser,
    telegram: stored?.telegram ?? DEFAULT_NOTIFICATION_PREFS.telegram,
    events,
  }

  const patch = (next: Partial<NotificationPrefs>) =>
    prefs.patch({ v: 1, notifications: { ...value, ...next, events: { ...value.events, ...(next.events ?? {}) } } })

  /** Flip one cell of the event × channel grid. */
  const setEventChannel = (event: NotificationEvent, channel: NotificationChannel, on: boolean) =>
    patch({ events: { ...value.events, [event]: { ...value.events[event], [channel]: on } } })

  return { value, patch, setEventChannel, loaded: prefs.loaded }
}

/** A channel only fires when both the channel and that event's cell are on. */
export const eventEnabled = (prefs: NotificationPrefs, event: NotificationEvent, channel: NotificationChannel) =>
  Boolean(prefs[channel] && prefs.events[event]?.[channel])
