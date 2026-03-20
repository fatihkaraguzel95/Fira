import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TicketStatus } from '../types'

export function useStatuses(projectId: string | null) {
  return useQuery({
    queryKey: ['statuses', projectId],
    queryFn: async (): Promise<TicketStatus[]> => {
      if (!projectId) return []
      const { data, error } = await supabase
        .from('ticket_statuses')
        .select('*')
        .eq('project_id', projectId)
        .order('order_index')
      if (error) throw error
      return data ?? []
    },
    enabled: !!projectId,
  })
}

export function useCreateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, name, color }: { projectId: string; name: string; color: string }): Promise<TicketStatus> => {
      const { data: maxData } = await supabase
        .from('ticket_statuses')
        .select('order_index')
        .eq('project_id', projectId)
        .order('order_index', { ascending: false })
        .limit(1)
        .maybeSingle()

      const { data, error } = await supabase
        .from('ticket_statuses')
        .insert({ project_id: projectId, name, color, order_index: (maxData?.order_index ?? -1) + 1 })
        .select('*')
        .single()
      if (error) throw error
      return data as TicketStatus
    },
    onSuccess: (_d, { projectId }) => qc.invalidateQueries({ queryKey: ['statuses', projectId] }),
  })
}

export function useUpdateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name, color }: { id: string; projectId: string; name?: string; color?: string }): Promise<TicketStatus> => {
      const { data, error } = await supabase
        .from('ticket_statuses')
        .update({ name, color })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data as TicketStatus
    },
    onSuccess: (_d, { projectId }) => qc.invalidateQueries({ queryKey: ['statuses', projectId] }),
  })
}

export function useDeleteStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const { error } = await supabase.from('ticket_statuses').delete().eq('id', id)
      if (error) throw error
      return projectId
    },
    onSuccess: (_d, { projectId }) => qc.invalidateQueries({ queryKey: ['statuses', projectId] }),
  })
}

export function useReorderStatuses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates: { id: string; order_index: number; projectId: string }[]) => {
      await Promise.all(
        updates.map(({ id, order_index }) =>
          supabase.from('ticket_statuses').update({ order_index }).eq('id', id)
        )
      )
      return updates[0]?.projectId
    },
    onSuccess: (_d, updates) => qc.invalidateQueries({ queryKey: ['statuses', updates[0]?.projectId] }),
  })
}
