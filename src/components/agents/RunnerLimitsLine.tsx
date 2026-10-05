import { runnerLimits } from '../../lib/agents'
import type { Agent } from '../../types'
import { useT } from '../../i18n'

/**
 * What a runner may do, in one line, and why it is not taking a job when it is not (#2252823c).
 * Shown on the agent's card in Claude'um and in the panel; nothing for an agent that listens from
 * a chat session. The limits are the runner's own report: set on its computer, only shown here.
 */
export function RunnerLimitsLine({ runner, online }: { runner: Agent['runner'] | null | undefined; online: boolean }) {
  const t = useT()
  const l = online ? runnerLimits(runner) : null
  if (!l) return null
  const perJob = [
    l.maxTurns !== null ? t('settings.agent.limits.turns', { n: l.maxTurns }) : null,
    l.maxMinutes !== null ? t('settings.agent.limits.minutes', { n: l.maxMinutes }) : null,
    l.maxBudgetUsd ? t('settings.agent.limits.budget', { n: l.maxBudgetUsd }) : null,
  ].filter(Boolean).join(', ')
  return (
    <span data-runner-limits={l.waiting ?? 'ok'}>
      {t('settings.agent.limits.today', { n: l.startedToday, max: l.maxPerDay })} · {t('settings.agent.limits.parallel', { n: l.maxParallel })}
      {perJob && <> · {t('settings.agent.limits.perJob', { list: perJob })}</>}
      {l.waiting && <span className="block text-warning">{t(l.waiting === 'daily' ? 'settings.agent.limits.dailyFull' : 'settings.agent.limits.parallelFull')}</span>}
      {l.passive && (
        <span className="block" data-runner-passive={l.passive.enabled ? (l.passive.full ? 'full' : 'on') : 'off'}>
          {l.passive.enabled ? t('settings.agent.limits.passive', { n: l.passive.doneToday, max: l.passive.maxPerDay }) : t('settings.agent.limits.passiveOff')}
          {l.passive.full && <span className="text-warning"> · {t('settings.agent.limits.passiveFull')}</span>}
        </span>
      )}
    </span>
  )
}
