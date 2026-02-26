import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Project } from '../types'

export function useProjects(teamId: string | null) {
  return useQuery({
    queryKey: ['projects', teamId],
    queryFn: async (): Promise<Project[]> => {
      if (!teamId) return []
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
    enabled: !!teamId,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, name, description }: { teamId: string; name: string; description?: string }): Promise<Project> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const { data, error } = await supabase
        .from('projects')
        .insert({ team_id: teamId, name, description, created_by: user.id })
        .select('*')
        .single()
      if (error) throw error
      return data as Project
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
