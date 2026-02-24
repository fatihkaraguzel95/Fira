import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TicketAttachment } from '../types'

export function useAttachments(ticketId: string) {
  return useQuery({
    queryKey: ['attachments', ticketId],
    queryFn: async (): Promise<TicketAttachment[]> => {
      const { data, error } = await supabase
        .from('ticket_attachments')
        .select('*, uploader:profiles!ticket_attachments_uploaded_by_fkey(id, email, full_name, avatar_url)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as TicketAttachment[]
    },
    enabled: !!ticketId,
  })
}

export function useUpload() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ file, ticketId }: { file: File; ticketId: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const timestamp = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${user.id}/${ticketId}/${timestamp}-${safeName}`

      const { error: uploadError } = await supabase.storage
        .from('ticket-attachments')
        .upload(path, file)
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('ticket-attachments')
        .getPublicUrl(path)

      const { data, error: dbError } = await supabase
        .from('ticket_attachments')
        .insert({
          ticket_id: ticketId,
          file_url: publicUrl,
          file_name: file.name,
          uploaded_by: user.id,
        })
        .select('*, uploader:profiles!ticket_attachments_uploaded_by_fkey(id, email, full_name, avatar_url)')
        .single()

      if (dbError) throw dbError
      return data as TicketAttachment
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['attachments', ticketId] })
    },
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ticketId }: { id: string; ticketId: string }) => {
      const { error } = await supabase
        .from('ticket_attachments')
        .delete()
        .eq('id', id)
      if (error) throw error
      return ticketId
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['attachments', ticketId] })
    },
  })
}
