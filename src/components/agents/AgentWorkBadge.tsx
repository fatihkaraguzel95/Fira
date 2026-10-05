import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useT } from '../../i18n'
import { useAgents } from '../../hooks/useAgents'
import { agentShortName } from '../../lib/agents'
import { runStalled } from '../../lib/agentStats'
import { Icon } from '../ui/Icon'

/**
 * "Claude is working on this, at this step" on a card and on a list row (phase 5, #0d6aac9f).
 * Until now that was said only inside the task window and on the agent panel.
 *
 * One query per team, not per task: the runs that are open now (`ai_runs.outcome = running`), with
 * the step the agent last reported. Every card of a board reads the same answer. It is asked again
 * every minute for the step (the run table is not on the realtime channel) and at once when a
 * request changes (`useRealtimeSync` invalidates `['agent_work']`), so the badge comes and goes with
 * the work.
 */
export interface AgentWorkNow { step: string | null; stalled: boolean; name: string }

interface RunningRow { ticket_id: string; agent_id: string | null; step: string | null; heartbeat_at: string | null; started_at: string }

export function useTeamAgentWork(teamId: string | null | undefined): Map<string, AgentWorkNow> {
  const { data: rows } = useQuery({
    queryKey: ['agent_work', teamId ?? null],
    enabled: !!teamId,
    refetchInterval: 60_000,
    staleTime: 20_000,
    queryFn: async (): Promise<RunningRow[]> => {
      const { data, error } = await supabase.from('ai_runs')
        .select('ticket_id, agent_id, step, heartbeat_at, started_at')
        .eq('team_id', teamId!).eq('outcome', 'running').not('ticket_id', 'is', null)
      if (error) throw error
      return (data ?? []) as RunningRow[]
    },
  })
  // The agents are asked for only when something is running: a board without agent work costs one small query.
  const { data: agents } = useAgents({ enabled: !!rows?.length })
  return useMemo(() => {
    const out = new Map<string, AgentWorkNow>()
    const now = Date.now()
    for (const r of rows ?? []) {
      const agent = agents?.find((a) => a.id === r.agent_id)
      out.set(r.ticket_id, { step: r.step?.trim() || null, stalled: runStalled({ outcome: 'running', heartbeat_at: r.heartbeat_at, started_at: r.started_at }, now), name: agentShortName(agent?.profile?.full_name) })
    }
    return out
  }, [rows, agents])
}

/** The badge itself; nothing when no agent is on the task. `compact` (a list row) shows the mark and the step only. */
export function AgentWorkBadge({ ticketId, teamId, compact = false, className = '' }: { ticketId: string; teamId: string | null | undefined; compact?: boolean; className?: string }) {
  const t = useT()
  const work = useTeamAgentWork(teamId).get(ticketId)
  if (!work) return null
  const says = work.stalled ? t('board.card.agentStalled', { name: work.name }) : t('board.card.agentWorking', { name: work.name })
  const full = work.step && !work.stalled ? `${says} · ${work.step}` : says
  return (
    <span
      title={full}
      data-agent-work={work.stalled ? 'stalled' : 'working'}
      className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium leading-tight ${work.stalled ? 'bg-warning/10 text-warning' : 'bg-primary-500/10 text-primary-700 dark:text-primary-300'} ${className}`}
    >
      <Icon name="sparkle" className="flex-shrink-0" />
      <span className="truncate">{compact ? (work.stalled ? says : work.step ?? says) : full}</span>
    </span>
  )
}
