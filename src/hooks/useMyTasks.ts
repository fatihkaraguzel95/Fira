import type { TranslationKey } from '../i18n'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { currentUser } from '../lib/session'
import { isCompleteStatus, type Ticket } from '../types'
import { listSelectFor, listFieldsKey, ALL_LIST_FIELDS, type ListFields } from './useTickets'

/**
 * "My tasks" across every list (#4A136310): the open tasks assigned to me,
 * in the same shape the board's list view renders, sliced into the views the
 * Home panel offers — overdue, today, this week, last week, undated, all.
 * Weeks run Monday to Sunday in local time.
 */
export type MyTasksView = 'overdue' | 'today' | 'week' | 'lastweek' | 'nodate' | 'all'
export const MY_TASKS_VIEWS: MyTasksView[] = ['overdue', 'today', 'week', 'lastweek', 'nodate', 'all']

export function useMyTasks(enabled = true, includeClosed = false, fields: ListFields = ALL_LIST_FIELDS) {
  return useQuery({
    // Under 'tickets' so the optimistic helpers and invalidateTicketViews reach this cache too (TL-01).
    queryKey: ['tickets', { source: 'me', closed: includeClosed, fields: listFieldsKey(fields) }],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<Ticket[]> => {
      const me = (await currentUser())?.id
      if (!me) return []
      const { data, error } = await supabase
        .from('tickets')
        .select(listSelectFor(true, fields))
        .eq('assignees.user_id', me)
        .is('archived_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(500)
      if (error) throw error
      const rows = (data ?? []) as unknown as Ticket[]
      return includeClosed ? rows : rows.filter((t) => !isCompleteStatus(t.status_info))
    },
  })
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function weekBounds(offsetWeeks: number, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dow = (d.getDay() + 6) % 7            // Monday = 0
  d.setDate(d.getDate() - dow + offsetWeeks * 7)
  const start = iso(d)
  d.setDate(d.getDate() + 6)
  return { start, end: iso(d) }
}

/** The tasks a view shows. Pure, so the counts in the panel and the list agree. */
export function sliceMyTasks(tasks: Ticket[], view: MyTasksView, now = new Date()): Ticket[] {
  const today = iso(now)
  const week = weekBounds(0, now), last = weekBounds(-1, now)
  switch (view) {
    case 'overdue': return tasks.filter((t) => !!t.due_date && t.due_date < today)
    case 'today': return tasks.filter((t) => t.due_date === today)
    case 'week': return tasks.filter((t) => !!t.due_date && t.due_date >= week.start && t.due_date <= week.end)
    case 'lastweek': return tasks.filter((t) => !!t.due_date && t.due_date >= last.start && t.due_date <= last.end)
    case 'nodate': return tasks.filter((t) => !t.due_date)
    default: return tasks
  }
}

/** Görev dilimlerinin etiketleri. MeView'da duruyordu; Ana sayfa paneli yalnız bunun için
 *  liste görünümünü ana pakete çekiyordu (#74d303e2). */
const VIEW_KEY: Record<MyTasksView, TranslationKey> = {
  overdue: 'me.tasks.overdue', today: 'me.tasks.today', week: 'me.tasks.week', lastweek: 'me.tasks.lastWeek', nodate: 'me.tasks.noDate', all: 'me.tasks.all',
}
export const myTasksViewLabel = (v: MyTasksView): TranslationKey => VIEW_KEY[v]
