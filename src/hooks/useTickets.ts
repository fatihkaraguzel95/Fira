import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { currentUser } from '../lib/session'
import { ConflictError } from '../lib/errorMessage'
import { supabase } from '../lib/supabase'
import { invalidateTicketViews } from '../lib/invalidate'
import { patchTicketEverywhere, snapshotTicketViews, restoreTicketViews, insertTicketEverywhere } from '../lib/optimistic'
import type { Ticket, CreateTicketInput, UpdateTicketInput, TicketFilters } from '../types'

const TICKET_SELECT = `
  *,
  status_info:ticket_statuses!tickets_status_id_fkey(id, name, color, order_index, category, is_cancelled, project_id),
  assignee:profiles!tickets_assignee_id_fkey(id, email, full_name, avatar_url, source, imported_from),
  creator:profiles!tickets_created_by_fkey(id, email, full_name, avatar_url, source, imported_from),
  updater:profiles!tickets_updated_by_fkey(id, email, full_name, avatar_url, source, imported_from),
  assignees:ticket_assignees(user_id, user:profiles!ticket_assignees_user_id_fkey(id, email, full_name, avatar_url, source, imported_from)),
  tags:ticket_tag_assignments(tag:tags!ticket_tag_assignments_tag_id_fkey(id, name, color)),
  blockers:ticket_links!ticket_links_linked_ticket_id_fkey(kind, source:tickets!ticket_links_ticket_id_fkey(id, status_info:ticket_statuses!tickets_status_id_fkey(category, is_cancelled))),
  children:tickets!parent_id(id, status_info:ticket_statuses!tickets_status_id_fkey(category, color, is_cancelled)),
  attachments:ticket_attachments(file_url),
  comments:ticket_comments(count),
  checklist:ticket_checklist_items(id, title, done, order_index)
`

/**
 * What the board and the list view actually render — deliberately narrower than
 * `TICKET_SELECT`, which serves the open ticket (#B98717D4).
 *
 * Measured on a 200-ticket list: the full select is 445 kB, this one 231 kB.
 * Three things were paid for and never drawn:
 *   - `creator` / `updater` — only the open ticket names them (−25%)
 *   - `description` — the card shows a dot, not the text, so `has_description`
 *     (a generated column, 063) replaces it (−18%)
 *   - the wide profile projection — a card needs a face and a name, and
 *     `source` for the imported-person ring; e-mail and `imported_from` are the
 *     open ticket's business.
 * `attachments` keeps `file_url` because the card counts *images*, which means
 * looking at the extension.
 */
const CARD_PROFILE = 'id, full_name, avatar_url, source'
const TICKET_LIST_COLUMNS = `
  id, title, status_id, priority, due_date, order_index, parent_id, project_id,
  archived_at, cover_url, has_description, created_at, updated_at, created_by, updated_by, checklist_on_board
`
/** Optional embeds a list may skip when no visible column needs them (TL-12). */
export interface ListFields { tags?: boolean; blockers?: boolean; attachments?: boolean; deadlines?: boolean; comments?: boolean; creator?: boolean; checklist?: boolean }
export const ALL_LIST_FIELDS: Required<ListFields> = { tags: true, blockers: true, attachments: true, deadlines: true, comments: true, creator: true, checklist: true }
export const listFieldsKey = (f: ListFields) => Object.entries(f).filter(([, v]) => v).map(([k]) => k).sort().join(',')

export const listSelectFor = (innerAssignees: boolean, f: ListFields) => `
  ${TICKET_LIST_COLUMNS},
  status_info:ticket_statuses!tickets_status_id_fkey(id, name, color, order_index, category, is_cancelled, project_id),
  assignees:ticket_assignees${innerAssignees ? '!inner' : ''}(user_id, user:profiles!ticket_assignees_user_id_fkey(${CARD_PROFILE}))${f.tags ? `,
  tags:ticket_tag_assignments(tag:tags!ticket_tag_assignments_tag_id_fkey(id, name, color))` : ''}${f.blockers ? `,
  blockers:ticket_links!ticket_links_linked_ticket_id_fkey(kind, source:tickets!ticket_links_ticket_id_fkey(id, status_info:ticket_statuses!tickets_status_id_fkey(category, is_cancelled)))` : ''},
  children:tickets!parent_id(id, status_info:ticket_statuses!tickets_status_id_fkey(category, color, is_cancelled))${f.attachments ? `,
  attachments:ticket_attachments(file_url)` : ''}${f.deadlines ? `,
  deadlines:ticket_deadlines(date)` : ''}${f.comments ? `,
  comments:ticket_comments(count)` : ''}${f.creator ? `,
  creator:profiles!tickets_created_by_fkey(${CARD_PROFILE})` : ''}${f.checklist ? `,
  checklist:ticket_checklist_items(id, title, done, order_index)` : ''}
`
export const listSelect = (innerAssignees: boolean) => listSelectFor(innerAssignees, ALL_LIST_FIELDS)

async function fetchTickets(filters?: TicketFilters): Promise<Ticket[]> {
  const selectStr = listSelect(!!filters?.assignee_ids?.length)

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
  if (filters?.assignee_ids?.length) {
    query = query.in('ticket_assignees.user_id', filters.assignee_ids)
  }
  if (filters?.search) {
    query = query.ilike('title', `%${filters.search}%`)
  }
  if (!filters?.include_archived) {
    query = query.is('archived_at', null)
  }

  // PostgREST caps a response at 1000 rows and says nothing; a list past that
  // size silently lost its tail (found with 1070 rows, TL-12). Page through.
  const PAGE = 1000
  const out: Ticket[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as Ticket[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * The board / list query. It will not run without a list to scope it.
 *
 * `BoardPage` renders before the saved "last list" preference has arrived, and
 * an unscoped call fetched every ticket the user can see in every team: 1.5 MB
 * of rows the screen never displays, on every cold load, growing with the whole
 * organisation's data (#B98717D4). Refusing here rather than at the call site
 * means a future caller cannot reintroduce it by accident.
 */
export function useTickets(filters?: TicketFilters) {
  return useQuery({
    queryKey: ['tickets', filters ?? {}],
    queryFn: () => fetchTickets(filters),
    enabled: !!filters?.project_id,
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
      const user = await currentUser()
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

      const { data: edge } = await supabase
        .from('tickets')
        .select('order_index')
        .eq('status_id', input.status_id ?? '')
        .order('order_index', { ascending: input.place === 'top' })
        .limit(1)
        .maybeSingle()

      const orderIndex = input.place === 'top' ? (edge?.order_index ?? 1) - 1 : (edge?.order_index ?? -1) + 1

      const { assignee_ids, tag_ids, place: _place, ...rest } = input
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
    // The new card appears at once (a temporary id, swapped for the real row on success).
    onMutate: async (input) => {
      const temp = `temp-${Date.now()}`
      const user = await currentUser()
      const placeholder = {
        id: temp,
        title: input.title,
        description: input.description ?? null,
        status_id: input.status_id ?? null,
        project_id: input.project_id,
        parent_id: input.parent_id ?? null,
        priority: input.priority ?? 'medium',
        due_date: input.due_date ?? null,
        order_index: input.place === 'top' ? -1e9 : 1e9,
        created_by: user?.id ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        archived_at: null,
        assignees: [],
        tags: [],
        attachments: [],
        children: [],
        _optimistic: true,
      } as unknown as Ticket
      insertTicketEverywhere(qc, placeholder)
      return { temp }
    },
    onError: (_e, _v, ctx) => { if (ctx?.temp) patchTicketEverywhere(qc, ctx.temp, () => null) },
    onSuccess: (ticket, _v, ctx) => { if (ctx?.temp) patchTicketEverywhere(qc, ctx.temp, () => ticket) },
    onSettled: () => invalidateTicketViews(qc),
  })
}

export function useUpdateTicket() {
  const qc = useQueryClient()
  return useMutation({
    // `expectedUpdatedAt` turns the write into optimistic concurrency: the row is
    // updated only if it still carries the version the edit started from. If it
    // moved (someone else saved first), zero rows match and we raise a
    // ConflictError instead of clobbering their change — the caller resolves it
    // in place, keeping the user's draft. Without it, last-write-wins as before.
    mutationFn: async ({ id, input, expectedUpdatedAt }: { id: string; input: UpdateTicketInput; expectedUpdatedAt?: string }) => {
      const user = await currentUser()
      let q = supabase
        .from('tickets')
        .update({ ...input, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
        .eq('id', id)
      if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt)
      const { data, error } = await q.select(TICKET_SELECT).maybeSingle()
      if (error) throw error
      if (!data) {
        if (expectedUpdatedAt) throw new ConflictError()
        throw new Error('Görev bulunamadı')  // unguarded: row is really gone
      }
      return data as unknown as Ticket
    },
    // Scalar fields (status, priority, title, due date…) show up immediately;
    // the server's row replaces the guess when it lands, or the guess is undone.
    // The stamp is left alone: the server's trigger sets it, and an invented one
    // would move the modal's conflict baseline onto a value no row ever had.
    onMutate: async ({ id, input }) => {
      const snap = await snapshotTicketViews(qc, id)
      const user = await currentUser()
      patchTicketEverywhere(qc, id, (t) => ({ ...t, ...(input as Partial<Ticket>), updated_by: user?.id ?? t.updated_by }))
      return snap
    },
    onError: (_e, _v, snap) => restoreTicketViews(qc, snap),
    onSuccess: (updated) => {
      qc.setQueryData(['ticket', updated.id], updated)
    },
    onSettled: (_d, _e, { id }) => invalidateTicketViews(qc, id),
  })
}

/** Server-side copy (078): subtasks, assignees, tags, attachment rows and deadlines come along. Returns the new id. */
export function useCopyTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, projectId }: { ticketId: string; projectId?: string | null }) => {
      const { data, error } = await supabase.rpc('copy_ticket', { p_ticket: ticketId, p_project: projectId ?? null })
      if (error) throw error
      return data as string
    },
    onSettled: () => { invalidateTicketViews(qc); qc.invalidateQueries({ queryKey: ['tickets'] }) },
  })
}

/** Server-side move to another list of the same team (078): subtasks follow, tags are matched by name. */
export function useMoveTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, projectId }: { ticketId: string; projectId: string }) => {
      const { error } = await supabase.rpc('move_ticket', { p_ticket: ticketId, p_project: projectId })
      if (error) throw error
    },
    onSettled: (_d, _e, { ticketId }) => { invalidateTicketViews(qc, ticketId); qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['children'] }) },
  })
}

export function useDeleteTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tickets').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateTicketViews(qc),
  })
}

function getLocalArchived(): Set<string> {
  try {
    const raw = localStorage.getItem('fira_archived_tickets')
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function setLocalArchived(ids: Set<string>) {
  localStorage.setItem('fira_archived_tickets', JSON.stringify([...ids]))
}

export function useArchiveTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      // Always update localStorage (works without migration)
      const ids = getLocalArchived()
      if (archived) ids.add(id)
      else ids.delete(id)
      setLocalArchived(ids)
      // Also try Supabase silently (works after migration 021)
      supabase
        .from('tickets')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id)
        .then(() => {}, () => {})
    },
    onSuccess: () => invalidateTicketViews(qc),
  })
}

export function getLocalArchivedIds(): Set<string> {
  return getLocalArchived()
}

/**
 * Drag & drop ordering. One request for the whole gesture (it used to be an
 * UPDATE per card) and, more importantly, the server keeps the cards the board
 * cannot see — the ones a filter hides — below the visible ones instead of
 * letting them interleave. `reorder_tickets` also tells the "new status goes to
 * the top" trigger to stand back: a dropped card stays where it was dropped.
 */
export function useReorderTickets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (columns: { status_id: string; ids: string[] }[]) => {
      const { error } = await supabase.rpc('reorder_tickets', { p_columns: columns })
      if (error) throw error
    },
    onSettled: () => invalidateTicketViews(qc),
  })
}
