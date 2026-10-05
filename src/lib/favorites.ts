import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryClient } from './queryClient'
import { currentUser } from './session'
import { emitError } from './errorToast'

/**
 * Favourites and recents (#D6B3097E) — the two ways a person gets back to what
 * they keep returning to.
 *
 * - Favourites are rows in `user_favorites` (075): explicit, per user, one row
 *   per task / page / list, shown at the top of the sidebar.
 * - Recents are not data, they are a trace: the last things opened, kept in
 *   the user's global preferences (`recents` key, newest first, capped) — the
 *   same place the last opened list already lives, so nothing new to back up
 *   and nothing that survives the account.
 */
export type FavKind = 'ticket' | 'page' | 'project'

export interface Favorite {
  id: string
  kind: FavKind
  target: string
  order_index: number
  created_at: string
}

type Row = { id: string; ticket_id: string | null; page_id: string | null; project_id: string | null; order_index: number; created_at: string }

const COLUMN: Record<FavKind, 'ticket_id' | 'page_id' | 'project_id'> = { ticket: 'ticket_id', page: 'page_id', project: 'project_id' }

const toFavorite = (r: Row): Favorite => ({
  id: r.id,
  kind: r.ticket_id ? 'ticket' : r.page_id ? 'page' : 'project',
  target: (r.ticket_id ?? r.page_id ?? r.project_id) as string,
  order_index: r.order_index,
  created_at: r.created_at,
})

export const FAVORITES_KEY = ['favorites'] as const

export function useFavorites() {
  return useQuery({
    queryKey: FAVORITES_KEY,
    staleTime: 60_000,
    queryFn: async (): Promise<Favorite[]> => {
      const { data, error } = await supabase
        .from('user_favorites')
        .select('id, ticket_id, page_id, project_id, order_index, created_at')
        .order('order_index')
        .order('created_at')
      if (error) throw error
      return ((data ?? []) as Row[]).map(toFavorite)
    },
  })
}

/** Is this thing favourited? Cheap enough to call from every row menu. */
export function useIsFavorite(kind: FavKind, target: string | null | undefined): boolean {
  const { data } = useFavorites()
  return useMemo(() => !!target && !!data?.some((f) => f.kind === kind && f.target === target), [data, kind, target])
}

/** Add or remove; the sidebar updates before the server answers. */
export function useToggleFavorite() {
  const qc = useQueryClient()
  // Add or remove is decided *before* the optimistic patch goes in: onMutate
  // runs ahead of mutationFn, so reading the cache inside mutationFn saw the
  // freshly added "tmp-…" row and tried to delete it by that fake id (400).
  type Vars = { kind: FavKind; target: string; existingId: string | null; count: number }
  const m = useMutation({
    mutationFn: async ({ kind, target, existingId, count }: Vars) => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      if (existingId) {
        const { error } = await supabase.from('user_favorites').delete().eq('id', existingId)
        if (error) throw error
        return { removed: true }
      }
      const { error } = await supabase.from('user_favorites').insert({ user_id: user.id, [COLUMN[kind]]: target, order_index: count })
      if (error) throw error
      return { removed: false }
    },
    onMutate: async ({ kind, target, existingId }) => {
      await qc.cancelQueries({ queryKey: FAVORITES_KEY })
      const prev = qc.getQueryData<Favorite[]>(FAVORITES_KEY) ?? []
      qc.setQueryData<Favorite[]>(FAVORITES_KEY, existingId
        ? prev.filter((f) => !(f.kind === kind && f.target === target))
        : [...prev, { id: `tmp-${target}`, kind, target, order_index: prev.length, created_at: new Date().toISOString() }])
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx) qc.setQueryData(FAVORITES_KEY, ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: FAVORITES_KEY }),
  })
  return useCallback((kind: FavKind, target: string) => {
    const current = qc.getQueryData<Favorite[]>(FAVORITES_KEY) ?? []
    const existing = current.find((f) => f.kind === kind && f.target === target)
    // A row still in flight (tmp id) cannot be removed yet; ignore the double click.
    if (existing?.id.startsWith('tmp-')) return
    m.mutate({ kind, target, existingId: existing?.id ?? null, count: current.length })
  }, [m, qc])
}

// ─── Recents ─────────────────────────────────────────────────────────────────
export interface RecentEntry { id: string; at: string }
export interface Recents { tickets?: RecentEntry[]; pages?: RecentEntry[]; projects?: RecentEntry[] }

const RECENT_MAX = 8
/** The same thing opened twice within this window counts once. */
const RECENT_DEDUPE_MS = 30_000
const listKey = (kind: FavKind): keyof Recents => (kind === 'ticket' ? 'tickets' : kind === 'page' ? 'pages' : 'projects')
const lastNoted = new Map<string, number>()

/**
 * "I opened this." Updates the user's global prefs (through the same merge RPC
 * the prefs hook uses), newest first, without a re-render storm: the prefs
 * cache is patched in place and the write goes out once.
 */
export function noteRecent(kind: FavKind, id: string) {
  const stamp = `${kind}:${id}`
  const now = Date.now()
  if (now - (lastNoted.get(stamp) ?? 0) < RECENT_DEDUPE_MS) return
  lastNoted.set(stamp, now)
  void (async () => {
    const user = await currentUser()
    if (!user) return
    const key = ['prefs', user.id, 'global']
    const prefs = (queryClient.getQueryData<Record<string, unknown>>(key) ?? {})
    const recents = (prefs.recents as Recents | undefined) ?? {}
    const k = listKey(kind)
    const next: RecentEntry[] = [{ id, at: new Date(now).toISOString() }, ...(recents[k] ?? []).filter((e) => e.id !== id)].slice(0, RECENT_MAX)
    const patch = { recents: { ...recents, [k]: next } }
    queryClient.setQueryData(key, { ...prefs, ...patch })
    const { data, error } = await supabase.rpc('merge_user_prefs', { p_scope: 'global', p_patch: patch })
    if (error) { emitError(error); return }
    if (data) queryClient.setQueryData(key, data)
  })()
}

/** Forget one entry (row menu "listeden kaldır"). */
export async function forgetRecent(kind: FavKind, id: string) {
  const user = await currentUser()
  if (!user) return
  const key = ['prefs', user.id, 'global']
  const prefs = (queryClient.getQueryData<Record<string, unknown>>(key) ?? {})
  const recents = (prefs.recents as Recents | undefined) ?? {}
  const k = listKey(kind)
  const patch = { recents: { ...recents, [k]: (recents[k] ?? []).filter((e) => e.id !== id) } }
  queryClient.setQueryData(key, { ...prefs, ...patch })
  const { data, error } = await supabase.rpc('merge_user_prefs', { p_scope: 'global', p_patch: patch })
  if (error) { emitError(error); return }
  if (data) queryClient.setQueryData(key, data)
}
