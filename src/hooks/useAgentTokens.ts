import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/supabase'
import { connectionCode } from '../lib/agents'

/**
 * Agent keys (101). The table itself is closed; these three functions are the
 * only way in and each checks that the caller owns the agent (or is a system
 * admin). A key is returned once, at creation — the list carries its first
 * characters only.
 */
export interface AgentToken {
  id: string
  prefix: string
  label: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export function useAgentTokens(agentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['agent-tokens', agentId],
    enabled,
    queryFn: async (): Promise<AgentToken[]> => {
      // STABLE with one scalar argument: asked as a GET so Kong may retry it (CLAUDE.md, RPC ve 502).
      const { data, error } = await supabase.rpc('agent_list_tokens', { p_agent: agentId }, { get: true })
      if (error) throw error
      return (data ?? []) as AgentToken[]
    },
    // "Last used" moves when the listener connects; the screen is open while someone sets it up.
    refetchInterval: 20_000,
  })
}

/** Creates a key and returns the connection code to paste into `fira-agent login` — shown once. */
export function useCreateAgentToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ agentId, label }: { agentId: string; label: string }): Promise<{ id: string; prefix: string; code: string }> => {
      const { data, error } = await supabase.rpc('agent_create_token', { p_agent: agentId, p_label: label })
      if (error) throw error
      const out = data as { id: string; key: string; prefix: string }
      return { id: out.id, prefix: out.prefix, code: connectionCode({ url: SUPABASE_URL, anon: SUPABASE_ANON_KEY, key: out.key }) }
    },
    onSuccess: (_d, { agentId }) => qc.invalidateQueries({ queryKey: ['agent-tokens', agentId] }),
  })
}

export function useRevokeAgentToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tokenId }: { tokenId: string; agentId: string }) => {
      const { error } = await supabase.rpc('agent_revoke_token', { p_token: tokenId })
      if (error) throw error
    },
    onSuccess: (_d, { agentId }) => qc.invalidateQueries({ queryKey: ['agent-tokens', agentId] }),
  })
}
