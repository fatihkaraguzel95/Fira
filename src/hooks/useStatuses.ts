import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TicketStatus, StatusCategory } from '../types'
import { insertionIndex } from '../lib/statusOrder'

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
    mutationFn: async ({ projectId, name, color, category = 'active', isCancelled = false }: {
      projectId: string; name: string; color: string; category?: StatusCategory; isCancelled?: boolean
    }): Promise<TicketStatus> => {
      // Yeni durum kendi kategorisinin sonuna girer (#bc239e3c); arkasındakiler bir
      // kayar, kendi aralarındaki sıra değişmez. Eskiden hep en sona ekleniyordu.
      const { data: current, error: readErr } = await supabase
        .from('ticket_statuses')
        .select('id, category, is_cancelled, order_index')
        .eq('project_id', projectId)
        .order('order_index')
      if (readErr) throw readErr
      const list = (current ?? []) as Pick<TicketStatus, 'id' | 'category' | 'is_cancelled' | 'order_index'>[]
      const at = insertionIndex(list, { category, is_cancelled: isCancelled })
      const shifts = list
        .map((s, i) => ({ id: s.id, from: s.order_index, to: i < at ? i : i + 1 }))
        .filter((x) => x.from !== x.to)
      if (shifts.length) {
        const results = await Promise.all(shifts.map((x) => supabase.from('ticket_statuses').update({ order_index: x.to }).eq('id', x.id)))
        const failed = results.find((r) => r.error)
        if (failed?.error) throw failed.error
      }

      const { data, error } = await supabase
        .from('ticket_statuses')
        .insert({ project_id: projectId, name, color, category, is_cancelled: isCancelled, order_index: at })
        .select('*')
        .single()
      if (error) throw error
      return data as TicketStatus
    },
    // Sıra kaydığı için pano sütunları ve görevlerdeki durum bilgisi de tazelenir.
    onSuccess: (_d, { projectId }) => { qc.invalidateQueries({ queryKey: ['statuses', projectId] }); qc.invalidateQueries({ queryKey: ['tickets'] }) },
  })
}

export function useUpdateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name, color, category, isCancelled }: {
      id: string; projectId: string; name?: string; color?: string; category?: StatusCategory; isCancelled?: boolean
    }): Promise<TicketStatus> => {
      const patch: Record<string, unknown> = {}
      if (name !== undefined) patch.name = name
      if (color !== undefined) patch.color = color
      if (category !== undefined) patch.category = category
      if (isCancelled !== undefined) patch.is_cancelled = isCancelled
      const { data, error } = await supabase
        .from('ticket_statuses')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data as TicketStatus
    },
    onSuccess: (_d, { projectId }) => { qc.invalidateQueries({ queryKey: ['statuses', projectId] }); qc.invalidateQueries({ queryKey: ['tickets'] }) },
  })
}

export function useDeleteStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, projectId, moveTo }: { id: string; projectId: string; moveTo?: string | null }) => {
      // Tickets in the deleted status are moved to another status first (never orphaned)
      if (moveTo) {
        const target = await supabase.from('ticket_statuses').select('name').eq('id', moveTo).single()
        const { error: mErr } = await supabase.from('tickets').update({ status_id: moveTo, status: target.data?.name ?? '' }).eq('status_id', id)
        if (mErr) throw mErr
      }
      const { error } = await supabase.from('ticket_statuses').delete().eq('id', id)
      if (error) throw error
      return projectId
    },
    onSuccess: (_d, { projectId }) => { qc.invalidateQueries({ queryKey: ['statuses', projectId] }); qc.invalidateQueries({ queryKey: ['tickets'] }) },
  })
}

export function useReorderStatuses() {
  const qc = useQueryClient()
  return useMutation({
    // Optimistic: reflect the new order immediately so a dropped column stays where it was dropped
    onMutate: async (updates) => {
      const projectId = updates[0]?.projectId
      if (!projectId) return
      await qc.cancelQueries({ queryKey: ['statuses', projectId] })
      const previous = qc.getQueryData<TicketStatus[]>(['statuses', projectId])
      const order = new Map(updates.map((u) => [u.id, u.order_index]))
      qc.setQueryData<TicketStatus[]>(['statuses', projectId], (old) =>
        (old ?? []).map((s) => ({ ...s, order_index: order.get(s.id) ?? s.order_index })).sort((a, b) => a.order_index - b.order_index),
      )
      return { previous, projectId }
    },
    onError: (_e, _v, ctx) => { if (ctx?.previous) qc.setQueryData(['statuses', ctx.projectId], ctx.previous) },
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

/**
 * Ticket count per status of a list — including archived ones and subtasks,
 * because deleting a status has to account for every row that points at it.
 * Used to skip the "where should these move?" question when there is nothing to move.
 */
export function useStatusTicketCounts(projectId: string | null) {
  return useQuery({
    queryKey: ['status-counts', projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.from('tickets').select('status_id').eq('project_id', projectId!)
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const t of data ?? []) if (t.status_id) counts[t.status_id] = (counts[t.status_id] ?? 0) + 1
      return counts
    },
  })
}
