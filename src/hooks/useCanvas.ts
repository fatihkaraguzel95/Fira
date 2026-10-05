import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { CanvasKind, Page } from '../types'
import type { SceneFile } from '../lib/canvas/session'

/**
 * Canvas side of pages (096): versions of a scene, the "hidden by beta" hint
 * and the whiteboards one can copy from. The live scene itself is loaded and
 * saved by the canvas view (lib/canvas/session), not through React Query —
 * it changes many times a second and must not be refetched under the editor.
 */

export interface SceneVersion {
  id: string
  page_id: string
  elements: unknown[]
  files: Record<string, SceneFile>
  settings: Record<string, unknown>
  author_id: string | null
  saved_at: string
  reason: 'auto' | 'restore' | 'import'
  author?: { id: string; full_name: string | null; email: string | null } | null
}

export function useSceneVersions(pageId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['pages', 'scene-versions', pageId],
    queryFn: async (): Promise<SceneVersion[]> => {
      const { data, error } = await supabase
        .from('page_scene_versions')
        .select('id, page_id, elements, files, settings, author_id, saved_at, reason, author:profiles!page_scene_versions_author_id_fkey(id, full_name, email)')
        .eq('page_id', pageId!)
        .order('saved_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as SceneVersion[]
    },
    enabled: !!pageId && enabled,
  })
}

export function useRestoreSceneVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ versionId }: { versionId: string; pageId: string }) => {
      const { data, error } = await supabase.rpc('restore_page_scene_version', { p_version: versionId })
      if (error) throw error
      return data as { rev: number; updated_at: string }
    },
    onSuccess: (_d, { pageId }) => qc.invalidateQueries({ queryKey: ['pages', 'scene-versions', pageId] }),
  })
}

/** Keep the current state as a version before an import changes it. */
export async function snapshotScene(pageId: string) {
  const { error } = await supabase.rpc('snapshot_page_scene', { p_page: pageId })
  if (error) throw error
}

/**
 * A link to a canvas the user cannot see: is it hidden only because the beta
 * is off? Returns the kind for a member of the team, null otherwise (the RPC
 * does not reveal anything to outsiders).
 */
export function useHiddenPageKind(pageId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['pages', 'hidden-kind', pageId],
    queryFn: async (): Promise<CanvasKind | null> => {
      const { data, error } = await supabase.rpc('hidden_page_kind', { p_page: pageId! })
      if (error) return null
      return (data as CanvasKind | null) ?? null
    },
    enabled: !!pageId && enabled,
    staleTime: 30_000,
  })
}

/** Whiteboards this user can see (every team), newest first — "take from another whiteboard". */
export function useVisibleWhiteboards(enabled: boolean) {
  return useQuery({
    queryKey: ['pages', 'whiteboards'],
    queryFn: async (): Promise<Pick<Page, 'id' | 'title' | 'team_id' | 'updated_at'>[]> => {
      const { data, error } = await supabase
        .from('pages')
        .select('id, title, team_id, updated_at')
        .eq('kind', 'whiteboard')
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return (data ?? []) as Pick<Page, 'id' | 'title' | 'team_id' | 'updated_at'>[]
    },
    enabled,
  })
}
