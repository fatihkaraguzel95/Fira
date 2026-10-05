import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { currentUser } from '../lib/session'
import { isCompleteStatus, type Ticket, type TicketStatus } from '../types'
import { listSelectFor, listFieldsKey, ALL_LIST_FIELDS, type ListFields } from './useTickets'
import { useMyTasks, sliceMyTasks, type MyTasksView } from './useMyTasks'
import { useNames } from '../components/layout/FavoritesSection'

/**
 * Where a list's rows come from (#883CF8 / TL-01). The view does not care:
 * every source yields the same shape — tickets, loading, what the viewer may
 * change, and the list/team the rows belong to when there is exactly one.
 *
 *  - project: the board's list. BoardPage already applied the header filter
 *    and the comment search to these rows, so they come in as they are.
 *  - me: my open tasks across every list, one slice (today, overdue, …).
 *  - created: tasks I opened, across every list.
 *  - team: every open task of a team.
 *
 * All query keys start with 'tickets' so the optimistic helpers and
 * `invalidateTicketViews` reach these caches like any other list.
 */
export type ListSource =
  | { kind: 'project'; projectId: string; teamId: string | null; tickets: Ticket[]; isLoading: boolean; canWrite: boolean; statuses: TicketStatus[] }
  | { kind: 'me'; view: MyTasksView; includeClosed?: boolean; fields?: ListFields }
  | { kind: 'created'; includeClosed?: boolean; fields?: ListFields }
  | { kind: 'team'; teamId: string; includeClosed?: boolean; fields?: ListFields }

export interface ListData {
  tickets: Ticket[]
  isLoading: boolean
  /** Rows may be edited in place (assignees today; status/priority/due in TL-06). */
  canWrite: boolean
  /** Set when every row belongs to one team / one list. */
  teamId: string | null
  projectId: string | null
  statuses: TicketStatus[]
  /** Name/icon of a project id, for lists that span several projects. */
  project: (id: string | null) => { name: string; icon?: string | null; icon_url?: string | null } | undefined
}

const EMPTY: Ticket[] = []

function useCreatedByMe(enabled: boolean, includeClosed = false, fields: ListFields = ALL_LIST_FIELDS) {
  return useQuery({
    queryKey: ['tickets', { source: 'created', closed: includeClosed, fields: listFieldsKey(fields) }],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<Ticket[]> => {
      const me = (await currentUser())?.id
      if (!me) return []
      const { data, error } = await supabase
        .from('tickets')
        .select(listSelectFor(false, fields))
        .eq('created_by', me)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      const rows = (data ?? []) as unknown as Ticket[]
      return includeClosed ? rows : rows.filter((t) => !isCompleteStatus(t.status_info))
    },
  })
}

function useTeamTickets(teamId: string | null, includeClosed = false, fields: ListFields = ALL_LIST_FIELDS) {
  return useQuery({
    queryKey: ['tickets', { source: 'team', teamId, closed: includeClosed, fields: listFieldsKey(fields) }],
    enabled: !!teamId,
    staleTime: 30_000,
    queryFn: async (): Promise<Ticket[]> => {
      const { data, error } = await supabase
        .from('tickets')
        .select(`${listSelectFor(false, fields)}, project:projects!inner(team_id)`)
        .eq('project.team_id', teamId!)
        .is('archived_at', null)
        .order('order_index', { ascending: true })
        .limit(1000)
      if (error) throw error
      const rows = (data ?? []) as unknown as Ticket[]
      return includeClosed ? rows : rows.filter((t) => !isCompleteStatus(t.status_info))
    },
  })
}

export function useTicketListData(source: ListSource): ListData {
  const fields = source.kind === 'project' ? ALL_LIST_FIELDS : (source.fields ?? ALL_LIST_FIELDS)
  const me = useMyTasks(source.kind === 'me', source.kind === 'me' && !!source.includeClosed, fields)
  const created = useCreatedByMe(source.kind === 'created', source.kind === 'created' && !!source.includeClosed, fields)
  const team = useTeamTickets(source.kind === 'team' ? source.teamId : null, source.kind === 'team' && !!source.includeClosed, fields)

  const tickets = source.kind === 'project' ? source.tickets
    : source.kind === 'me' ? sliceMyTasks(me.data ?? EMPTY, source.view)
    : source.kind === 'created' ? (created.data ?? EMPTY)
    : (team.data ?? EMPTY)
  const isLoading = source.kind === 'project' ? source.isLoading
    : source.kind === 'me' ? me.isLoading
    : source.kind === 'created' ? created.isLoading
    : team.isLoading

  // Project names for cross-list sources; the board's own list needs none.
  const projectIds = useMemo(() => {
    if (source.kind === 'project') return []
    const ids = new Set<string>()
    for (const t of tickets) if (t.project_id) ids.add(t.project_id)
    return Array.from(ids)
  }, [source.kind, tickets])
  const names = useNames('project', projectIds)
  const byId = useMemo(() => new Map((names.data ?? []).map((n) => [n.id, n])), [names.data])

  return {
    tickets,
    isLoading,
    canWrite: source.kind === 'project' ? source.canWrite : false,
    teamId: source.kind === 'project' ? source.teamId : source.kind === 'team' ? source.teamId : null,
    projectId: source.kind === 'project' ? source.projectId : null,
    statuses: source.kind === 'project' ? source.statuses : [],
    project: (id) => (id ? byId.get(id) : undefined),
  }
}
