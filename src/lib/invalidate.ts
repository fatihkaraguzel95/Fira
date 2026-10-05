import type { QueryClient } from '@tanstack/react-query'

/**
 * The same ticket is rendered from three different queries: the board/list
 * (`tickets`), the open ticket (`ticket`) and the subtask rows of its parent
 * (`children`). Anything that changes a ticket has to refresh all three — the
 * subtask list is the easy one to forget, and then an assignment made from the
 * parent's screen only shows up after a reload.
 */
export function invalidateTicketViews(qc: QueryClient, ticketId?: string) {
  qc.invalidateQueries({ queryKey: ['tickets'] })
  qc.invalidateQueries({ queryKey: ['children'] })
  qc.invalidateQueries({ queryKey: ticketId ? ['ticket', ticketId] : ['ticket'] })
  // Every one of those changes is also a line in the activity log.
  qc.invalidateQueries({ queryKey: ticketId ? ['activity', ticketId] : ['activity'] })
  // Deleting a status asks where its tickets should go — only when it has any.
  qc.invalidateQueries({ queryKey: ['status-counts'] })
}
