import type { QueryClient } from '@tanstack/react-query'
import type { Ticket } from '../types'

/**
 * Optimistic updates for tickets. The same ticket lives in three caches —
 * the board/list (`tickets`, several filter variants), the open ticket
 * (`ticket`) and the subtask rows of its parent (`children`) — so a change has
 * to be applied to all of them at once, and rolled back from all of them if
 * the server refuses. These helpers keep that in one place.
 */

type Patch = (t: Ticket) => Ticket | null

const KEYS = (id: string) => [['tickets'], ['children'], ['ticket', id]] as const

/** Every cached copy of the ticket, before a mutation touches it. */
export async function snapshotTicketViews(qc: QueryClient, id: string) {
  await Promise.all(KEYS(id).map((k) => qc.cancelQueries({ queryKey: k })))
  return qc.getQueriesData<unknown>({ predicate: (q) => ['tickets', 'children', 'ticket'].includes(q.queryKey[0] as string) })
}

export function restoreTicketViews(qc: QueryClient, snap: ReturnType<typeof qc.getQueriesData<unknown>> | undefined) {
  if (!snap) return
  for (const [key, data] of snap) qc.setQueryData(key, data)
}

/**
 * Apply `patch` to the ticket wherever it is cached. Returning null from the
 * patch removes the ticket from list caches (used to drop a failed placeholder).
 */
export function patchTicketEverywhere(qc: QueryClient, id: string, patch: Patch) {
  const inList = (list: Ticket[] | undefined) => {
    if (!list) return list
    let changed = false
    const next: Ticket[] = []
    for (const t of list) {
      if (t.id !== id) { next.push(t); continue }
      changed = true
      const p = patch(t)
      if (p) next.push(p)
    }
    return changed ? next : list
  }
  qc.setQueriesData<Ticket[]>({ queryKey: ['tickets'] }, inList)
  qc.setQueriesData<Ticket[]>({ queryKey: ['children'] }, inList)
  qc.setQueriesData<Ticket>({ queryKey: ['ticket', id] }, (t) => (t ? patch(t) ?? t : t))
}

/** Put a brand-new ticket into every board/list cache of its project (and its parent's children). */
export function insertTicketEverywhere(qc: QueryClient, ticket: Ticket) {
  qc.setQueriesData<Ticket[]>({ queryKey: ['tickets'] }, (list) => {
    if (!list) return list
    // Only caches that belong to the same list; filter variants are refetched on settle anyway.
    if (list.length && list[0].project_id !== ticket.project_id) return list
    return [ticket, ...list]
  })
  if (ticket.parent_id) {
    qc.setQueryData<Ticket[]>(['children', ticket.parent_id], (list) => (list ? [...list, ticket] : list))
  }
}
