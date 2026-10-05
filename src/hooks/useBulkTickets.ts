import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseBulk } from '../lib/supabase'
import { currentUser } from '../lib/session'
import { invalidateTicketViews } from '../lib/invalidate'
import { patchTicketEverywhere, snapshotTicketViews, restoreTicketViews } from '../lib/optimistic'
import type { Ticket, UpdateTicketInput, LinkKind } from '../types'

/**
 * Bulk changes for the list's selection (#883CF8 / TL-08).
 *
 * One request per action, not one per ticket: PostgREST takes `in(id, …)` for
 * updates/deletes and many rows in one insert for assignments and tags. RLS is
 * the permission check — rows the viewer may not write are simply not
 * touched, and the caller compares counts. The activity log stays per ticket
 * (that is what a ticket's history is); what the viewer controls is whether
 * people are told: `notify: false` sends through `supabaseBulk`, whose header
 * marks the activity `bulk` so it fans out to nobody (050).
 */
export const BULK_LIMIT = 500

const client = (notify: boolean) => (notify ? supabase : supabaseBulk)
const chunks = <T,>(arr: T[], n = 60): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

export function useBulkTickets() {
  const qc = useQueryClient()
  const settle = () => invalidateTicketViews(qc)

  const update = useMutation({
    mutationFn: async ({ ids, patch, notify = true }: { ids: string[]; patch: UpdateTicketInput; notify?: boolean }) => {
      const user = await currentUser()
      let touched = 0
      for (const part of chunks(ids)) {
        const { data, error } = await client(notify).from('tickets').update({ ...patch, updated_at: new Date().toISOString(), updated_by: user?.id ?? null }).in('id', part).select('id')
        if (error) throw error
        touched += data?.length ?? 0
      }
      return { touched, skipped: ids.length - touched }
    },
    onMutate: async ({ ids, patch }) => {
      const snaps = await Promise.all(ids.map((id) => snapshotTicketViews(qc, id)))
      for (const id of ids) patchTicketEverywhere(qc, id, (t) => ({ ...t, ...patch } as Ticket))
      return snaps[0]
    },
    onError: (_e, _v, snap) => restoreTicketViews(qc, snap),
    onSettled: settle,
  })

  const assign = useMutation({
    mutationFn: async ({ ids, userId, mode, notify = true }: { ids: string[]; userId: string; mode: 'add' | 'remove'; notify?: boolean }) => {
      if (mode === 'add') {
        const { error } = await client(notify).from('ticket_assignees').upsert(ids.map((ticket_id) => ({ ticket_id, user_id: userId })), { onConflict: 'ticket_id,user_id', ignoreDuplicates: true })
        if (error) throw error
      } else {
        for (const part of chunks(ids)) {
          const { error } = await client(notify).from('ticket_assignees').delete().in('ticket_id', part).eq('user_id', userId)
          if (error) throw error
        }
      }
    },
    onSettled: settle,
  })

  const tag = useMutation({
    mutationFn: async ({ ids, tagId, mode }: { ids: string[]; tagId: string; mode: 'add' | 'remove' }) => {
      if (mode === 'add') {
        const { error } = await supabaseBulk.from('ticket_tag_assignments').upsert(ids.map((ticket_id) => ({ ticket_id, tag_id: tagId })), { onConflict: 'ticket_id,tag_id', ignoreDuplicates: true })
        if (error) throw error
      } else {
        for (const part of chunks(ids)) {
          const { error } = await supabaseBulk.from('ticket_tag_assignments').delete().in('ticket_id', part).eq('tag_id', tagId)
          if (error) throw error
        }
      }
    },
    onSettled: settle,
  })

  const move = useMutation({
    mutationFn: async ({ ids, projectId }: { ids: string[]; projectId: string }) => {
      for (const id of ids) { const { error } = await supabase.rpc('move_ticket', { p_ticket: id, p_project: projectId }); if (error) throw error }
    },
    onSettled: settle,
  })

  const copy = useMutation({
    mutationFn: async ({ ids, projectId }: { ids: string[]; projectId?: string | null }) => {
      for (const id of ids) { const { error } = await supabase.rpc('copy_ticket', { p_ticket: id, p_project: projectId ?? null }); if (error) throw error }
    },
    onSettled: settle,
  })

  const setParent = useMutation({
    mutationFn: async ({ ids, parentId, notify = true }: { ids: string[]; parentId: string | null; notify?: boolean }) => {
      for (const part of chunks(ids)) {
        const { error } = await client(notify).from('tickets').update({ parent_id: parentId }).in('id', part)
        if (error) throw error
      }
    },
    onSettled: settle,
  })

  const archive = useMutation({
    mutationFn: async ({ ids, notify = true }: { ids: string[]; notify?: boolean }) => {
      for (const part of chunks(ids)) {
        const { error } = await client(notify).from('tickets').update({ archived_at: new Date().toISOString() }).in('id', part)
        if (error) throw error
      }
    },
    onSettled: settle,
  })

  const remove = useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      for (const part of chunks(ids)) {
        const { error } = await supabase.from('tickets').delete().in('id', part)
        if (error) throw error
      }
    },
    onSettled: settle,
  })

  /** Link every selected ticket to the first one (relates / blocks / waits_for / duplicates). */
  const link = useMutation({
    mutationFn: async ({ ids, kind }: { ids: string[]; kind: LinkKind }) => {
      const [first, ...rest] = ids
      if (!first || !rest.length) return
      const rows = rest.map((linked_ticket_id, i) => ({ ticket_id: first, linked_ticket_id, kind, order_index: i }))
      const { error } = await supabase.from('ticket_links').upsert(rows, { onConflict: 'ticket_id,linked_ticket_id', ignoreDuplicates: true })
      if (error) throw error
    },
    onSettled: settle,
  })

  return { update, assign, tag, move, copy, setParent, archive, remove, link }
}
