import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TeamColor } from '../types'
import type { TranslationKey } from '../i18n'

/** Curated swatches offered when creating a team colour (no free hex input).
 *  `nameKey`, not a name: this is module-level, so a literal would freeze in
 *  whatever language was active at import. */
export const COLOR_SWATCHES: { hex: string; nameKey: TranslationKey }[] = [
  { hex: '#ef4444', nameKey: 'common.color.red' },
  { hex: '#f97316', nameKey: 'common.color.orange' },
  { hex: '#f59e0b', nameKey: 'common.color.amber' },
  { hex: '#eab308', nameKey: 'common.color.yellow' },
  { hex: '#84cc16', nameKey: 'common.color.lime' },
  { hex: '#22c55e', nameKey: 'common.color.green' },
  { hex: '#10b981', nameKey: 'common.color.emerald' },
  { hex: '#14b8a6', nameKey: 'common.color.teal' },
  { hex: '#06b6d4', nameKey: 'common.color.cyan' },
  { hex: '#0ea5e9', nameKey: 'common.color.sky' },
  { hex: '#3b82f6', nameKey: 'common.color.blue' },
  { hex: '#6366f1', nameKey: 'common.color.indigo' },
  { hex: '#8b5cf6', nameKey: 'common.color.violet' },
  { hex: '#a855f7', nameKey: 'common.color.purple' },
  { hex: '#d946ef', nameKey: 'common.color.fuchsia' },
  { hex: '#ec4899', nameKey: 'common.color.pink' },
  { hex: '#f43f5e', nameKey: 'common.color.rose' },
  { hex: '#78716c', nameKey: 'common.color.stone' },
  { hex: '#6b7280', nameKey: 'common.color.gray' },
  { hex: '#475569', nameKey: 'common.color.slate' },
]

export function useTeamColors(teamId: string | null) {
  return useQuery({
    queryKey: ['team_colors', teamId],
    queryFn: async (): Promise<TeamColor[]> => {
      if (!teamId) return []
      const { data, error } = await supabase
        .from('team_colors')
        .select('*')
        .eq('team_id', teamId)
        .order('order_index')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as TeamColor[]
    },
    enabled: !!teamId,
  })
}

export function useCreateTeamColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, name, hex }: { teamId: string; name: string; hex: string }): Promise<TeamColor> => {
      const { data: maxData } = await supabase
        .from('team_colors').select('order_index').eq('team_id', teamId)
        .order('order_index', { ascending: false }).limit(1).maybeSingle()
      const { data, error } = await supabase
        .from('team_colors')
        .insert({ team_id: teamId, name, hex, order_index: (maxData?.order_index ?? -1) + 1 })
        .select('*')
        .single()
      if (error) throw error
      return data as TeamColor
    },
    onSuccess: (_d, { teamId }) => qc.invalidateQueries({ queryKey: ['team_colors', teamId] }),
  })
}

export function useUpdateTeamColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, teamId, input }: { id: string; teamId: string; input: Partial<Pick<TeamColor, 'name' | 'hex'>> }) => {
      const { error } = await supabase.from('team_colors').update(input).eq('id', id)
      if (error) throw error
      return teamId
    },
    onSuccess: (teamId) => {
      qc.invalidateQueries({ queryKey: ['team_colors', teamId] })
      qc.invalidateQueries({ queryKey: ['projects', teamId] })
      qc.invalidateQueries({ queryKey: ['folders', teamId] })
    },
  })
}

export function useDeleteTeamColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, teamId }: { id: string; teamId: string }) => {
      const { error } = await supabase.from('team_colors').delete().eq('id', id)
      if (error) throw error
      return teamId
    },
    onSuccess: (teamId) => {
      qc.invalidateQueries({ queryKey: ['team_colors', teamId] })
      qc.invalidateQueries({ queryKey: ['projects', teamId] })
      qc.invalidateQueries({ queryKey: ['folders', teamId] })
    },
  })
}
