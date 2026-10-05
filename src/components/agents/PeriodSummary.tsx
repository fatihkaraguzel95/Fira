import { useMemo } from 'react'
import { useT, type TranslationKey } from '../../i18n'
import { durationParts, firstPassRate, isMeasured, periodStart, summarizeRuns, type FirstPass, type Period } from '../../lib/agentStats'
import { useAgentRuns, useFirstPass } from '../../hooks/useAgentRuns'

/**
 * A period in one line (phase 5, #0969809f): what came to review, how much of it was approved the
 * first time, what came back, what is still waiting, and the time worked. Results, not tokens: no
 * ranking between people and no token count here.
 *
 * The same line on the agent panel (for the period picked there) and on the Claude'um card (the
 * last seven days), from the same two sources, so the two cannot disagree.
 */
const PERIOD_KEY: Record<Period | 'custom', TranslationKey> = {
  today: 'me.agents.sum.period.today', '7d': 'me.agents.sum.period.7d', '30d': 'me.agents.sum.period.30d', all: 'me.agents.sum.period.all', custom: 'me.agents.sum.period.custom',
}

type Translate = ReturnType<typeof useT>
function duration(seconds: number, t: Translate): string {
  const d = durationParts(seconds)
  if (d.unit === 'sec') return t('me.agents.dur.sec', { n: d.s })
  if (d.unit === 'min') return t('me.agents.dur.min', { n: d.m })
  return d.m ? t('me.agents.dur.hourMin', { h: d.h, m: d.m }) : t('me.agents.dur.hour', { h: d.h })
}

export function PeriodSummaryLine({ period, firstPass, activeSeconds, className = '' }: {
  period: Period | 'custom'
  firstPass: FirstPass
  /** Seconds really worked in the period; null when nothing in it was measured. */
  activeSeconds: number | null
  className?: string
}) {
  const t = useT()
  const label = t(PERIOD_KEY[period])
  if (firstPass.delivered === 0) return <p className={className} data-agent-summary="none">{t('me.agents.sum.none', { period: label })}</p>
  const parts = [t('me.agents.sum.delivered', { period: label, n: firstPass.delivered })]
  if (firstPassRate(firstPass) !== null) {
    parts.push(t('me.agents.sum.firstPass', { n: firstPass.firstPass }))
    parts.push(t('me.agents.sum.returned', { n: firstPass.returned }))
  }
  if (firstPass.waiting > 0) parts.push(t('me.agents.sum.waiting', { n: firstPass.waiting }))
  if (activeSeconds != null) parts.push(t('me.agents.sum.time', { time: duration(activeSeconds, t) }))
  return <p className={className} data-agent-summary="some">{parts.join(' · ')}</p>
}

/** The last seven days of one agent, for the Claude'um card: asks for its own numbers. */
export function AgentWeekSummary({ agentId, className = '' }: { agentId: string; className?: string }) {
  const since = useMemo(() => periodStart('7d'), [])
  const { data: runs = [] } = useAgentRuns({ since, agentId })
  const { data: firstPass } = useFirstPass({ since, agentId })
  const measured = runs.filter((r) => r.outcome !== 'running' && isMeasured(r))
  if (!firstPass) return null
  return <PeriodSummaryLine period="7d" firstPass={firstPass} activeSeconds={measured.length ? summarizeRuns(runs).activeSeconds : null} className={className} />
}
