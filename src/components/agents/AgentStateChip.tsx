import type { AgentState } from '../../lib/agents'
import { useT } from '../../i18n'

/**
 * What an agent is doing right now, said the same way wherever it is shown
 * (#c8be788f): Claude'um said "Dinliyor" while the panel said "Çalışıyor" for
 * the same agent at the same moment. The state comes from `agentState`.
 */
export function AgentStateChip({ state }: { state: AgentState }) {
  const t = useT()
  return (
    <span
      data-agent-state={state}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
        state === 'working' ? 'text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/40' : state === 'online' ? 'text-success bg-success/10' : 'text-fg-muted bg-raised'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${state === 'working' ? 'bg-primary-600 dark:bg-primary-400' : state === 'online' ? 'bg-success' : 'bg-fg-faint'}`} aria-hidden="true" />
      {t(state === 'working' ? 'me.agents.state.working' : state === 'online' ? 'settings.agent.online' : 'settings.agent.offline')}
    </span>
  )
}
