import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Ticket, CreateTicketInput, UpdateTicketInput, TicketFilters } from '../types'

const TICKET_SELECT = `
  *,
  status_info:ticket_statuses!tickets_status_id_fkey(id, name, color, order_index),
  assignee:profiles!tickets_assignee_id_fkey(id, email, full_name, avatar_url),
  creator:profiles!tickets_created_by_fkey(id, email, full_name, avatar_url),
  updater:profiles!tickets_updated_by_fkey(id, email, full_name, avatar_url),
  assignees:ticket_assignees(user_id, user:profiles!ticket_assignees_user_id_fkey(id, email, full_name, avatar_url)),
  tags:ticket_tag_assignments(tag:tags!ticket_tag_assignments_tag_id_fkey(id, name, color))
`

// !inner converts to INNER JOIN so PostgREST filters the parent row too
const TICKET_SELECT_WITH_ASSIGNEE_FILTER = `
  *,
  status_info:ticket_statuses!tickets_status_id_fkey(id, name, color, order_index),
  assignee:profiles!tickets_assignee_id_fkey(id, email, full_name, avatar_url),
  creator:profiles!tickets_created_by_fkey(id, email, full_name, avatar_url),
  updater:profiles!tickets_updated_by_fkey(id, email, full_name, avatar_url),
  assignees:ticket_assignees!inner(user_id, user:profiles!ticket_assignees_user_id_fkey(id, email, full_name, avatar_url)),
  tags:ticket_tag_assignments(tag:tags!ticket_tag_assignments_tag_id_fkey(id, name, color))
`

async function fetchTickets(filters?: TicketFilters): Promise<Ticket[]> {
  const selectStr = filters?.assignee_id ? TICKET_SELECT_WITH_ASSIGNEE_FILTER : TICKET_SELECT

  let query = supabase
    .from('tickets')
    .select(selectStr)
    .order('order_index', { ascending: true })

  if (filters?.project_id) {
    query = query.eq('project_id', filters.project_id)
  }
  if (filters?.status_id && filters.status_id.length > 0) {
    query = query.in('status_id', filters.status_id)
  }
  if (filters?.priority && filters.priority.length > 0) {
    query = query.in('priority', filters.priority)
  }
  if (filters?.assignee_id) {
    query = query.eq('ticket_assignees.user_id', filters.assignee_id)
  }
  if (filters?.search) {
    query = query.ilike('title', `%${filters.search}%`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as Ticket[]
}

export function useTickets(filters?: TicketFilters) {
  return useQuery({
    queryKey: ['tickets', filters ?? {}],
    queryFn: () => fetchTickets(filters),
  })
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select(TICKET_SELECT)
        .eq('id', id)
        .single()
      if (error) throw error
      return data as unknown as Ticket
    },
    enabled: !!id,
  })
}

export function useCreateTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTicketInput) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()
      if (!existingProfile) {
        await supabase.from('profiles').insert({
          id: user.id,
          email: user.email ?? '',
          full_name: user.user_metadata?.full_name ?? null,
        })
      }

      const { data: maxData } = await supabase
        .from('tickets')
        .select('order_index')
        .eq('status_id', input.status_id ?? '')
        .order('order_index', { ascending: false })
        .limit(1)
        .maybeSingle()

      const orderIndex = (maxData?.order_index ?? -1) + 1

      const { assignee_ids, tag_ids, ...rest } = input
      const { data: ticket, error } = await supabase
        .from('tickets')
        .insert({ ...rest, created_by: user.id, order_index: orderIndex })
        .select(TICKET_SELECT)
        .single()
      if (error) throw error

      if (assignee_ids && assignee_ids.length > 0) {
        await supabase.from('ticket_assignees').insert(
          assignee_ids.map(uid => ({ ticket_id: (ticket as { id: string }).id, user_id: uid }))
        )
      }

      if (tag_ids && tag_ids.length > 0) {
        await supabase.from('ticket_tag_assignments').insert(
          tag_ids.map(tid => ({ ticket_id: (ticket as { id: string }).id, tag_id: tid }))
        )
      }

      return ticket as unknown as Ticket
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

export function useUpdateTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateTicketInput }) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('tickets')
        .update({ ...input, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
        .eq('id', id)
        .select(TICKET_SELECT)
        .single()
      if (error) throw error
      return data as unknown as Ticket
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['tickets'] })
      qc.setQueryData(['ticket', updated.id], updated)
    },
  })
}

export function useDeleteTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tickets').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

export function useReorderTickets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates: { id: string; status_id: string; order_index: number }[]) => {
      const { data: { user } } = await supabase.auth.getUser()
      await Promise.all(
        updates.map(({ id, status_id, order_index }) =>
          supabase
            .from('tickets')
            .update({ status_id, order_index, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
            .eq('id', id)
        )
      )
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] })
      qc.invalidateQueries({ queryKey: ['ticket'] })
    },
  })
}
