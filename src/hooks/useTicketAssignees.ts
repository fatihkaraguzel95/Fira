import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useAddAssignee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, userId }: { ticketId: string; userId: string }) => {
      const { error } = await supabase
        .from('ticket_assignees')
        .insert({ ticket_id: ticketId, user_id: userId })
      if (error && !error.message.includes('duplicate')) throw error
    },
    onSuccess: (_d, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
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
    onSuccess: (_d, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}
