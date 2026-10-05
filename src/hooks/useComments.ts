import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { currentUser } from '../lib/session'
import { supabase } from '../lib/supabase'
import { invalidateTicketViews } from '../lib/invalidate'
import type { TicketComment, CommentAction } from '../types'

export function useComments(ticketId: string) {
  return useQuery({
    queryKey: ['comments', ticketId],
    queryFn: async (): Promise<TicketComment[]> => {
      const { data, error } = await supabase
        .from('ticket_comments')
        .select('*, author:profiles!ticket_comments_author_id_fkey(id, email, full_name, avatar_url, source, imported_from)')
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
    mutationFn: async ({ ticketId, content, action }: { ticketId: string; content: string; action?: CommentAction | null }) => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const { data, error } = await supabase
        .from('ticket_comments')
        .insert({ ticket_id: ticketId, author_id: user.id, content, action: action ?? null })
        .select('*, author:profiles!ticket_comments_author_id_fkey(id, email, full_name, avatar_url, source, imported_from)')
        .single()
      if (error) throw error
      return data as TicketComment
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['comments', ticketId] }); invalidateTicketViews(qc, ticketId)
    },
  })
}

/**
 * Yorumu düzelt (#5d077b0e). RLS yalnız yazarına izin veriyor (028); damga
 * sunucu saatinden değil, istemciden gider — `edited_at` yalnız "düzenlendi"
 * işaretini çizmek için. Metinden düşen dosyalar çağıran tarafın
 * `pruneDroppedFiles` çağrısıyla toplanır (silme yolunda olduğu gibi).
 */
export function useUpdateComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ticketId, content }: { id: string; ticketId: string; content: string }) => {
      const { error } = await supabase
        .from('ticket_comments')
        .update({ content, edited_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      return ticketId
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['comments', ticketId] }); invalidateTicketViews(qc, ticketId)
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
      qc.invalidateQueries({ queryKey: ['comments', ticketId] }); invalidateTicketViews(qc, ticketId)
    },
  })
}
