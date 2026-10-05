import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { currentUser } from '../lib/session'
import { supabase } from '../lib/supabase'
import type { TeamFolder } from '../types'

export function useFolders(teamId: string | null) {
  return useQuery({
    queryKey: ['folders', teamId],
    queryFn: async (): Promise<TeamFolder[]> => {
      if (!teamId) return []
      const { data, error } = await supabase
        .from('team_folders')
        .select('*')
        .eq('team_id', teamId)
        .order('order_index')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as TeamFolder[]
    },
    enabled: !!teamId,
  })
}

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, name, colorId, parentId = null }: { teamId: string; name: string; colorId?: string | null; parentId?: string | null }): Promise<TeamFolder> => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      // Last among its siblings (the same parent).
      let q = supabase.from('team_folders').select('order_index').eq('team_id', teamId)
      q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null)
      const { data: maxData } = await q.order('order_index', { ascending: false }).limit(1).maybeSingle()
      const { data, error } = await supabase
        .from('team_folders')
        .insert({ team_id: teamId, parent_id: parentId, name, color_id: colorId ?? null, created_by: user.id, order_index: (maxData?.order_index ?? -1) + 1 })
        .select('*')
        .single()
      if (error) throw error
      return data as TeamFolder
    },
    onSuccess: (_d, { teamId }) => qc.invalidateQueries({ queryKey: ['folders', teamId] }),
  })
}

export function useUpdateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, teamId, input }: { id: string; teamId: string; input: Partial<Pick<TeamFolder, 'name' | 'color_id' | 'order_index'>> }) => {
      const { error } = await supabase.from('team_folders').update(input).eq('id', id)
      if (error) throw error
      return teamId
    },
    onSuccess: (teamId) => qc.invalidateQueries({ queryKey: ['folders', teamId] }),
  })
}

/** Deleting a folder keeps what it holds: lists, pages and subfolders move up one level (068 trigger). */
export function useDeleteFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, teamId }: { id: string; teamId: string }) => {
      const { error } = await supabase.from('team_folders').delete().eq('id', id)
      if (error) throw error
      return teamId
    },
    onSuccess: (teamId) => {
      qc.invalidateQueries({ queryKey: ['folders', teamId] })
      qc.invalidateQueries({ queryKey: ['projects', teamId] })
      qc.invalidateQueries({ queryKey: ['pages'] })
    },
  })
}

/**
 * Delete a folder with everything under it (#1F44279C). Until now the only way
 * was "contents move up", so emptying a branch meant dragging everything out
 * first. Order matters: contents go before the folders, otherwise the 068
 * trigger lifts whatever is left one level up instead of letting it go.
 *
 * What happens to what: subfolders go with it; lists are deleted with their
 * tickets (and the pages hanging under a list, which cascade with it); pages
 * sitting in the folders move to the **trash**, so they can be restored for 60
 * days. RLS decides what the caller may actually delete — a refusal surfaces.
 */
export function useDeleteFolderDeep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, teamId }: { id: string; teamId: string }) => {
      // Read the tree from the server: the sidebar cache can be behind.
      const [fRes, lRes, pgRes] = await Promise.all([
        supabase.from('team_folders').select('id, parent_id').eq('team_id', teamId),
        supabase.from('projects').select('id, folder_id').eq('team_id', teamId),
        supabase.from('pages').select('id, folder_id').eq('team_id', teamId).is('archived_at', null),
      ])
      if (fRes.error) throw fRes.error
      if (lRes.error) throw lRes.error
      if (pgRes.error) throw pgRes.error
      const all = (fRes.data ?? []) as { id: string; parent_id: string | null }[]
      // Level by level, so the deepest folder can be deleted first.
      const levels: string[][] = [[id]]
      for (let i = 0; i < levels.length && i < 40; i++) {
        const next = all.filter((f) => f.parent_id && levels[i].includes(f.parent_id)).map((f) => f.id)
        if (next.length) levels.push(next)
      }
      const inTree = new Set(levels.flat())
      for (const pg of (pgRes.data ?? []) as { id: string; folder_id: string | null }[]) {
        if (!pg.folder_id || !inTree.has(pg.folder_id)) continue
        const { error } = await supabase.rpc('trash_page', { p_id: pg.id })
        if (error) throw error
      }
      for (const l of (lRes.data ?? []) as { id: string; folder_id: string | null }[]) {
        if (!l.folder_id || !inTree.has(l.folder_id)) continue
        const { error } = await supabase.from('projects').delete().eq('id', l.id)
        if (error) throw error
      }
      for (const level of [...levels].reverse()) {
        const { error } = await supabase.from('team_folders').delete().in('id', level)
        if (error) throw error
      }
      return teamId
    },
    onSuccess: (teamId) => {
      qc.invalidateQueries({ queryKey: ['folders', teamId] })
      qc.invalidateQueries({ queryKey: ['projects', teamId] })
      qc.invalidateQueries({ queryKey: ['pages'] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

/**
 * Move a folder to another parent and renumber the level it lands in
 * (#AC4BC182 — dragging a folder into a folder). The 068 trigger refuses a
 * cycle or another team; the tree keeps those drops from being offered.
 */
export function useMoveFolder() {
  const qc = useQueryClient()
  type Move = { id: string; order_index: number; parent_id: string | null }
  return useMutation({
    onMutate: async ({ teamId, updates }: { teamId: string; updates: Move[] }) => {
      await qc.cancelQueries({ queryKey: ['folders', teamId] })
      const previous = qc.getQueryData<TeamFolder[]>(['folders', teamId])
      const map = new Map(updates.map((u) => [u.id, u]))
      qc.setQueryData<TeamFolder[]>(['folders', teamId], (all) => (all ?? []).map((f) => {
        const u = map.get(f.id)
        return u ? { ...f, order_index: u.order_index, parent_id: u.parent_id } : f
      }))
      return { previous }
    },
    onError: (_e, { teamId }, ctx) => { if (ctx?.previous) qc.setQueryData(['folders', teamId], ctx.previous) },
    mutationFn: async ({ updates }: { teamId: string; updates: Move[] }) => {
      const results = await Promise.all(updates.map((u) => supabase.from('team_folders').update({ order_index: u.order_index, parent_id: u.parent_id }).eq('id', u.id)))
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
    },
    onSettled: (_d, _e, { teamId }) => qc.invalidateQueries({ queryKey: ['folders', teamId] }),
  })
}

