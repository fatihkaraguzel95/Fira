import { t, type TranslationKey } from '../i18n'
import { statusDot } from './notifyStyle'

/**
 * The words of a notification. Kept apart from notify.ts (which talks to the
 * server and the browser) so the sentences can be tested on their own.
 */

export type NotificationEvent = 'assigned' | 'comment' | 'status' | 'subtask' | 'file' | 'mention' | 'reminder'

/** One thing that happened; `color` is the status' own colour for a status change. */
export interface NotifyItem { event: NotificationEvent; value: string; color?: string | null }

/** Only the *keys* live at module level: the strings themselves are produced at
 *  send time, so a language change mid-session is picked up. */
const TITLE_KEYS: Record<NotificationEvent, TranslationKey> = {
  assigned: 'inbox.notify.assigned',
  comment: 'inbox.notify.comment',
  status: 'inbox.notify.status',
  subtask: 'inbox.notify.subtask',
  file: 'inbox.notify.file',
  mention: 'inbox.notify.mention',
  reminder: 'inbox.notify.reminder',
}
export const eventTitle = (event: NotificationEvent) => t(TITLE_KEYS[event])

/** Each entry stays a *function*, so the sentence is translated when it is
 *  rendered rather than frozen in whatever language loaded the module. */
export const VERB: Record<NotificationEvent, (v: string) => string> = {
  assigned: () => t('inbox.verb.assigned'),
  comment: (v) => t('inbox.verb.comment', { v: `${v.slice(0, 60)}${v.length > 60 ? '…' : ''}` }),
  status: (v) => t('inbox.verb.status', { v }),
  subtask: (v) => t('inbox.verb.subtask', { v: v.slice(0, 40) }),
  file: (v) => t('inbox.verb.file', { v: v.slice(0, 40) }),
  mention: (v) => t('inbox.verb.mention', { v: `${v.slice(0, 60)}${v.length > 60 ? '…' : ''}` }),
  reminder: (v) => t('inbox.verb.reminder', { v }),   // özne yok: satırı InboxList aktörsüz kurar
}

/**
 * One item as plain text, for the system notification. A status carries a dot
 * in its own colour in front of its name — the nearest plain text gets to the
 * chip the inbox draws (#4029f71c).
 */
export function itemText(item: NotifyItem): string {
  if (item.event !== 'status') return VERB[item.event](item.value)
  const dot = statusDot(item.color)
  return VERB.status(dot ? `${dot} ${item.value}` : item.value)
}

/**
 * Title and body of the system notification, in the shape of an inbox row: the
 * title is the person, the body continues the sentence ("durumu 🔵 Devam Ediyor
 * yaptı") and names the task on its own line.
 *
 * When nobody's face can go on it the title says what kind of news it is, and
 * the sentence keeps its subject ("Biri …") — except a reminder, which has none.
 */
export function popupText(who: string, hasActor: boolean, items: NotifyItem[], ticketTitle: string): { title: string; body: string } {
  const lead = items.find((i) => i.event === 'assigned') ?? items[items.length - 1]
  const parts = items.map(itemText).join('; ')
  const subjectless = items.every((i) => i.event === 'reminder')
  const sentence = hasActor || subjectless ? parts : `${who} ${parts}`
  const body = ticketTitle ? `${sentence}\n${ticketTitle}` : sentence
  if (!hasActor) return { title: eventTitle(lead.event), body }
  return { title: items.length > 1 ? `${who} · ${t('inbox.notify.changes', { n: items.length })}` : who, body }
}
