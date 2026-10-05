import { uuid } from '../lib/uuid'
import { currentUser } from '../lib/session'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { removeStorageUrls } from '../lib/storage'
import type { Project } from '../types'

const LIST_SELECT = '*, color:team_colors!projects_color_id_fkey(id, name, hex)'

/** Lists of a team (DB table "projects"), with their palette colour joined. */
export function useProjects(teamId: string | null) {
  return useQuery({
    queryKey: ['projects', teamId],
    queryFn: async (): Promise<Project[]> => {
      if (!teamId) return []
      const { data, error } = await supabase
        .from('projects')
        .select(LIST_SELECT)
        .eq('team_id', teamId)
        .order('order_index')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as Project[]
    },
    enabled: !!teamId,
  })
}

/**
 * Taşıma hedefleri (#4e8dc8f1): görevin kendi takımının listeleri ve
 * **yönetici olduğun** diğer takımların listeleri. Sunucu aynı kuralı
 * uyguluyor (093 `move_ticket`): başka takıma taşımak için iki tarafta da
 * yönetici olmak gerekiyor; burada yalnız seçenekler hazırlanıyor.
 */
export interface MoveTarget { team: { id: string; name: string }; lists: Project[]; own: boolean }

export function useMoveTargets(teamId: string | null) {
  return useQuery({
    queryKey: ['move-targets', teamId],
    enabled: !!teamId,
    staleTime: 60_000,
    queryFn: async (): Promise<MoveTarget[]> => {
      const user = await currentUser()
      if (!user || !teamId) return []
      const { data: mems, error: mErr } = await supabase
        .from('team_members')
        .select('team_id, role, team:teams!team_members_team_id_fkey(id, name)')
        .eq('user_id', user.id)
      if (mErr) throw mErr
      type Row = { team_id: string; role: string; team: { id: string; name: string } | null }
      const rows = (mems ?? []) as unknown as Row[]
      const usable = rows.filter((r) => r.team_id === teamId || r.role === 'owner' || r.role === 'admin')
      if (!usable.length) return []
      const { data, error } = await supabase
        .from('projects')
        .select(LIST_SELECT)
        .in('team_id', usable.map((r) => r.team_id))
        .order('order_index')
        .order('created_at')
      if (error) throw error
      const lists = (data ?? []) as unknown as Project[]
      return usable
        .map((r) => ({
          team: { id: r.team_id, name: r.team?.name ?? '' },
          lists: lists.filter((l) => l.team_id === r.team_id),
          own: r.team_id === teamId,
        }))
        .filter((g) => g.lists.length > 0)
        // Önce görevin kendi takımı, sonra öbürleri ada göre.
        .sort((a, b) => (a.own === b.own ? a.team.name.localeCompare(b.team.name, 'tr') : a.own ? -1 : 1))
    },
  })
}

export interface ListInput {
  name: string
  description?: string | null
  folder_id?: string | null
  icon?: string | null
  icon_url?: string | null
  background_url?: string | null
  background_credit?: string | null
  color_id?: string | null
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, input }: { teamId: string; input: ListInput }): Promise<Project> => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const { data: maxData } = await supabase
        .from('projects').select('order_index').eq('team_id', teamId)
        .order('order_index', { ascending: false }).limit(1).maybeSingle()
      const { data, error } = await supabase
        .from('projects')
        .insert({ team_id: teamId, ...input, created_by: user.id, order_index: (maxData?.order_index ?? -1) + 1 })
        .select(LIST_SELECT)
        .single()
      if (error) throw error
      return data as unknown as Project
    },
    onSuccess: (_d, { teamId }) => qc.invalidateQueries({ queryKey: ['projects', teamId] }),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, teamId }: { projectId: string; teamId: string }) => {
      const { error } = await supabase.from('projects').delete().eq('id', projectId)
      if (error) throw error
      return teamId
    },
    onSuccess: (teamId) => qc.invalidateQueries({ queryKey: ['projects', teamId] }),
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, teamId, input }: { projectId: string; teamId: string; input: Partial<ListInput> & { order_index?: number } }) => {
      // A replaced or removed logo/background leaves a file behind unless we
      // look at what was there before the update.
      const touchesFiles = 'icon_url' in input || 'background_url' in input
      const { data: before } = touchesFiles
        ? await supabase.from('projects').select('icon_url, background_url').eq('id', projectId).maybeSingle()
        : { data: null }
      const { error } = await supabase.from('projects').update(input).eq('id', projectId)
      if (error) throw error
      if (before) {
        const stale: (string | null | undefined)[] = []
        if ('icon_url' in input && before.icon_url && before.icon_url !== input.icon_url) stale.push(before.icon_url)
        if ('background_url' in input && before.background_url && before.background_url !== input.background_url) stale.push(before.background_url)
        await removeStorageUrls(stale)
      }
      return teamId
    },
    onSuccess: (teamId) => qc.invalidateQueries({ queryKey: ['projects', teamId] }),
  })
}

/** Upload a small logo for a list; stored under the uploader's folder so the
 *  existing storage delete policy applies. Returns the public URL. */
export async function uploadListLogo(file: File): Promise<string> {
  const user = await currentUser()
  if (!user) throw new Error('Oturum bulunamadı')
  if (file.size > 512 * 1024) throw new Error('Logo en fazla 512 KB olabilir')
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `${user.id}/logos/${uuid()}.${ext}`
  const { error } = await supabase.storage.from('ticket-attachments').upload(path, file, { upsert: false })
  if (error) throw error
  return supabase.storage.from('ticket-attachments').getPublicUrl(path).data.publicUrl
}

/** Reorder lists and/or move them between folders (optimistic on ['projects', teamId]). */
export function useReorderLists() {
  const qc = useQueryClient()
  return useMutation({
    onMutate: async ({ teamId, updates }: { teamId: string; updates: { id: string; order_index: number; folder_id: string | null }[] }) => {
      await qc.cancelQueries({ queryKey: ['projects', teamId] })
      const previous = qc.getQueryData<Project[]>(['projects', teamId])
      const map = new Map(updates.map((u) => [u.id, u]))
      qc.setQueryData<Project[]>(['projects', teamId], (old) => (old ?? []).map((p) => { const u = map.get(p.id); return u ? { ...p, order_index: u.order_index, folder_id: u.folder_id } : p }))
      return { previous }
    },
    onError: (_e, { teamId }, ctx) => { if (ctx?.previous) qc.setQueryData(['projects', teamId], ctx.previous) },
    mutationFn: async ({ updates }: { teamId: string; updates: { id: string; order_index: number; folder_id: string | null }[] }) => {
      const results = await Promise.all(updates.map((u) => supabase.from('projects').update({ order_index: u.order_index, folder_id: u.folder_id }).eq('id', u.id)))
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
    },
    onSettled: (_d, _e, { teamId }) => qc.invalidateQueries({ queryKey: ['projects', teamId] }),
  })
}

/** Board background for a list. Bigger budget than a logo — it covers the screen. */
export async function uploadListBackground(file: File): Promise<string> {
  const user = await currentUser()
  if (!user) throw new Error('Oturum bulunamadı')
  if (file.size > 4 * 1024 * 1024) throw new Error('Arkaplan en fazla 4 MB olabilir')
  const ext = file.type === 'image/svg+xml' ? 'svg' : (file.name.split('.').pop() || 'webp').toLowerCase()
  const path = `${user.id}/backgrounds/${uuid()}.${ext}`
  const { error } = await supabase.storage.from('ticket-attachments').upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  return supabase.storage.from('ticket-attachments').getPublicUrl(path).data.publicUrl
}
