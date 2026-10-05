import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentUser } from '../lib/session'
import { supabase } from '../lib/supabase'
import type { TicketAttachment } from '../types'
import { removeStorageUrls } from '../lib/storage'
import { uploadWithProgress } from '../lib/uploads'

export function useAttachments(ticketId: string) {
  return useQuery({
    queryKey: ['attachments', ticketId],
    queryFn: async (): Promise<TicketAttachment[]> => {
      const { data, error } = await supabase
        .from('ticket_attachments')
        .select('*, uploader:profiles!ticket_attachments_uploaded_by_fkey(id, email, full_name, avatar_url, source, imported_from)')
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
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const timestamp = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${user.id}/${ticketId}/${timestamp}-${safeName}`

      // XHR with progress (#FB541A31): the Files panel and the editor show the bar.
      const publicUrl = await uploadWithProgress(file, path, ticketId)

      const { data, error: dbError } = await supabase
        .from('ticket_attachments')
        .insert({
          ticket_id: ticketId,
          file_url: publicUrl,
          file_name: file.name,
          uploaded_by: user.id,
        })
        .select('*, uploader:profiles!ticket_attachments_uploaded_by_fkey(id, email, full_name, avatar_url, source, imported_from)')
        .single()

      if (dbError) throw dbError
      return data as TicketAttachment
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['attachments', ticketId] }); qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

/** Register an already-uploaded file (e.g. an image pasted into the description) as an attachment. */
export function useAttachRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, fileUrl, fileName }: { ticketId: string; fileUrl: string; fileName: string }) => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const { error } = await supabase
        .from('ticket_attachments')
        .insert({ ticket_id: ticketId, file_url: fileUrl, file_name: fileName, uploaded_by: user.id })
      if (error) throw error
    },
    onSuccess: (_d, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['attachments', ticketId] }); qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useRenameAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ticketId, fileName }: { id: string; ticketId: string; fileName: string }) => {
      const { error } = await supabase.from('ticket_attachments').update({ file_name: fileName }).eq('id', id)
      if (error) throw error
      return ticketId
    },
    onSuccess: (_d, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['attachments', ticketId] }); qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ticketId }: { id: string; ticketId: string }) => {
      // The record is the source of truth; the file goes right after it (best
      // effort — storage RLS may refuse a file someone else uploaded, and the
      // admin's orphan cleanup picks those up).
      const { data: row } = await supabase.from('ticket_attachments').select('file_url').eq('id', id).maybeSingle()
      const { error } = await supabase
        .from('ticket_attachments')
        .delete()
        .eq('id', id)
      if (error) throw error
      await removeStorageUrls([row?.file_url])
      return ticketId
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['attachments', ticketId] }); qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}
