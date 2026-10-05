import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { currentUser } from '../lib/session'
import { supabase } from '../lib/supabase'
import { invalidateTicketViews } from '../lib/invalidate'
import type { AiWorkRequest, Profile } from '../types'

/**
 * AI work hand-off (059). A ticket is handed to an AI agent (a profile with
 * `is_ai`) by a request row here. Two things write one: the "Claude'a yaptır"
 * button below, and — since 100 — assigning the agent (a trigger on
 * ticket_assignees, unless the agent's owner turned it off). Removing the
 * assignment cancels the open request. The agent's listener picks the row up
 * and moves it pending → processing → done. Live updates arrive via
 * useRealtimeSync (table `ai_work_requests`).
 */
const OPEN: AiWorkRequest['status'][] = ['pending', 'processing']

/** The latest hand-off request for a ticket (any status), or null. */
export function useTicketAiWork(ticketId: string | null) {
  return useQuery({
    queryKey: ['ai_work', ticketId],
    queryFn: async (): Promise<AiWorkRequest | null> => {
      const { data, error } = await supabase
        .from('ai_work_requests')
        .select('*')
        .eq('ticket_id', ticketId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as AiWorkRequest | null) ?? null
    },
    enabled: !!ticketId,
  })
}

/**
 * The pulse of the run behind a request that is being worked on (103): when the
 * agent was last heard from and what it says it is doing. The chip uses it to
 * tell "working" from "its listener went away" and to show the current step.
 * Asked again every minute — the run table is not on the realtime channel.
 */
export function useAiRunPulse(requestId: string | null) {
  const { data } = useQuery({
    queryKey: ['ai_runs', 'pulse', requestId],
    enabled: !!requestId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_runs')
        .select('outcome, started_at, heartbeat_at, step')
        .eq('request_id', requestId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as { outcome: 'running' | 'done' | 'failed' | 'cancelled'; started_at: string; heartbeat_at: string | null; step: string | null } | null
    },
  })
  return data ?? null
}

/** Whether a request is still open (queued or being worked on). */
export const isAiWorkOpen = (r: AiWorkRequest | null | undefined) => !!r && OPEN.includes(r.status)

/**
 * Hand a ticket to the AI agent: record an explicit pending request and assign
 * the agent so the board shows who is on it. The unique index (059) makes a
 * second click while one is open a no-op.
 */
export function useRequestAiWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, aiUser, todo }: { ticketId: string; aiUser: Profile; todo?: { id: string; name: string } | null }) => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const { data, error } = await supabase
        .from('ai_work_requests')
        .insert({ ticket_id: ticketId, requested_by: user.id, ai_user_id: aiUser.id, status: 'pending' })
        .select('*')
        .single()
      // A duplicate open request (unique index) just means it is already queued.
      if (error && !/duplicate|unique/i.test(error.message)) throw error

      // Assign the agent (ignore a duplicate assignment).
      const { error: aErr } = await supabase
        .from('ticket_assignees')
        .insert({ ticket_id: ticketId, user_id: aiUser.id })
      if (aErr && !/duplicate/i.test(aErr.message)) throw aErr

      // Handing off queues the work: move the ticket into the "to do" column too.
      if (todo) {
        const { error: sErr } = await supabase
          .from('tickets')
          .update({ status_id: todo.id, status: todo.name, updated_at: new Date().toISOString(), updated_by: user.id })
          .eq('id', ticketId)
        if (sErr) throw sErr
      }

      return (data as AiWorkRequest | null) ?? null
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['ai_work', ticketId] })
      invalidateTicketViews(qc, ticketId)
    },
  })
}

/** Cancel an open hand-off request (before the agent picks it up, or to stop it). */
export function useCancelAiWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string; ticketId: string }) => {
      const { error } = await supabase.from('ai_work_requests').update({ status: 'cancelled' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['ai_work', ticketId] })
      invalidateTicketViews(qc, ticketId)
    },
  })
}
