import type { Ticket, TicketFilters, DueBucket } from '../types'
// Aliased: `t` is a ticket in the filter callbacks below, and a shadowed
// translator that silently returns nothing would be very hard to spot.
import { t as tr, type TranslationKey } from '../i18n'

export const UNASSIGNED = '__unassigned__'

/** Only the keys live at module scope — a table of translated labels would be
 *  built once at import and would still be Turkish after a language change. */
const DUE_LABEL_KEYS: { value: DueBucket; key: TranslationKey }[] = [
  { value: 'overdue',   key: 'board.due.overdue' },
  { value: 'today',     key: 'board.due.today' },
  { value: 'tomorrow',  key: 'board.due.tomorrow' },
  { value: 'this_week', key: 'board.due.thisWeek' },
  { value: 'next_week', key: 'board.due.nextWeek' },
  { value: 'later',     key: 'board.due.later' },
  { value: 'none',      key: 'board.due.none' },
]

/** Call at render time — the labels follow the interface language. */
export const dueOptions = (): { value: DueBucket; label: string }[] =>
  DUE_LABEL_KEYS.map(({ value, key }) => ({ value, label: tr(key) }))

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
/** Monday-based start of week. */
const startOfWeek = (d: Date) => { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow) }

export function dueBucket(due: string | null, now = new Date()): DueBucket {
  if (!due) return 'none'
  const d = startOfDay(new Date(due))
  const today = startOfDay(now)
  if (d < today) return 'overdue'
  if (d.getTime() === today.getTime()) return 'today'
  if (d.getTime() === addDays(today, 1).getTime()) return 'tomorrow'
  const weekStart = startOfWeek(now)
  const nextWeekStart = addDays(weekStart, 7)
  const afterNextWeek = addDays(weekStart, 14)
  if (d < nextWeekStart) return 'this_week'
  if (d < afterNextWeek) return 'next_week'
  return 'later'
}

export function countActiveFilters(f: TicketFilters): number {
  return (
    (f.assignee_ids?.length ?? 0) +
    (f.tag_ids?.length ?? 0) +
    (f.priority?.length ?? 0) +
    (f.status_id?.length ?? 0) +
    (f.due?.length ?? 0) +
    (f.show_backlog === false ? 1 : 0)
  )
}

export function hasAnyFilter(f: TicketFilters): boolean {
  return countActiveFilters(f) > 0 || !!f.search?.trim()
}

export function clearFilters(f: TicketFilters): TicketFilters {
  return { project_id: f.project_id, include_archived: f.include_archived, show_closed: f.show_closed, show_children: f.show_children, show_backlog: f.show_backlog }
}

/**
 * @param commentMatches ids of tickets whose comments match the search term —
 *   comments are not loaded with the board, so a caller that searches them looks
 *   them up separately and folds the ids in here. (The list header's own search
 *   is gone since #9ab8db99; the palette searches server-side instead.)
 */
export function applyTicketFilters(tickets: Ticket[], f: TicketFilters, commentMatches?: Iterable<string>): Ticket[] {
  const inComments = commentMatches ? new Set(commentMatches) : null
  // "#118F5C" is how the board prints an id; the hash is not part of it.
  const search = f.search?.trim().replace(/^#/, '').toLocaleLowerCase('tr-TR')
  const now = new Date()
  return tickets.filter((t) => {
    if (!f.show_children && t.parent_id) return false
    if (!f.show_closed && t.status_info?.category === 'closed' && !f.status_id?.length) return false
    // Backlog ("Planlanıyor") is shown by default; hidden only when switched off.
    if (f.show_backlog === false && t.status_info?.category === 'backlog' && !f.status_id?.length) return false
    if (search) {
      // Only the title and the id are in memory. Descriptions and comments are
      // not loaded with the board, so they are matched server side and arrive
      // here as `commentMatches` (see useCommentSearch).
      const hay = `${t.title} ${t.id} ${t.id.replace(/-/g, '')}`.toLocaleLowerCase('tr-TR')
      if (!hay.includes(search) && !inComments?.has(t.id)) return false
    }
    if (f.status_id?.length && !f.status_id.includes(t.status_id ?? '')) return false
    if (f.priority?.length && !f.priority.includes(t.priority as never)) return false
    if (f.assignee_ids?.length) {
      const ids = (t.assignees ?? []).map((a) => a.user_id)
      const wantUnassigned = f.assignee_ids.includes(UNASSIGNED)
      const match = ids.some((id) => f.assignee_ids!.includes(id)) || (wantUnassigned && ids.length === 0)
      if (!match) return false
    }
    if (f.tag_ids?.length) {
      const ids = (t.tags ?? []).map((x) => x.tag.id)
      if (!ids.some((id) => f.tag_ids!.includes(id))) return false
    }
    if (f.due?.length && !f.due.includes(dueBucket(t.due_date, now))) return false
    return true
  })
}
