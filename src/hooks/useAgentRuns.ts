import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { AiRun } from '../types'
import { NO_FIRST_PASS, readFirstPass, type FirstPass } from '../lib/agentStats'

/**
 * Run records for the agent panel (103). RLS decides what comes back: the runs
 * of your teams' tickets, of an agent you own, or everything for a system admin
 * — so the same query serves the personal view and the admin tab.
 *
 * The ticket is embedded for its current status and list; a reader who may see
 * the run but not (or no longer) the ticket gets null there and the panel falls
 * back to the title kept on the run.
 */
const RUN_SELECT =
  'id, request_id, agent_id, ticket_id, team_id, ticket_title, source, outcome, requested_at, started_at, finished_at, heartbeat_at, step, ' +
  'active_seconds, turns, model, output_tokens, cache_read_tokens, cost_usd, version, session_url, ' +
  'ticket:tickets!ai_runs_ticket_id_fkey(id, title, project:projects!tickets_project_id_fkey(name), status_info:ticket_statuses!tickets_status_id_fkey(name, color, category))'

/** PostgREST caps a response at 1000 rows without saying so; the panel says when it hit the cap. */
export const RUNS_CAP = 1000

export function useAgentRuns({ since, until = null, agentId, teamId }: { since: Date | null; /** Exclusive end (a picked date range). */ until?: Date | null; agentId?: string | null; teamId?: string | null }) {
  const from = since ? since.toISOString() : null
  const to = until ? until.toISOString() : null
  return useQuery({
    queryKey: ['ai_runs', from, to, agentId ?? null, teamId ?? null],
    queryFn: async (): Promise<AiRun[]> => {
      let q = supabase.from('ai_runs').select(RUN_SELECT).order('started_at', { ascending: false }).limit(RUNS_CAP)
      if (from) q = q.gte('started_at', from)
      if (to) q = q.lt('started_at', to)
      if (agentId) q = q.eq('agent_id', agentId)
      if (teamId) q = q.eq('team_id', teamId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as AiRun[]
    },
    // Not on the realtime channel (a heartbeat a minute would wake every client): the open panel asks again itself.
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

/**
 * First-pass approval for a period (115). One read-only call, counted on the server under RLS: the
 * reader's own view of the runs and of the tasks decides what is in it, as in the list above.
 * Sent as GET (a stable function with scalar arguments; see the note on 502s in CLAUDE.md): an
 * argument that is not given is left out, not sent as null.
 */
export function useFirstPass({ since, until = null, agentId, teamId }: { since: Date | null; until?: Date | null; agentId?: string | null; teamId?: string | null }) {
  const from = since ? since.toISOString() : null
  const to = until ? until.toISOString() : null
  return useQuery({
    queryKey: ['ai_runs', 'first_pass', from, to, agentId ?? null, teamId ?? null],
    queryFn: async (): Promise<FirstPass> => {
      const args: Record<string, string> = {}
      if (from) args.p_since = from
      if (to) args.p_until = to
      if (agentId) args.p_agent = agentId
      if (teamId) args.p_team = teamId
      const { data, error } = await supabase.rpc('agent_first_pass', args, { get: true })
      if (error) throw error
      return data ? readFirstPass(data) : NO_FIRST_PASS
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}
