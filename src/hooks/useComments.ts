import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TicketComment } from '../types'

export function useComments(ticketId: string) {
  return useQuery({
    queryKey: ['comments', ticketId],
    queryFn: async (): Promise<TicketComment[]> => {
      const { data, error } = await supabase
        .from('ticket_comments')
        .select('*, author:profiles!ticket_comments_author_id_fkey(id, email, full_name, avatar_url)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as TicketComment[]
    },
    enabled: !!ticketId,
  })
}

export function useAddComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, content }: { ticketId: string; content: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const { data, error } = await supabase
        .from('ticket_comments')
        .insert({ ticket_id: ticketId, author_id: user.id, content })
        .select('*, author:profiles!ticket_comments_author_id_fkey(id, email, full_name, avatar_url)')
        .single()
      if (error) throw error
      return data as TicketComment
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['comments', ticketId] })
    },
  })
}

export function useDeleteComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ticketId }: { id: string; ticketId: string }) => {
      const { error } = await supabase.from('ticket_comments').delete().eq('id', id)
      if (error) throw error
      return ticketId
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['comments', ticketId] })
    },
  })
}
