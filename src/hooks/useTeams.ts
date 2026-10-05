import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { t } from '../i18n'
import { currentUser } from '../lib/session'
import { supabase } from '../lib/supabase'
import type { Team, TeamMember, TeamInvitation, TeamRole, InvitableRole, PendingInvitation, Profile } from '../types'

// ─── My role in a team → permission flags used by the UI ─────────────────────
export interface TeamPermissions {
  role: TeamRole | null
  isOwner: boolean
  canManage: boolean   // owner/admin: lists, folders, colours, members, invitations
  canWrite: boolean    // owner/admin/member: tickets, subtasks, statuses, tags
  /** Delete something created by `createdBy` */
  canDelete: (createdBy: string | null | undefined) => boolean
}

const NO_PERMS: TeamPermissions = { role: null, isOwner: false, canManage: false, canWrite: false, canDelete: () => false }

export function permissionsFor(role: TeamRole | null | undefined, userId: string | null | undefined): TeamPermissions {
  if (!role) return NO_PERMS
  const canManage = role === 'owner' || role === 'admin'
  const canWrite = canManage || role === 'member'
  return {
    role,
    isOwner: role === 'owner',
    canManage,
    canWrite,
    canDelete: (createdBy) => canManage || (canWrite && !!userId && createdBy === userId),
  }
}

export function useTeamRole(teamId: string | null | undefined) {
  const q = useQuery({
    queryKey: ['team_role', teamId],
    queryFn: async (): Promise<{ role: TeamRole | null; userId: string | null }> => {
      if (!teamId) return { role: null, userId: null }
      const user = await currentUser()
      if (!user) return { role: null, userId: null }
      const { data } = await supabase
        .from('team_members').select('role').eq('team_id', teamId).eq('user_id', user.id).maybeSingle()
      return { role: (data?.role as TeamRole) ?? null, userId: user.id }
    },
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
  })
  return { ...q, perms: permissionsFor(q.data?.role, q.data?.userId) }
}

/** Role for the team that owns a list (project). */
export function useProjectRole(projectId: string | null | undefined) {
  const teamQ = useQuery({
    queryKey: ['project_team', projectId],
    queryFn: async (): Promise<string | null> => {
      if (!projectId) return null
      const { data } = await supabase.from('projects').select('team_id').eq('id', projectId).maybeSingle()
      return data?.team_id ?? null
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  })
  return { ...useTeamRole(teamQ.data ?? null), teamId: teamQ.data ?? null }
}

// ─── Fetch my teams (with my role) ───────────────────────────────────────────
export function useMyTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: async (): Promise<(Team & { my_role: TeamRole })[]> => {
      const user = await currentUser()
      if (!user) return []
      const { data, error } = await supabase
        .from('team_members')
        .select('role, team:teams(*)')
        .eq('user_id', user.id)
      if (error) throw error
      return (data ?? [])
        .map((r) => {
          const row = r as unknown as { role: TeamRole; team: Team | null }
          return row.team ? { ...row.team, my_role: row.role } : null
        })
        .filter((t): t is Team & { my_role: TeamRole } => !!t)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    },
  })
}

// ─── Members ─────────────────────────────────────────────────────────────────
export function useTeamMembers(teamId: string | null) {
  return useQuery({
    queryKey: ['team_members', teamId],
    queryFn: async (): Promise<TeamMember[]> => {
      if (!teamId) return []
      const { data, error } = await supabase
        .from('team_members')
        .select('*, user:profiles(*)')
        .eq('team_id', teamId)
      if (error) throw error
      const order: Record<TeamRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 }
      return ((data ?? []) as TeamMember[]).sort((a, b) =>
        order[a.role] - order[b.role] || (a.user?.full_name ?? a.user?.email ?? '').localeCompare(b.user?.full_name ?? b.user?.email ?? '', 'tr'))
    },
    enabled: !!teamId,
  })
}

/** Team members as plain profiles (assignee lists, filters). */
export function useTeamMemberProfiles(teamId: string | null): Profile[] {
  const { data } = useTeamMembers(teamId)
  return (data ?? []).map((m) => m.user).filter((u): u is Profile => !!u)
}

export function useUpdateMemberRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, userId, role }: { teamId: string; userId: string; role: InvitableRole }) => {
      const { data, error } = await supabase
        .from('team_members').update({ role }).eq('team_id', teamId).eq('user_id', userId).select('user_id')
      if (error) throw error
      if (!data?.length) throw new Error(t('team.error.roleChangeFailed'))
    },
    onSuccess: (_d, { teamId }) => {
      qc.invalidateQueries({ queryKey: ['team_members', teamId] })
      qc.invalidateQueries({ queryKey: ['team_role'] })
      qc.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: string }) => {
      const { data, error } = await supabase
        .from('team_members').delete().eq('team_id', teamId).eq('user_id', userId).select('user_id')
      if (error) throw error
      if (!data?.length) throw new Error(t('team.error.removeMemberFailed'))
    },
    onSuccess: (_d, { teamId }) => {
      qc.invalidateQueries({ queryKey: ['team_members', teamId] })
      qc.invalidateQueries({ queryKey: ['teams'] })
      qc.invalidateQueries({ queryKey: ['team_role'] })
    },
  })
}

/** Add a registered user directly (by e-mail) — no invitation round-trip. */
export function useAddMemberByEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, email, role }: { teamId: string; email: string; role: InvitableRole }): Promise<Profile> => {
      const { data, error } = await supabase.rpc('add_team_member_by_email', { p_team: teamId, p_email: email, p_role: role })
      if (error) throw new Error(error.message)
      return data as Profile
    },
    onSuccess: (_d, { teamId }) => qc.invalidateQueries({ queryKey: ['team_members', teamId] }),
  })
}

// ─── Team CRUD ───────────────────────────────────────────────────────────────
export function useDeleteTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { error } = await supabase.from('teams').delete().eq('id', teamId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useUpdateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase.from('teams').update({ name }).eq('id', id).select()
      if (error) throw error
      if (!data || data.length === 0) throw new Error(t('team.error.renameFailed'))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useCreateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string): Promise<Team> => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      // No RETURNING: it is checked against teams_select while the row is being
      // inserted, before the AFTER trigger has made the creator a member (065).
      // So the id is ours, and the row is read back once the insert is done.
      const id = crypto.randomUUID()
      const { error } = await supabase.from('teams').insert({ id, name, created_by: user.id, code: '' })
      if (error) throw error
      const { data, error: readError } = await supabase.from('teams').select('*').eq('id', id).single()
      if (readError) throw readError
      return data as Team
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

// ─── Joining (SECURITY DEFINER RPCs — the only way into a team) ──────────────
export function useJoinTeamByCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (code: string): Promise<Team> => {
      const { data, error } = await supabase.rpc('join_team_by_code', { p_code: code })
      if (error) throw new Error(error.message)
      // The function answers with a result object instead of raising: a raised
      // error would roll back the failed-attempt record that rate-limits guessing.
      const result = data as { ok: boolean; error?: string; team?: Team }
      if (!result?.ok || !result.team) throw new Error(result?.error ?? t('team.error.joinFailed'))
      return result.team
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useAcceptInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (token: string): Promise<Team> => {
      const { data, error } = await supabase.rpc('accept_invitation', { p_token: token })
      if (error) throw new Error(error.message)
      return data as Team
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useInvitationPreview(token: string | undefined) {
  return useQuery({
    queryKey: ['invitation_preview', token],
    queryFn: async (): Promise<{ team_name: string; role: InvitableRole; valid: boolean } | null> => {
      if (!token) return null
      const { data, error } = await supabase.rpc('invitation_preview', { p_token: token })
      if (error) throw error
      const row = (data as { team_name: string; role: InvitableRole; valid: boolean }[] | null)?.[0]
      return row ?? null
    },
    enabled: !!token,
  })
}

// ─── Invitations (admin side) ────────────────────────────────────────────────
export function useTeamInvitations(teamId: string | null) {
  return useQuery({
    queryKey: ['invitations', teamId],
    queryFn: async (): Promise<TeamInvitation[]> => {
      if (!teamId) return []
      const { data, error } = await supabase
        .from('team_invitations')
        .select('*')
        .eq('team_id', teamId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as TeamInvitation[]
    },
    enabled: !!teamId,
  })
}

export function useCreateInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, email, role }: { teamId: string; email?: string; role: InvitableRole }): Promise<TeamInvitation> => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const { data, error } = await supabase
        .from('team_invitations')
        .insert({ team_id: teamId, email: email?.trim().toLowerCase() || null, invited_by: user.id, role })
        .select('*')
        .single()
      if (error) throw error
      return data as TeamInvitation
    },
    onSuccess: (_d, { teamId }) => qc.invalidateQueries({ queryKey: ['invitations', teamId] }),
  })
}

/** People with a Fira account who could be invited to this team (RPC 073). */
export interface InviteCandidate {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  /** Already has a pending invitation — shown as "davet edildi", not selectable. */
  invited: boolean
}

export function useInviteCandidates(teamId: string | null, query: string, enabled = true) {
  return useQuery({
    queryKey: ['invite_candidates', teamId, query.trim().toLowerCase()],
    enabled: !!teamId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<InviteCandidate[]> => {
      if (!teamId) return []
      const { data, error } = await supabase.rpc('team_invite_candidates', { p_team: teamId, p_query: query.trim() })
      if (error) throw error
      return (data ?? []) as InviteCandidate[]
    },
  })
}

/** Invite several registered users at once; each gets an inbox row (#4B5442B6). */
export function useInviteUsers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, userIds, role }: { teamId: string; userIds: string[]; role: InvitableRole }) => {
      const { data, error } = await supabase.rpc('invite_users_to_team', { p_team: teamId, p_users: userIds, p_role: role })
      if (error) throw new Error(error.message)
      return (data ?? { invited: 0, skipped: 0 }) as { invited: number; skipped: number }
    },
    onSuccess: (_d, { teamId }) => {
      qc.invalidateQueries({ queryKey: ['invitations', teamId] })
      qc.invalidateQueries({ queryKey: ['invite_candidates', teamId] })
    },
  })
}

export function useRevokeInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, teamId }: { id: string; teamId: string }) => {
      const { error } = await supabase.from('team_invitations').update({ status: 'revoked' }).eq('id', id)
      if (error) throw error
      return teamId
    },
    onSuccess: (teamId) => qc.invalidateQueries({ queryKey: ['invitations', teamId] }),
  })
}

// ─── Invitations (invitee side, matched by my e-mail) ────────────────────────
export function useMyPendingInvitations() {
  return useQuery({
    queryKey: ['my_invitations'],
    queryFn: async (): Promise<PendingInvitation[]> => {
      // GET (#eae148ab): uygulama açılınca/odaklanınca giden ilk istek bu. Kong, PostgREST'e
      // açık tuttuğu boştaki bağlantı tam kapanırken onu kullanırsa POST 502 dönüyordu;
      // GET'i Kong kendisi yeniden deniyor. Fonksiyon STABLE ve argümansız.
      const { data, error } = await supabase.rpc('my_pending_invitations', undefined, { get: true })
      if (error) throw error
      return (data ?? []) as PendingInvitation[]
    },
    staleTime: 60 * 1000,
  })
}

export function useRespondToInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }): Promise<Team | null> => {
      const { data, error } = await supabase.rpc(accept ? 'accept_invitation_by_id' : 'decline_invitation', { p_id: id })
      if (error) throw new Error(error.message)
      return accept ? (data as Team) : null
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my_invitations'] })
      qc.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

export const invitationLink = (token: string) => `${window.location.origin}/invite/${token}`

/** Owner → another member. Old owner becomes admin (RPC transfer_team_ownership). */
export function useTransferOwnership() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: string }) => {
      const { error } = await supabase.rpc('transfer_team_ownership', { p_team: teamId, p_user: userId })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries(),
  })
}
