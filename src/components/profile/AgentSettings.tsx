import { useEffect, useState } from 'react'
import { RunnerLimitsLine } from '../agents/RunnerLimitsLine'
import { AgentWeekSummary } from '../agents/PeriodSummary'
import { useNavigate } from 'react-router-dom'
import { useAgents, useAgentOpenWork, useUpdateAgentSettings, agentOnline, agentShortName } from '../../hooks/useAgents'
import { useAgentPresence } from '../../hooks/useAgentPresence'
import { agentState, asDeployPolicy, DEPLOY_POLICIES, runnerLimits, type AgentPresence } from '../../lib/agents'
import { AgentStateChip } from '../agents/AgentStateChip'
import { useIsAdmin } from '../../hooks/useAdmin'
import { openTicket, go } from '../../lib/nav'
import { humanTime, exactTime } from '../../lib/time'
import { UserAvatar } from '../ticket/UserAvatar'
import { Spark } from '../ticket/AiSpark'
import { AgentKeys } from './AgentKeys'
import { AgentPrefs } from './AgentPrefs'
import { AgentTeams, CreateAgentForm, SetupSteps } from './AgentSetup'
import { useT, type TranslationKey } from '../../i18n'
import type { Agent, Profile } from '../../types'

/**
 * "Claude'um" — the agent that works for you (100): whether its listener is
 * connected, what it is on, and how it is triggered. Shown to the owner and to
 * the agent's own account; only the owner (or a system admin) changes anything.
 *
 * The screen is the first place to look when "I assigned it and nothing
 * happened", so every line answers one question of that chain: is it listening,
 * does assignment start work here, how soon does it look at the queue.
 */

/** Seconds offered for the queue interval; the server clamps to 30–3600 anyway. */
const POLL_CHOICES = [30, 60, 120, 300, 600, 900, 1800]

const PLACE: Record<string, TranslationKey> = { personal: 'settings.agent.place.personal', server: 'settings.agent.place.server' }
const KIND: Record<string, TranslationKey> = { session: 'settings.agent.kind.session', runner: 'settings.agent.kind.runner' }
const WATCH: Record<string, TranslationKey> = { poll: 'settings.agent.watch.poll', realtime: 'settings.agent.watch.realtime' }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-28 flex-shrink-0 text-xs text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-fg">{children}</dd>
    </div>
  )
}

function AgentCard({ agent, canEdit, isOwner, presence, onClose }: { agent: Agent; canEdit: boolean; isOwner: boolean; presence: AgentPresence; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const update = useUpdateAgentSettings()
  const { data: work = [] } = useAgentOpenWork(agent.profile_id)
  // "Connected" depends on the clock, not only on the data: re-judge it while the screen is open.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const name = agent.profile?.full_name || 'AI'
  const short = agentShortName(agent.profile?.full_name)
  const online = agentOnline(agent, now, presence)
  const running = work.find((w) => w.status === 'processing')
  const waiting = work.filter((w) => w.status === 'pending')
  const runner = agent.runner ?? {}
  // How it listens is only true while it does: a listener that is gone keeps its place, nothing more (#c813e104).
  const where = (online ? [PLACE[String(runner.place)], KIND[String(runner.kind)], WATCH[String(runner.watch)]] : [PLACE[String(runner.place)]]).filter(Boolean).map((k) => t(k))
  const open = (id: string) => { onClose(); openTicket(navigate, id) }
  const pollLabel = (s: number) => (s < 60 ? t('settings.agent.seconds', { n: s }) : t('settings.agent.minutes', { n: Math.round(s / 60) }))
  const choices = POLL_CHOICES.includes(agent.poll_seconds) ? POLL_CHOICES : [...POLL_CHOICES, agent.poll_seconds].sort((a, b) => a - b)

  return (
    <section data-agent-card={agent.id} className="rounded-xl border border-line bg-surface">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-line-soft">
        <UserAvatar user={agent.profile as Profile} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg truncate">{name}</p>
          <p className="text-xs text-fg-muted truncate">
            {agent.owner?.full_name ? t('settings.agent.ownedBy', { name: agent.owner.full_name }) : t('settings.agent.noOwner')}
          </p>
        </div>
        <button
          type="button"
          data-agent-open-panel
          onClick={() => { onClose(); go(navigate, `/me/agents?agent=${agent.id}`) }}
          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised transition-colors cursor-pointer"
        >
          {t('settings.agent.openPanel')}
        </button>
        <AgentStateChip state={agentState(online, !!running)} />
      </header>

      <SetupSteps agent={agent} online={online} canEdit={canEdit} />

      <dl className="px-4 py-2">
        <Row label={t('settings.agent.lastSeen')}>
          {agent.last_seen_at
            ? <span title={exactTime(agent.last_seen_at)}>{humanTime(agent.last_seen_at, new Date(now))}</span>
            : <span className="text-fg-muted">{t('settings.agent.neverSeen')}</span>}
        </Row>
        {where.length > 0 && <Row label={t('settings.agent.where')}>{where.join(' · ')}</Row>}
        {online && runnerLimits(runner) && <Row label={t('settings.agent.limits.label')}><RunnerLimitsLine runner={runner} online={online} /></Row>}
        <Row label={t('settings.agent.week')}><AgentWeekSummary agentId={agent.id} /></Row>
        <Row label={t('settings.agent.currentWork')}>
          {running ? (
            <button
              type="button"
              data-agent-current
              onClick={() => open(running.ticket_id)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md text-left text-primary-700 dark:text-primary-300 hover:underline cursor-pointer"
            >
              <Spark className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{running.ticket?.title || t('settings.agent.untitled')}</span>
            </button>
          ) : (
            <span className="text-fg-muted">{t('settings.agent.idle')}</span>
          )}
        </Row>
        {waiting.length > 0 && (
          <Row label={t('settings.agent.queue')}>
            <ul className="space-y-0.5">
              {waiting.slice(0, 5).map((w) => (
                <li key={w.id}>
                  <button type="button" onClick={() => open(w.ticket_id)} className="max-w-full truncate rounded-md text-left text-fg-2 hover:underline cursor-pointer">
                    {w.ticket?.title || t('settings.agent.untitled')}
                  </button>
                </li>
              ))}
              {waiting.length > 5 && <li className="text-xs text-fg-muted">{t('settings.agent.queueMore', { n: waiting.length - 5 })}</li>}
            </ul>
          </Row>
        )}
        <Row label={t('settings.agent.teams.label')}><AgentTeams agent={agent} isOwner={isOwner} /></Row>
      </dl>

      <div className="px-4 py-3 border-t border-line-soft space-y-4">
        <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider">{t('settings.agent.triggering')}</p>

        <div className="flex items-start gap-3" data-agent-assign-trigger>
          <button
            role="switch"
            aria-checked={agent.assign_trigger}
            aria-label={t('settings.agent.assignTrigger')}
            disabled={!canEdit}
            onClick={() => update.mutate({ agentId: agent.id, patch: { assign_trigger: !agent.assign_trigger } })}
            className={`w-9 h-5 rounded-full flex-shrink-0 transition-colors relative mt-0.5 disabled:opacity-50 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed'} ${agent.assign_trigger ? 'bg-primary-600' : 'bg-line'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${agent.assign_trigger ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">{t('settings.agent.assignTrigger')}</p>
            <p className="text-xs text-fg-muted">
              {agent.assign_trigger ? t('settings.agent.assignTriggerOn', { name: short }) : t('settings.agent.assignTriggerOff', { name: short })}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3" data-agent-poll>
          <select
            aria-label={t('settings.agent.poll')}
            value={agent.poll_seconds}
            disabled={!canEdit}
            onChange={(e) => update.mutate({ agentId: agent.id, patch: { poll_seconds: Number(e.target.value) } })}
            className="text-sm bg-field border border-line rounded-lg px-2 py-1.5 text-fg disabled:opacity-60 flex-shrink-0"
          >
            {choices.map((s) => <option key={s} value={s}>{pollLabel(s)}</option>)}
          </select>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">{t('settings.agent.poll')}</p>
            <p className="text-xs text-fg-muted">{t('settings.agent.pollHint', { name: short })}</p>
          </div>
        </div>

        <div className="flex items-start gap-3" data-agent-deploy>
          <select
            aria-label={t('settings.agent.deploy')}
            value={asDeployPolicy(agent.settings?.deploy)}
            disabled={!canEdit}
            onChange={(e) => update.mutate({ agentId: agent.id, patch: { settings: { deploy: e.target.value } } })}
            className="text-sm bg-field border border-line rounded-lg px-2 py-1.5 text-fg disabled:opacity-60 flex-shrink-0"
          >
            {DEPLOY_POLICIES.map((p) => <option key={p} value={p}>{t(`settings.agent.deploy.${p}`)}</option>)}
          </select>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">{t('settings.agent.deploy')}</p>
            <p className="text-xs text-fg-muted">{t('settings.agent.deployHint', { name: short })}</p>
          </div>
        </div>

        {!canEdit && <p className="text-xs text-fg-muted">{t('settings.agent.ownerOnly')}</p>}
      </div>

      {/* What this person's Claude should keep in mind, after the team's and the list's rule pages (107). */}
      <AgentPrefs agent={agent} short={short} canEdit={canEdit} />

      {/* Keys are the owner's business only: the list is refused to anyone else. */}
      {canEdit && <AgentKeys agentId={agent.id} />}
    </section>
  )
}

export function AgentSettings({ agents, userId, ownerName, canCreate, onClose }: {
  agents: Agent[]
  userId: string | null
  /** The signed-in person's name, for the name offered to a new agent. */
  ownerName: string | null
  /** No agent yet and not an agent account itself: the screen starts with "create yours". */
  canCreate: boolean
  onClose: () => void
}) {
  const t = useT()
  const { data: isAdmin = false } = useIsAdmin()
  // Keep "last seen" moving while the screen is open (the table is not on the realtime channel).
  useAgents({ live: true })
  // "Dinliyor" itself follows the listener's presence, the moment it changes.
  const presence = useAgentPresence(agents.map((a) => a.id))

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-fg">{t('settings.tab.agent')}</h3>
        <p className="text-xs text-fg-muted mt-0.5">{t('settings.agent.subtitle')}</p>
      </div>
      {canCreate && <CreateAgentForm ownerName={ownerName} />}
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} canEdit={isAdmin || (!!userId && a.owner_id === userId)} isOwner={!!userId && a.owner_id === userId} presence={presence[a.id] ?? 'unknown'} onClose={onClose} />
      ))}
    </div>
  )
}
