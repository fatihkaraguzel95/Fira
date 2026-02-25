import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TicketDeadline } from '../types'

export function useTicketDeadlines(ticketId: string) {
  return useQuery({
    queryKey: ['deadlines', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_deadlines')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('date', { ascending: true })
      if (error) throw error
      return (data ?? []) as TicketDeadline[]
    },
    enabled: !!ticketId,
  })
}

export function useAddDeadline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, date, description }: { ticketId: string; date: string; description?: string }) => {
      const { data, error } = await supabase
        .from('ticket_deadlines')
        .insert({ ticket_id: ticketId, date, description: description || null })
        .select()
        .single()
      if (error) throw error
      return data as TicketDeadline
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['deadlines', vars.ticketId] }),
  })
}

export function useDeleteDeadline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ticketId }: { id: string; ticketId: string }) => {
      const { error } = await supabase.from('ticket_deadlines').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['deadlines', vars.ticketId] }),
  })
}
