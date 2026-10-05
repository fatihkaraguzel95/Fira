import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentUser } from '../lib/session'
import { supabase } from '../lib/supabase'
import type { TicketLink, LinkKind } from '../types'
import { invalidateTicketViews } from '../lib/invalidate'

const LINK_SELECT = '*, linked:tickets!ticket_links_linked_ticket_id_fkey(id, title, project_id, status_info:ticket_statuses!tickets_status_id_fkey(name, color, category, is_cancelled))'
const INCOMING_SELECT = '*, source:tickets!ticket_links_ticket_id_fkey(id, title, project_id, status_info:ticket_statuses!tickets_status_id_fkey(name, color, category, is_cancelled))'

/** Links where this ticket is the target — "blocked by", "waited on by", and the mirror of relates/duplicates. */
export function useIncomingLinks(ticketId: string | null) {
  return useQuery({
    queryKey: ['links-in', ticketId],
    enabled: !!ticketId,
    queryFn: async (): Promise<TicketLink[]> => {
      const { data, error } = await supabase.from('ticket_links').select(INCOMING_SELECT).eq('linked_ticket_id', ticketId!).order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as TicketLink[]
    },
  })
}

export function useSetLinkKind() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: LinkKind; ticketId: string; linkedTicketId: string }) => {
      const { error } = await supabase.from('ticket_links').update({ kind }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { ticketId, linkedTicketId }) => {
      qc.invalidateQueries({ queryKey: ['links', ticketId] }); qc.invalidateQueries({ queryKey: ['links-in', linkedTicketId] })
      invalidateTicketViews(qc, ticketId); invalidateTicketViews(qc, linkedTicketId)
    },
  })
}

/**
 * Swap the two ends of a directional link ("A blocks B" → "B blocks A"). The row
 * moves to the other ticket's side, so both tickets' link queries are refreshed.
 * The unique pair index rejects a swap when the mirrored row already exists.
 */
export function useFlipLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ticketId, linkedTicketId }: { id: string; ticketId: string; linkedTicketId: string }) => {
      const { error } = await supabase.from('ticket_links').update({ ticket_id: linkedTicketId, linked_ticket_id: ticketId }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { ticketId, linkedTicketId }) => {
      for (const id of [ticketId, linkedTicketId]) {
        qc.invalidateQueries({ queryKey: ['links', id] }); qc.invalidateQueries({ queryKey: ['links-in', id] })
        invalidateTicketViews(qc, id)
      }
    },
  })
}

/** "Linked tickets" — related tickets shown under the subtask list (not children). */
export function useTicketLinks(ticketId: string | null) {
  return useQuery({
    queryKey: ['links', ticketId],
    enabled: !!ticketId,
    queryFn: async (): Promise<TicketLink[]> => {
      const { data, error } = await supabase.from('ticket_links').select(LINK_SELECT).eq('ticket_id', ticketId!).order('order_index')
      if (error) throw error
      return (data ?? []) as unknown as TicketLink[]
    },
  })
}

export function useAddLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, linkedTicketId, kind = 'relates' }: { ticketId: string; linkedTicketId: string; kind?: LinkKind }) => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const { data: maxData } = await supabase.from('ticket_links').select('order_index').eq('ticket_id', ticketId).order('order_index', { ascending: false }).limit(1).maybeSingle()
      const { error } = await supabase.from('ticket_links').insert({ ticket_id: ticketId, linked_ticket_id: linkedTicketId, kind, created_by: user.id, order_index: (maxData?.order_index ?? -1) + 1 })
      if (error) throw error
    },
    onSuccess: (_d, { ticketId, linkedTicketId }) => {
      qc.invalidateQueries({ queryKey: ['links', ticketId] }); qc.invalidateQueries({ queryKey: ['links-in', linkedTicketId] })
      invalidateTicketViews(qc, ticketId); invalidateTicketViews(qc, linkedTicketId)
    },
  })
}

export function useRemoveLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string; ticketId: string; linkedTicketId?: string }) => {
      const { error } = await supabase.from('ticket_links').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { ticketId, linkedTicketId }) => {
      qc.invalidateQueries({ queryKey: ['links', ticketId] })
      if (linkedTicketId) qc.invalidateQueries({ queryKey: ['links-in', linkedTicketId] })
      invalidateTicketViews(qc, ticketId); if (linkedTicketId) invalidateTicketViews(qc, linkedTicketId)
    },
  })
}
