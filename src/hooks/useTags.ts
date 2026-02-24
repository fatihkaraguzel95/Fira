import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Tag } from '../types'

export function useTags(projectId: string | null) {
  return useQuery({
    queryKey: ['tags', projectId],
    queryFn: async (): Promise<Tag[]> => {
      if (!projectId) return []
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('project_id', projectId)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!projectId,
  })
}

export function useCreateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, name, color }: { projectId: string; name: string; color: string }): Promise<Tag> => {
      const { data, error } = await supabase
        .from('tags')
        .insert({ project_id: projectId, name, color })
        .select('*')
        .single()
      if (error) throw error
      return data as Tag
    },
    onSuccess: (_d, { projectId }) => qc.invalidateQueries({ queryKey: ['tags', projectId] }),
  })
}

export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const { error } = await supabase.from('tags').delete().eq('id', id)
      if (error) throw error
      return projectId
    },
    onSuccess: (_d, { projectId }) => qc.invalidateQueries({ queryKey: ['tags', projectId] }),
  })
}

// ─── Ticket ↔ Tag assignments ─────────────────────────────────────────────────
export function useAssignTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, tagId }: { ticketId: string; tagId: string }) => {
      const { error } = await supabase
        .from('ticket_tag_assignments')
        .insert({ ticket_id: ticketId, tag_id: tagId })
      if (error && !error.message.includes('duplicate')) throw error
    },
    onSuccess: (_d, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useUnassignTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, tagId }: { ticketId: string; tagId: string }) => {
      const { error } = await supabase
        .from('ticket_tag_assignments')
        .delete()
        .eq('ticket_id', ticketId)
        .eq('tag_id', tagId)
      if (error) throw error
    },
    onSuccess: (_d, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}
