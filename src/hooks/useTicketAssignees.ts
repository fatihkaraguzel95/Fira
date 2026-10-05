import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { invalidateTicketViews } from '../lib/invalidate'
import { patchTicketEverywhere, snapshotTicketViews, restoreTicketViews } from '../lib/optimistic'
import type { Profile, Ticket } from '../types'

type AssigneeRow = NonNullable<Ticket['assignees']>[number]

/**
 * Assigning an agent queues its work and removing it stops the work (100, a
 * trigger on ticket_assignees), so the hand-off chip is refreshed with the
 * ticket instead of waiting for the realtime echo.
 */
function settle(qc: QueryClient, ticketId: string) {
  invalidateTicketViews(qc, ticketId)
  qc.invalidateQueries({ queryKey: ['ai_work', ticketId] })
}

/**
 * Assignments used to wait for the round trip before the avatar appeared —
 * a visible freeze on a slow link. Both mutations now patch every cached view
 * of the ticket first and roll back if the server disagrees.
 */
export function useAddAssignee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, userId }: { ticketId: string; userId: string; user?: Profile }) => {
      const { error } = await supabase
        .from('ticket_assignees')
        .insert({ ticket_id: ticketId, user_id: userId })
      if (error && !error.message.includes('duplicate')) throw error
    },
    onMutate: async ({ ticketId, userId, user }) => {
      const snap = await snapshotTicketViews(qc, ticketId)
      if (user) {
        patchTicketEverywhere(qc, ticketId, (t) => {
          const list = (t.assignees ?? []) as AssigneeRow[]
          if (list.some((a) => a.user_id === userId)) return t
          return { ...t, assignees: [...list, { user_id: userId, user } as AssigneeRow] }
        })
      }
      return snap
    },
    onError: (_e, _v, snap) => restoreTicketViews(qc, snap),
    onSettled: (_d, _e, { ticketId }) => settle(qc, ticketId),
  })
}

export function useRemoveAssignee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, userId }: { ticketId: string; userId: string }) => {
      const { error } = await supabase
        .from('ticket_assignees')
        .delete()
        .eq('ticket_id', ticketId)
        .eq('user_id', userId)
      if (error) throw error
    },
    onMutate: async ({ ticketId, userId }) => {
      const snap = await snapshotTicketViews(qc, ticketId)
      patchTicketEverywhere(qc, ticketId, (t) => ({ ...t, assignees: ((t.assignees ?? []) as AssigneeRow[]).filter((a) => a.user_id !== userId) }))
      return snap
    },
    onError: (_e, _v, snap) => restoreTicketViews(qc, snap),
    onSettled: (_d, _e, { ticketId }) => settle(qc, ticketId),
  })
}
