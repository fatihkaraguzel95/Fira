import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentUser } from '../lib/session'
import { supabase } from '../lib/supabase'
import type { Ticket, TicketPriority } from '../types'

/** Lightweight row used in the subtask list of a ticket. */
export const CHILD_SELECT = `
  id, title, status, status_id, parent_id, project_id, priority, due_date, order_index, created_by, created_at, updated_at, archived_at, description,
  status_info:ticket_statuses!tickets_status_id_fkey(id, name, color, order_index, category, is_cancelled, project_id),
  assignees:ticket_assignees(user_id, user:profiles!ticket_assignees_user_id_fkey(id, email, full_name, avatar_url, source, imported_from)),
  children:tickets!parent_id(id, status_info:ticket_statuses!tickets_status_id_fkey(category, color, is_cancelled)),
  attachments:ticket_attachments(file_url),
  comments:ticket_comments(count)
`

export function useChildTickets(parentId: string | null) {
  return useQuery({
    queryKey: ['children', parentId],
    enabled: !!parentId,
    queryFn: async (): Promise<Ticket[]> => {
      const { data, error } = await supabase
        .from('tickets')
        .select(CHILD_SELECT)
        .eq('parent_id', parentId!)
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as Ticket[]
    },
  })
}

const invalidate = (qc: ReturnType<typeof useQueryClient>, parentId: string) => {
  qc.invalidateQueries({ queryKey: ['children', parentId] })
  qc.invalidateQueries({ queryKey: ['ticket', parentId] })
  qc.invalidateQueries({ queryKey: ['tickets'] })
}

/** Create a subtask: a ticket in the same list with parent_id set. Default status = first backlog/active status. */
export function useCreateChild() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ parent, title, priority = 'medium', due_date = null }: {
      parent: Pick<Ticket, 'id' | 'project_id'>; title: string; priority?: TicketPriority | null; due_date?: string | null
    }) => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const { data: statuses } = await supabase
        .from('ticket_statuses').select('id, name, category, order_index').eq('project_id', parent.project_id!).order('order_index')
      const first = (statuses ?? []).find((s) => s.category === 'backlog') ?? (statuses ?? []).find((s) => s.category === 'active') ?? (statuses ?? [])[0]
      const { data: maxData } = await supabase
        .from('tickets').select('order_index').eq('parent_id', parent.id).order('order_index', { ascending: false }).limit(1).maybeSingle()
      const { data, error } = await supabase
        .from('tickets')
        .insert({
          title, parent_id: parent.id, project_id: parent.project_id, status: first?.name ?? 'todo', status_id: first?.id ?? null,
          priority, due_date, created_by: user.id, updated_by: user.id, order_index: (maxData?.order_index ?? -1) + 1,
        })
        .select(CHILD_SELECT)
        .single()
      if (error) throw error
      return data as unknown as Ticket
    },
    // The row shows up under the parent immediately; the real row replaces it.
    onMutate: async ({ parent, title, priority = 'medium', due_date = null }) => {
      await qc.cancelQueries({ queryKey: ['children', parent.id] })
      const previous = qc.getQueryData<Ticket[]>(['children', parent.id])
      const temp = `temp-${Date.now()}`
      const placeholder = {
        id: temp, title, parent_id: parent.id, project_id: parent.project_id, priority, due_date,
        status_id: null, status_info: null, order_index: 1e9, assignees: [], tags: [], attachments: [], children: [],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), archived_at: null, _optimistic: true,
      } as unknown as Ticket
      qc.setQueryData<Ticket[]>(['children', parent.id], (old) => [...(old ?? []), placeholder])
      return { previous, temp }
    },
    onError: (_e, { parent }, ctx) => { if (ctx) qc.setQueryData(['children', parent.id], ctx.previous) },
    onSuccess: (created, { parent }, ctx) => {
      qc.setQueryData<Ticket[]>(['children', parent.id], (old) => (old ?? []).map((t) => (t.id === ctx?.temp ? created : t)))
    },
    onSettled: (_d, _e, { parent }) => invalidate(qc, parent.id),
  })
}

export function useReorderChildren() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ parentId, ordered }: { parentId: string; ordered: Ticket[] }) => {
      qc.setQueryData(['children', parentId], ordered.map((t, i) => ({ ...t, order_index: i })))
      const results = await Promise.all(ordered.map((t, i) => supabase.from('tickets').update({ order_index: i }).eq('id', t.id)))
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
    },
    onSettled: (_d, _e, { parentId }) => invalidate(qc, parentId),
  })
}

/** Attach / detach a ticket to a parent (null = becomes a top-level ticket). */
export function useSetParent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, parentId }: { id: string; parentId: string | null; previousParentId?: string | null }) => {
      const { error } = await supabase.from('tickets').update({ parent_id: parentId }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { id, parentId, previousParentId }) => {
      if (parentId) invalidate(qc, parentId)
      if (previousParentId) invalidate(qc, previousParentId)
      qc.invalidateQueries({ queryKey: ['ticket', id] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}
