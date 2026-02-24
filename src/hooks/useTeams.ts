import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Team, TeamMember, TeamInvitation } from '../types'

// ─── Fetch my teams ───────────────────────────────────────────────────────────
export function useMyTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: async (): Promise<Team[]> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data, error } = await supabase
        .from('team_members')
        .select('team:teams(*)')
        .eq('user_id', user.id)
      if (error) throw error
      return (data ?? []).map((r: { team: Team }) => r.team).filter(Boolean)
    },
  })
}

// ─── Fetch team members ───────────────────────────────────────────────────────
export function useTeamMembers(teamId: string) {
  return useQuery({
    queryKey: ['team_members', teamId],
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase
        .from('team_members')
        .select('*, user:profiles(*)')
        .eq('team_id', teamId)
      if (error) throw error
      return (data ?? []) as TeamMember[]
    },
    enabled: !!teamId,
  })
}

// ─── Create team ──────────────────────────────────────────────────────────────
export function useCreateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string): Promise<Team> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const { data, error } = await supabase
        .from('teams')
        .insert({ name, created_by: user.id, code: '' })
        .select('*')
        .single()
      if (error) throw error
      return data as Team
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

// ─── Join by code ─────────────────────────────────────────────────────────────
export function useJoinTeamByCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (code: string): Promise<Team> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const { data: team, error: teamErr } = await supabase
        .from('teams')
        .select('*')
        .eq('code', code.toUpperCase())
        .single()
      if (teamErr || !team) throw new Error('Geçersiz takım kodu')

      // Check already member
      const { data: existing } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('team_id', team.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (existing) throw new Error('Zaten bu takımın üyesisin')

      const { error: joinErr } = await supabase
        .from('team_members')
        .insert({ team_id: team.id, user_id: user.id, role: 'member' })
      if (joinErr) throw joinErr

      return team as Team
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

// ─── Create invite link ───────────────────────────────────────────────────────
export function useCreateInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, email }: { teamId: string; email?: string }): Promise<TeamInvitation> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')

      const { data, error } = await supabase
        .from('team_invitations')
        .insert({ team_id: teamId, email: email ?? null, invited_by: user.id })
        .select('*')
        .single()
      if (error) throw error
      return data as TeamInvitation
    },
    onSuccess: (_d, { teamId }) => qc.invalidateQueries({ queryKey: ['invitations', teamId] }),
  })
}

// ─── Accept invite by token ───────────────────────────────────────────────────
export function useAcceptInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Önce giriş yapmalısın')

      const { data: inv, error: invErr } = await supabase
        .from('team_invitations')
        .select('*')
        .eq('token', token)
        .eq('status', 'pending')
        .single()
      if (invErr || !inv) throw new Error('Geçersiz veya süresi dolmuş davet linki')

      // Add to team
      const { error: joinErr } = await supabase
        .from('team_members')
        .insert({ team_id: inv.team_id, user_id: user.id, role: 'member' })
      if (joinErr && !joinErr.message.includes('duplicate')) throw joinErr

      // Mark invitation accepted
      await supabase
        .from('team_invitations')
        .update({ status: 'accepted' })
        .eq('id', inv.id)

      return inv.team_id as string
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}
