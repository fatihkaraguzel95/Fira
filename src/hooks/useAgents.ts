import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Agent, AiWorkRequest } from '../types'

/**
 * Agents (100): an AI account bound to the person it works for. RLS shows the
 * agents of the teams you share with them (plus your own), so one unfiltered
 * read is the whole list — a handful of rows.
 */
const AGENT_SELECT =
  '*, profile:profiles!agents_profile_id_fkey(id, full_name, avatar_url), owner:profiles!agents_owner_id_fkey(id, full_name, avatar_url)'

export function useAgents(opts: { live?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['agents'],
    enabled: opts.enabled ?? true,
    queryFn: async (): Promise<Agent[]> => {
      const { data, error } = await supabase.from('agents').select(AGENT_SELECT).order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as Agent[]
    },
    staleTime: 60_000,
    // The table is not on the realtime channel (a heartbeat a minute would wake
    // every client); the one screen that shows "last seen" asks again itself.
    refetchInterval: opts.live ? 30_000 : false,
  })
}

export type AgentOpenWork = Pick<AiWorkRequest, 'id' | 'ticket_id' | 'status' | 'created_at'> & { ticket: { id: string; title: string } | null }

/**
 * The agent's open requests, oldest first: the one it is working on (if any) and
 * what waits behind it. Claude'um and the agent panel both read "is it working"
 * from here, so the two never disagree (#c8be788f).
 */
export function useAgentOpenWork(profileId: string) {
  return useQuery({
    queryKey: ['ai_work', 'agent', profileId],
    queryFn: async (): Promise<AgentOpenWork[]> => {
      const { data, error } = await supabase
        .from('ai_work_requests')
        .select('id, ticket_id, status, created_at, ticket:tickets(id, title)')
        .eq('ai_user_id', profileId)
        .in('status', ['pending', 'processing'])
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as AgentOpenWork[]
    },
    refetchInterval: 30_000,
  })
}

/** Owner (or a system admin) changes the agent's settings; the server clamps the values. */
export function useUpdateAgentSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ agentId, patch }: { agentId: string; patch: Partial<Pick<Agent, 'assign_trigger' | 'poll_seconds'>> & { /** Merged into the stored settings key by key. */ settings?: Record<string, unknown> } }) => {
      const { error } = await supabase.rpc('agent_update_settings', { p_agent: agentId, p_patch: patch })
      if (error) throw error
    },
    onMutate: async ({ agentId, patch }) => {
      await qc.cancelQueries({ queryKey: ['agents'] })
      const prev = qc.getQueryData<Agent[]>(['agents'])
      qc.setQueryData<Agent[]>(['agents'], (list) => list?.map((a) => (a.id === agentId ? { ...a, ...patch, settings: { ...a.settings, ...(patch.settings ?? {}) } } : a)))
      return prev
    },
    onError: (_e, _v, prev) => { if (prev) qc.setQueryData(['agents'], prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

/**
 * A person creates their own agent (105): an AI account owned by them, put
 * into the teams they pick (only teams they are a member of; the agent's role
 * there never exceeds theirs). One agent per person.
 */
export function useCreateAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, teamIds }: { name: string; teamIds: string[] }) => {
      const { data, error } = await supabase.rpc('agent_create', { p_name: name, p_team_ids: teamIds })
      if (error) throw error
      return data as Agent
    },
    // The form shows the refusal next to itself ("you already have one", "not your team").
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] })
      void qc.invalidateQueries({ queryKey: ['team_members'] })
    },
  })
}

/** The teams an agent is a member of, as far as the reader can see them (RLS: the teams the reader is in too). */
export function useAgentTeams(profileId: string | null) {
  return useQuery({
    queryKey: ['agent-teams', profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<{ team_id: string; role: string }[]> => {
      const { data, error } = await supabase.from('team_members').select('team_id, role').eq('user_id', profileId!)
      if (error) throw error
      return (data ?? []) as { team_id: string; role: string }[]
    },
  })
}

/** The owner decides which of their teams the agent is in. */
export function useSetAgentTeams() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ agentId, teamIds }: { agentId: string; profileId: string; teamIds: string[] }) => {
      const { error } = await supabase.rpc('agent_set_teams', { p_agent: agentId, p_team_ids: teamIds })
      if (error) throw error
    },
    onSettled: (_d, _e, { profileId }) => {
      void qc.invalidateQueries({ queryKey: ['agent-teams', profileId] })
      void qc.invalidateQueries({ queryKey: ['team_members'] })
    },
  })
}

export { agentOnline, agentShortName } from '../lib/agents'
