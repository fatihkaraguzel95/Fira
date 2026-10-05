import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { currentUser } from '../lib/session'
import type { ListViewConfig } from '../lib/listView'
import type { TicketFilters } from '../types'

/**
 * Saved views (#883CF8 / TL-09): rows of `list_views` (079). A view carries the
 * list config, the filters and the type (list / board); `scope` says whose it
 * is — a list's (personal or shared with the team) or the person's own
 * "my tasks" views. The query key starts with 'list_views' so realtime can
 * refresh it later; every mutation invalidates it.
 */
export type ViewScope = 'project' | 'team' | 'me'
export type ViewType = 'list' | 'board'

export interface SavedViewConfig {
  list?: Partial<ListViewConfig>
  filters?: TicketFilters
  /** "My tasks" slice (today, overdue, …) for `me` views. */
  slice?: string
}

export interface SavedView {
  id: string
  scope: ViewScope
  project_id: string | null
  team_id: string | null
  owner_id: string
  name: string
  icon: string | null
  type: ViewType
  config: SavedViewConfig
  is_shared: boolean
  is_default: boolean
  is_protected: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface ViewsKey { scope: ViewScope; projectId?: string | null; teamId?: string | null }

const keyOf = (k: ViewsKey) => ['list_views', k.scope, k.projectId ?? null, k.teamId ?? null] as const

export function useListViews(k: ViewsKey | null) {
  return useQuery({
    queryKey: k ? keyOf(k) : ['list_views', 'none'],
    enabled: !!k && (k.scope === 'me' || !!k.projectId || !!k.teamId),
    staleTime: 30_000,
    queryFn: async (): Promise<SavedView[]> => {
      let q = supabase.from('list_views').select('*').eq('scope', k!.scope).order('position').order('created_at')
      if (k!.scope === 'project') q = q.eq('project_id', k!.projectId!)
      if (k!.scope === 'team') q = q.eq('team_id', k!.teamId!)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as SavedView[]
    },
  })
}

export function useListViewMutations(k: ViewsKey | null) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['list_views'] })
  const create = useMutation({
    mutationFn: async (input: { name: string; type: ViewType; config: SavedViewConfig; is_shared?: boolean; icon?: string | null }) => {
      const user = await currentUser()
      if (!user || !k) throw new Error('Oturum bulunamadı')
      const row = {
        scope: k.scope, project_id: k.scope === 'project' ? k.projectId : null, team_id: k.scope === 'team' ? k.teamId : null,
        owner_id: user.id, name: input.name.trim(), icon: input.icon ?? null, type: input.type, config: input.config,
        is_shared: k.scope === 'me' ? false : !!input.is_shared,
      }
      const { data, error } = await supabase.from('list_views').insert(row).select('*').single()
      if (error) throw error
      return data as SavedView
    },
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<SavedView, 'name' | 'icon' | 'type' | 'config' | 'is_shared' | 'is_default' | 'is_protected' | 'position'>> }) => {
      const { data, error } = await supabase.from('list_views').update(patch).eq('id', id).select('*').single()
      if (error) throw error
      return data as SavedView
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('list_views').delete().eq('id', id); if (error) throw error },
    onSuccess: refresh,
  })
  return { create, update, remove }
}

/** One saved view by id — for a shared link that lands on another list. */
export async function fetchListView(id: string): Promise<SavedView | null> {
  const { data, error } = await supabase.from('list_views').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as SavedView | null) ?? null
}
