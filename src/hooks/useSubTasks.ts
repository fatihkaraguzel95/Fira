import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { SubTask, UpdateSubTaskInput } from '../types'

export function useSubTasks(ticketId: string) {
  return useQuery({
    queryKey: ['subtasks', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_subtasks')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('order_index', { ascending: true })
      if (error) throw error
      return (data ?? []) as SubTask[]
    },
    enabled: !!ticketId,
  })
}

export function useCreateSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, title }: { ticketId: string; title: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const { data: maxData } = await supabase
        .from('ticket_subtasks')
        .select('order_index')
        .eq('ticket_id', ticketId)
        .order('order_index', { ascending: false })
        .limit(1)
        .maybeSingle()

      const orderIndex = (maxData?.order_index ?? -1) + 1

      const { data, error } = await supabase
        .from('ticket_subtasks')
        .insert({ ticket_id: ticketId, title, created_by: user.id, order_index: orderIndex })
        .select()
        .single()
      if (error) throw error
      return data as SubTask
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['subtasks', vars.ticketId] }),
  })
}

export function useToggleSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ticketId, is_done }: { id: string; ticketId: string; is_done: boolean }) => {
      const { error } = await supabase
        .from('ticket_subtasks')
        .update({ is_done })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['subtasks', vars.ticketId] }),
  })
}

export function useUpdateSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ticketId, input }: { id: string; ticketId: string; input: UpdateSubTaskInput }) => {
      const { error } = await supabase.from('ticket_subtasks').update(input).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['subtasks', vars.ticketId] }),
  })
}

export function useDeleteSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ticketId }: { id: string; ticketId: string }) => {
      const { error } = await supabase.from('ticket_subtasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['subtasks', vars.ticketId] }),
  })
}
