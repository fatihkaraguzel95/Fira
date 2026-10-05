import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { currentUser } from '../lib/session'
import { supabase } from '../lib/supabase'
import type { Page, PageKind, PageParent } from '../types'

/**
 * Pages (064). Keys all start with 'pages' so one realtime event can refresh
 * every view with a single prefix invalidation:
 *   ['pages', 'team', teamId]     — the team's tree (titles only)
 *   ['pages', 'ticket', ticketId] — pages under a task
 *   ['pages', 'one', id]          — one page with its content
 */
const TREE_COLUMNS = 'id, team_id, folder_id, project_id, ticket_id, parent_page_id, kind, title, order_index, created_by, created_at, updated_by, updated_at, archived_at'
const FULL_COLUMNS = `${TREE_COLUMNS}, content, archived_by, creator:profiles!pages_created_by_fkey(id, full_name, email), updater:profiles!pages_updated_by_fkey(id, full_name, email), archiver:profiles!pages_archived_by_fkey(id, full_name, email)`

export const byPageOrder = (a: Page, b: Page) =>
  a.order_index - b.order_index || a.created_at.localeCompare(b.created_at)

/** Every live page of a team, titles only — the sidebar tree and breadcrumbs read from this. */
export function useTeamPages(teamId: string | null | undefined) {
  return useQuery({
    queryKey: ['pages', 'team', teamId],
    queryFn: async (): Promise<Page[]> => {
      const { data, error } = await supabase
        .from('pages')
        .select(TREE_COLUMNS)
        .eq('team_id', teamId!)
        .is('archived_at', null)
        .order('order_index')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as Page[]
    },
    enabled: !!teamId,
    staleTime: 60_000,
  })
}

/** Pages hanging directly under a task. */
export function useTicketPages(ticketId: string | null | undefined) {
  return useQuery({
    queryKey: ['pages', 'ticket', ticketId],
    queryFn: async (): Promise<Page[]> => {
      const { data, error } = await supabase
        .from('pages')
        .select(TREE_COLUMNS)
        .eq('ticket_id', ticketId!)
        .is('archived_at', null)
        .order('order_index')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as Page[]
    },
    enabled: !!ticketId,
  })
}

/** One page with its content. `null` when it does not exist or is not visible (RLS). */
export function usePage(id: string | null | undefined) {
  return useQuery({
    queryKey: ['pages', 'one', id],
    queryFn: async (): Promise<Page | null> => {
      const { data, error } = await supabase.from('pages').select(FULL_COLUMNS).eq('id', id!).maybeSingle()
      if (error) throw error
      return (data as unknown as Page) ?? null
    },
    enabled: !!id,
  })
}

const parentColumns = (parent: PageParent) => ({
  folder_id: parent.kind === 'folder' ? parent.id : null,
  project_id: parent.kind === 'list' ? parent.id : null,
  ticket_id: parent.kind === 'ticket' ? parent.id : null,
  parent_page_id: parent.kind === 'page' ? parent.id : null,
})

export function useCreatePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, parent, title = '', kind = 'page' }: { teamId: string; parent: PageParent; title?: string; kind?: PageKind }): Promise<Page> => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const cols = parentColumns(parent)
      // New pages go last among their siblings.
      let q = supabase.from('pages').select('order_index').eq('team_id', teamId).is('archived_at', null)
      for (const [k, v] of Object.entries(cols)) q = v ? q.eq(k, v) : q.is(k, null)
      const { data: last } = await q.order('order_index', { ascending: false }).limit(1).maybeSingle()
      const { data, error } = await supabase
        .from('pages')
        // team_id is re-derived from the parent by the server (064); sent for the team-root case.
        // `kind` only when it is not a page: a canvas row needs the 096 column (and beta, RLS).
        .insert({ team_id: teamId, ...cols, title, created_by: user.id, order_index: (last?.order_index ?? -1) + 1, ...(kind !== 'page' ? { kind } : {}) })
        .select(TREE_COLUMNS)
        .single()
      if (error) throw error
      return data as Page
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}

/** Someone else saved the page after we loaded it; our write was not applied. */
export class PageConflictError extends Error {
  constructor() { super('page-conflict') }
}

/**
 * After a conflict: the row as it is now, but only when its last writer is the
 * signed-in user (#9E366E76) — then there is no other person's text to protect
 * and the caller can rebase and write again. Null for anyone else's write.
 */
export async function lastWriterIsMe(pageId: string): Promise<{ updated_at: string; title: string; content: string | null } | null> {
  const me = (await currentUser())?.id
  if (!me) return null
  const { data } = await supabase.from('pages').select('updated_at, updated_by, title, content').eq('id', pageId).maybeSingle()
  if (!data || data.updated_by !== me) return null
  return { updated_at: data.updated_at as string, title: data.title as string, content: (data.content as string | null) ?? null }
}

export function useUpdatePage() {
  const qc = useQueryClient()
  return useMutation({
    // The page view resolves conflicts in place; no generic error toast for them.
    meta: { silent: true },
    /**
     * With `expectedUpdatedAt` the write only lands if the row is still the one
     * the editor started from (optimistic concurrency, like tickets) — otherwise
     * PageConflictError, and nobody's text is overwritten. Returns the new stamp.
     */
    mutationFn: async ({ id, input, expectedUpdatedAt }: { id: string; input: Partial<Pick<Page, 'title' | 'content' | 'order_index'>>; expectedUpdatedAt?: string }): Promise<string | null> => {
      let q = supabase.from('pages').update(input).eq('id', id)
      if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt)
      const { data, error } = await q.select('updated_at')
      if (error) throw error
      if (expectedUpdatedAt && (!data || data.length === 0)) throw new PageConflictError()
      return (data?.[0]?.updated_at as string | undefined) ?? null
    },
    // Titles show in the tree and breadcrumbs; content only on the page itself,
    // which already holds it locally — no refetch while the author is typing.
    onSuccess: (_d, { input }) => { if (input.title !== undefined || input.order_index !== undefined) qc.invalidateQueries({ queryKey: ['pages'] }) },
  })
}

/**
 * Move pages in the sidebar tree (#AC4BC182): the dragged page gets its new
 * parent (folder / list / another page / the team root) and the level it lands
 * in is renumbered. Optimistic, like the list reorder — the tree follows the
 * pointer and the server catches up.
 *
 * Only within one team: the caller never builds a move across teams.
 */
export function useMovePages() {
  const qc = useQueryClient()
  type Move = { id: string; order_index: number; parent: PageParent }
  return useMutation({
    onMutate: async ({ updates }: { teamId: string; updates: Move[] }) => {
      await qc.cancelQueries({ queryKey: ['pages'] })
      const key = ['pages', 'team']
      const previous = qc.getQueriesData<Page[]>({ queryKey: key })
      const map = new Map(updates.map((u) => [u.id, u]))
      qc.setQueriesData<Page[]>({ queryKey: key }, (old) => (old ?? []).map((pg) => {
        const u = map.get(pg.id)
        return u ? { ...pg, order_index: u.order_index, ...parentColumns(u.parent) } : pg
      }))
      return { previous }
    },
    onError: (_e, _v, ctx) => { ctx?.previous?.forEach(([key, data]) => qc.setQueryData(key, data)) },
    mutationFn: async ({ updates }: { teamId: string; updates: Move[] }) => {
      const results = await Promise.all(updates.map((u) => supabase.from('pages').update({ order_index: u.order_index, ...parentColumns(u.parent) }).eq('id', u.id)))
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}

/** Deletes the page and (FK cascade) every page below it. */
export function useDeletePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.from('pages').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}

/** Children of a page, and the number of pages below it at any depth. */
export function childrenOf(pages: Page[], parentPageId: string) {
  return pages.filter((p) => p.parent_page_id === parentPageId).sort(byPageOrder)
}
export function descendantCount(pages: Page[], id: string): number {
  const kids = pages.filter((p) => p.parent_page_id === id)
  return kids.reduce((n, k) => n + 1 + descendantCount(pages, k.id), 0)
}

// ── Versions (067) ──────────────────────────────────────────────────────────

export interface PageVersion {
  id: string
  page_id: string
  title: string
  content: string
  author_id: string | null
  author_name: string | null
  saved_at: string
  source: 'fira' | 'onenote' | 'conflict'
  author?: { id: string; full_name: string | null; email: string | null } | null
}

/** Past states of a page, newest first (the page row itself is the current one). */
export function usePageVersions(pageId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['pages', 'versions', pageId],
    queryFn: async (): Promise<PageVersion[]> => {
      const { data, error } = await supabase
        .from('page_versions')
        .select('id, page_id, title, content, author_id, author_name, saved_at, source, author:profiles!page_versions_author_id_fkey(id, full_name, email)')
        .eq('page_id', pageId!)
        .order('saved_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PageVersion[]
    },
    enabled: !!pageId && enabled,
  })
}

/** Back to an older state; the state being replaced is kept as a version first (server-side). */
export function useRestorePageVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ versionId }: { versionId: string }) => {
      const { data, error } = await supabase.rpc('restore_page_version', { p_version: versionId })
      if (error) throw error
      return data as string
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}

/** Keeps a draft that could not be saved (edit conflict) in the history — nothing typed is lost. */
export async function savePageDraftVersion(pageId: string, title: string, content: string, authorId: string | null, authorName?: string | null) {
  const { error } = await supabase.from('page_versions').insert({
    page_id: pageId, team_id: '00000000-0000-0000-0000-000000000000', // re-derived by the server
    title, content, author_id: authorId, author_name: authorName ?? null, saved_at: new Date().toISOString(), source: 'conflict',
  })
  if (error) throw error
}

// ── Trash (067) ─────────────────────────────────────────────────────────────

export interface TrashedPage extends Page {
  archiver?: { id: string; full_name: string | null; email: string | null } | null
}

/** The team's trash: pages whose parent is not in the trash with them (the rest comes along). */
export function useTrashedPages(teamId: string | null | undefined) {
  return useQuery({
    queryKey: ['pages', 'trash', teamId],
    queryFn: async (): Promise<{ roots: TrashedPage[]; below: Map<string, number> }> => {
      await supabase.rpc('purge_expired_pages', { p_team: teamId! })
      const { data, error } = await supabase
        .from('pages')
        .select(`${TREE_COLUMNS}, archiver:profiles!pages_archived_by_fkey(id, full_name, email)`)
        .eq('team_id', teamId!)
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as unknown as TrashedPage[]
      const byId = new Map(rows.map((r) => [r.id, r]))
      const roots = rows.filter((r) => !r.parent_page_id || byId.get(r.parent_page_id)?.archived_at !== r.archived_at)
      const below = new Map<string, number>()
      for (const r of roots) {
        let n = 0
        const walk = (id: string) => rows.forEach((c) => { if (c.parent_page_id === id && c.archived_at === r.archived_at) { n++; walk(c.id) } })
        walk(r.id)
        below.set(r.id, n)
      }
      return { roots, below }
    },
    enabled: !!teamId,
  })
}

export function useTrashPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase.rpc('trash_page', { p_id: id })
      if (error) throw error
      return data as number
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}

export function useRestorePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase.rpc('restore_page', { p_id: id })
      if (error) throw error
      return data as number
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}
