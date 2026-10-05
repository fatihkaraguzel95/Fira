import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../ui/Icon'
import { RunnerLimitsLine } from './RunnerLimitsLine'
import { runnerLimits } from '../../lib/agents'
import { useNavigate } from 'react-router-dom'
import { useAgents, useAgentOpenWork } from '../../hooks/useAgents'
import { useAgentRuns, useFirstPass, RUNS_CAP } from '../../hooks/useAgentRuns'
import { PeriodSummaryLine } from './PeriodSummary'
import { usePassiveJobs } from '../../hooks/usePassive'
import { agentOnline, agentShortName, agentState, type AgentPresence } from '../../lib/agents'
import { AgentStateChip } from './AgentStateChip'
import { useAgentPresence } from '../../hooks/useAgentPresence'
import { useMyTeams, useTeamMembers } from '../../hooks/useTeams'
import { DateInput } from '../ui/DateInput'
import {
  PERIODS, compactNumber, durationParts, isMeasured, modelLabel, modelSplit, periodStart, rangeBounds, firstPassRate, runStalled, runsByDay, summarizePassive, summarizeRuns, NO_FIRST_PASS, OTHER_MODEL,
  type DayPoint, type Period,
} from '../../lib/agentStats'
import { openTicket, go } from '../../lib/nav'
import { displayTime, exactTime } from '../../lib/time'
import { UserAvatar } from '../ticket/UserAvatar'
import { RunDetail } from './RunDetail'
import { Spark } from '../ticket/AiSpark'
import { localeOf, useT, type TranslationKey } from '../../i18n'
import type { Agent, AiRun, Profile } from '../../types'

/**
 * The agent panel (103, #30adc936): whose Claude worked on what, for how long,
 * and what that took. One component for three readers — RLS decides the rows:
 * a team member sees the runs of the team's tickets, an owner those of their
 * agent, a system admin everything (Yönetim › Ajanlar renders this same view).
 *
 * What is shown is results and time. Tokens appear as the cost of a task, next
 * to the task; there is no ranking of people (report §4).
 */

type Translate = ReturnType<typeof useT>

// Categorical slots for the model split — the validated order of the dataviz
// palette, light and dark steps (all checks pass on Fira's two surfaces; three
// light steps are under 3:1 on white, so the legend carries the counts as text).
const SLOT = [
  'bg-[#2a78d6] dark:bg-[#3987e5]',
  'bg-[#eb6834] dark:bg-[#d95926]',
  'bg-[#1baf7a] dark:bg-[#199e70]',
  'bg-[#eda100] dark:bg-[#c98500]',
  'bg-[#e87ba4] dark:bg-[#d55181]',
  'bg-[#008300] dark:bg-[#008300]',
  'bg-[#4a3aa7] dark:bg-[#9085e9]',
  'bg-[#e34948] dark:bg-[#e66767]',
]
const slotClass = (slot: number) => (slot >= 0 ? SLOT[slot % SLOT.length] : 'bg-fg-faint')

const PERIOD_KEY: Record<Period, TranslationKey> = {
  today: 'me.agents.period.today', '7d': 'me.agents.period.7d', '30d': 'me.agents.period.30d', all: 'me.agents.period.all',
}
const OUTCOME_KEY: Record<AiRun['outcome'], TranslationKey> = {
  running: 'me.agents.outcome.running', done: 'me.agents.outcome.done', failed: 'me.agents.outcome.failed', cancelled: 'me.agents.outcome.cancelled',
}

function duration(seconds: number, t: Translate): string {
  const d = durationParts(seconds)
  if (d.unit === 'sec') return t('me.agents.dur.sec', { n: d.s })
  if (d.unit === 'min') return t('me.agents.dur.min', { n: d.m })
  return d.m ? t('me.agents.dur.hourMin', { h: d.h, m: d.m }) : t('me.agents.dur.hour', { h: d.h })
}
const money = (usd: number) => new Intl.NumberFormat(localeOf(), { style: 'currency', currency: 'USD' }).format(usd)
const percent = (share: number) => new Intl.NumberFormat(localeOf(), { style: 'percent', maximumFractionDigits: 0 }).format(share)

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm" data-agent-stat>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-fg-muted">{sub}</p>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <dt className="w-24 flex-shrink-0 text-xs text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-fg">{children}</dd>
    </div>
  )
}

function AgentCard({ agent, runs, now, presence, onOpenTicket }: { agent: Agent; runs: AiRun[]; now: number; presence: AgentPresence; onOpenTicket: (id: string) => void }) {
  const t = useT()
  const mine = runs.filter((r) => r.agent_id === agent.id)
  const running = mine.find((r) => r.outcome === 'running')
  const online = agentOnline(agent, now, presence)
  const lastModel = mine.find((r) => r.model)?.model ?? null
  // The same question, asked the same way as Claude'um (#c8be788f): the open request
  // says whether it is working; the run only adds how long and which step.
  const { data: work = [] } = useAgentOpenWork(agent.profile_id)
  const request = work.find((w) => w.status === 'processing') ?? null
  const state = agentState(online, !!request)
  const runner = agent.runner ?? {}
  const where = [
    runner.place === 'personal' ? t('settings.agent.place.personal') : runner.place === 'server' ? t('settings.agent.place.server') : null,
    // how it listens is only true while it does
    !online ? null : runner.kind === 'runner' ? t('settings.agent.kind.runner') : runner.kind === 'session' ? t('settings.agent.kind.session') : null,
    !online ? null : runner.watch === 'realtime' ? t('settings.agent.watch.realtime') : runner.watch === 'poll' ? t('settings.agent.watch.poll') : null,
  ].filter(Boolean)
  const interval = agent.poll_seconds < 60 ? t('settings.agent.seconds', { n: agent.poll_seconds }) : t('settings.agent.minutes', { n: Math.round(agent.poll_seconds / 60) })

  return (
    <section data-agent-panel-card={agent.id} className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <header className="flex items-center gap-3">
        <UserAvatar user={agent.profile as Profile} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg truncate">{agent.profile?.full_name || 'AI'}</p>
          <p className="text-xs text-fg-muted truncate">{agent.owner?.full_name ? t('settings.agent.ownedBy', { name: agent.owner.full_name }) : t('settings.agent.noOwner')}</p>
        </div>
        <AgentStateChip state={state} />
      </header>
      <dl className="mt-3">
        <Row label={t('settings.agent.currentWork')}>
          {running ? (
            <button
              type="button"
              disabled={!running.ticket_id}
              onClick={() => running.ticket_id && onOpenTicket(running.ticket_id)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md text-left text-primary-700 dark:text-primary-300 enabled:hover:underline enabled:cursor-pointer"
            >
              <Spark className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{running.ticket?.title ?? running.ticket_title ?? t('settings.agent.untitled')}</span>
              <span className="flex-shrink-0 text-fg-muted">· {duration((now - new Date(running.started_at).getTime()) / 1000, t)}{running.step ? ` · ${running.step}` : ''}</span>
            </button>
          ) : request ? (
            // The request is claimed but its run has not reached this list yet (it refreshes every 30 s).
            <button type="button" onClick={() => onOpenTicket(request.ticket_id)} className="inline-flex max-w-full items-center gap-1.5 rounded-md text-left text-primary-700 dark:text-primary-300 hover:underline cursor-pointer">
              <Spark className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{request.ticket?.title || t('settings.agent.untitled')}</span>
            </button>
          ) : <span className="text-fg-muted">{t('settings.agent.idle')}</span>}
        </Row>
        <Row label={t('settings.agent.where')}>{where.length ? where.join(' · ') : <span className="text-fg-muted">—</span>}</Row>
        {online && runnerLimits(runner) && <Row label={t('settings.agent.limits.label')}><RunnerLimitsLine runner={runner} online={online} /></Row>}
        <Row label={t('me.agents.card.model')}>{lastModel ? modelLabel(lastModel) : <span className="text-fg-muted">—</span>}</Row>
        <Row label={t('settings.agent.triggering')}>
          {t(agent.assign_trigger ? 'me.agents.card.triggerAssign' : 'me.agents.card.triggerButton')} · {t('me.agents.card.fallback', { interval })}
        </Row>
      </dl>
    </section>
  )
}

/**
 * One series, one bar a day. The whole column is the hover target (a thin bar
 * is hard to hit), the value appears above the bar it belongs to, and only the
 * highest day is labelled all the time — a number on every bar would be the
 * table again, and that is below.
 */
function DayBars({ title, subtitle, points, pick, label }: {
  title: string
  subtitle: string
  points: DayPoint[]
  pick: (p: DayPoint) => number
  label: (value: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.map(pick))
  const peak = points.reduce((best, p, i) => (pick(p) > pick(points[best]) ? i : best), 0)
  const last = points.length - 1
  const every = Math.max(1, Math.ceil(points.length / 7))
  const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(localeOf(), { day: 'numeric', month: 'short' })

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-sm" data-agent-chart>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="text-xs text-fg-muted">{subtitle}</p>
      {points.length === 0 ? (
        <p className="py-10 text-center text-xs text-fg-muted">—</p>
      ) : (
        <>
          <div className="mt-6 flex h-28 items-end gap-0.5 border-b border-line" role="list" onMouseLeave={() => setHover(null)}>
            {points.map((p, i) => {
              const value = pick(p)
              // Only the highest day is labelled all the time: a second standing label (the last day) ran into its taller neighbours.
              const shown = hover === i || (hover === null && value > 0 && i === peak)
              return (
                <div
                  key={p.day}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${dayLabel(p.day)}: ${label(value)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {shown && (
                    <span
                      // At either end the label hangs inwards, or it would be cut by the edge of the card.
                      className={`pointer-events-none absolute z-10 whitespace-nowrap text-xs tabular-nums ${i < 2 ? 'left-0' : i > last - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2'} ${hover === i ? 'rounded-md bg-raised px-1.5 py-0.5 font-medium text-fg shadow-lg' : 'text-fg-2'}`}
                      style={{ bottom: `calc(${(value / max) * 100}% + 4px)` }}
                    >
                      {hover === i ? `${dayLabel(p.day)} · ${label(value)}` : label(value)}
                    </span>
                  )}
                  <span
                    className={`mx-auto w-full max-w-6 rounded-t-md transition-colors ${hover === i ? 'bg-primary-600 dark:bg-primary-300' : 'bg-primary-500 dark:bg-primary-400'}`}
                    style={{ height: value > 0 ? `max(2px, ${(value / max) * 100}%)` : 0 }}
                  />
                </div>
              )
            })}
          </div>
          <div className="mt-1 flex gap-0.5" aria-hidden="true">
            {points.map((p, i) => (
              <span key={p.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-xs text-fg-muted">
                {i % every === 0 || i === last ? dayLabel(p.day) : ''}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function RunStatus({ run, now, t }: { run: AiRun; now: number; t: Translate }) {
  // In progress but silent for minutes: its listener is gone; nobody is on it until the agent reconnects.
  if (runStalled(run, now)) {
    return (
      <span data-run-stalled className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-2xs font-semibold text-fg" title={t('me.agents.stalledHint')}>
        <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
        {t('me.agents.outcome.stalled')}
      </span>
    )
  }
  if (run.outcome === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-700 dark:text-primary-300">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-600" />
        </span>
        {run.step || t('me.agents.outcome.running')}
      </span>
    )
  }
  // A failed or stopped run says so; a finished one shows where the ticket stands now (review, done).
  const status = run.outcome === 'done' ? run.ticket?.status_info : null
  if (status) {
    return (
      <span className="chip-dyn inline-flex items-center gap-1 border text-2xs font-semibold px-1.5 py-0.5 rounded-md" style={{ '--c': status.color ?? '#6b7280' } as React.CSSProperties}>
        <span className="chip-dot w-1.5 h-1.5 rounded-full" />
        {status.name}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center border text-2xs font-semibold px-1.5 py-0.5 rounded-md ${run.outcome === 'failed' ? 'text-danger border-danger/40 bg-danger/10' : 'text-fg-2 border-line bg-raised'}`}>
      {t(OUTCOME_KEY[run.outcome])}
    </span>
  )
}

const PAGE = 25

export function AgentPanel({ agentId, onClearAgent, teamId, onClearTeam, embedded = false }: {
  agentId?: string | null
  onClearAgent?: () => void
  /** Opened from a team's menu: that team's runs and the agents that work in it. */
  teamId?: string | null
  onClearTeam?: () => void
  /** Inside a screen that already scrolls (Yönetim): no scroll container of its own. */
  embedded?: boolean
}) {
  const t = useT()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period | 'custom'>('30d')
  // The picked range (YYYY-MM-DD, both days included); only read while the period is "custom".
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [shown, setShown] = useState(PAGE)
  // Elapsed time and "connected" depend on the clock, not only on the data.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 20_000)
    return () => window.clearInterval(id)
  }, [])

  const { since, until } = useMemo(
    () => (period === 'custom' ? rangeBounds(range.from, range.to) : { since: periodStart(period), until: null }),
    [period, range.from, range.to],
  )
  const { data: agents = [] } = useAgents({ live: true })
  const { data: runs = [], isLoading, error } = useAgentRuns({ since, until, agentId, teamId })
  // A team's view shows the agents that are members of it (their run list is already the team's).
  const { data: teams = [] } = useMyTeams()
  const team = teamId ? teams.find((x) => x.id === teamId) ?? null : null
  const { data: members = [] } = useTeamMembers(teamId ?? null)
  const inTeam = teamId && members.length ? new Set(members.map((m) => m.user_id)) : null
  const visibleAgents = agents.filter((a) => (!agentId || a.id === agentId) && (!inTeam || inTeam.has(a.profile_id)))
  const presence = useAgentPresence(visibleAgents.map((a) => a.id))
  const only = agentId ? agents.find((a) => a.id === agentId) : null

  const summary = useMemo(() => summarizeRuns(runs), [runs])
  // What the work came to (115): approved the first time, came back, still in review. Counted on the server.
  const { data: firstPass = NO_FIRST_PASS } = useFirstPass({ since, until, agentId, teamId })
  const fpRate = firstPassRate(firstPass)
  // Passive jobs (110) are not runs: they get a line of their own and stay out of every total above.
  const { data: passiveRows = [] } = usePassiveJobs({ since, until, teamId, agentProfileId: only?.profile_id ?? null })
  const passive = useMemo(() => summarizePassive(passiveRows), [passiveRows])
  const days = useMemo(() => runsByDay(runs), [runs])
  const models = useMemo(() => modelSplit(runs), [runs])
  const modelTotal = models.reduce((n, m) => n + m.count, 0)
  const locale = localeOf()
  const open = (id: string) => openTicket(navigate, id)
  // The run whose detail is open — kept by id, so the open view follows the list as it refreshes.
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = detailId ? runs.find((r) => r.id === detailId) ?? null : null

  return (
    <div className={embedded ? '' : 'h-full overflow-y-auto overflow-x-hidden scrollbar-thin'} data-agent-panel>
      <div className="mx-auto max-w-6xl space-y-4 pb-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-fg">{t('me.agents.title')}</h1>
            <p className="text-sm text-fg-muted">{t('me.agents.subtitle')}</p>
            {only && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-xs text-fg-2">
                {t('me.agents.onlyAgent', { name: only.profile?.full_name ?? agentShortName(null) })}
                {onClearAgent && <button type="button" onClick={onClearAgent} className="rounded-md px-1 text-fg-muted hover:text-fg cursor-pointer" aria-label={t('me.agents.showAll')} title={t('me.agents.showAll')}>✕</button>}
              </p>
            )}
            {teamId && (
              <p data-agent-team className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-xs text-fg-2">
                {t('me.agents.onlyTeam', { name: team?.name ?? '…' })}
                {onClearTeam && <button type="button" onClick={onClearTeam} className="rounded-md px-1 text-fg-muted hover:text-fg cursor-pointer" aria-label={t('me.agents.showAllTeams')} title={t('me.agents.showAllTeams')}>✕</button>}
              </p>
            )}
          </div>
          <div className="flex max-w-full flex-col items-end gap-2">
          <div className="flex max-w-full flex-wrap gap-1 rounded-lg border border-line-soft bg-raised p-0.5" role="radiogroup" aria-label={t('me.agents.period.label')}>
            {([...PERIODS, 'custom'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={period === p}
                data-agent-period={p}
                onClick={() => { setPeriod(p); setShown(PAGE) }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${period === p ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg-2'}`}
              >
                {t(p === 'custom' ? 'me.agents.period.custom' : PERIOD_KEY[p])}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div data-agent-range className="flex max-w-full flex-wrap items-center justify-end gap-2 text-xs text-fg-muted">
              <DateInput value={range.from} onChange={(v) => { setRange((r) => ({ ...r, from: v })); setShown(PAGE) }} aria-label={t('me.agents.range.from')} className="rounded-lg border border-line bg-field px-2 py-1 text-xs text-fg" />
              <span aria-hidden="true">–</span>
              <DateInput value={range.to} onChange={(v) => { setRange((r) => ({ ...r, to: v })); setShown(PAGE) }} aria-label={t('me.agents.range.to')} className="rounded-lg border border-line bg-field px-2 py-1 text-xs text-fg" />
            </div>
          )}
          </div>
        </header>

        {error && <p className="text-sm text-danger">{t('me.agents.loadError')}</p>}

        <PeriodSummaryLine period={period} firstPass={firstPass} activeSeconds={summary.measured ? summary.activeSeconds : null} className="text-sm text-fg-2" />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile
            label={t('me.agents.stat.firstPass')}
            value={fpRate === null ? '—' : percent(fpRate)}
            sub={fpRate === null
              ? (firstPass.waiting > 0 ? t('me.agents.stat.firstPassWaiting', { n: firstPass.waiting }) : t('me.agents.stat.firstPassNone'))
              : `${t('me.agents.stat.firstPassSub', { first: firstPass.firstPass, decided: firstPass.firstPass + firstPass.returned })}${firstPass.waiting > 0 ? ` · ${t('me.agents.stat.firstPassWaiting', { n: firstPass.waiting })}` : ''}`}
          />
          <StatTile label={t('me.agents.stat.completed')} value={String(summary.completed)} sub={t('me.agents.stat.completedSub', { n: summary.workingDays })} />
          <StatTile
            label={t('me.agents.stat.active')}
            value={summary.measured ? duration(summary.activeSeconds, t) : '—'}
            sub={summary.medianActiveSeconds != null ? t('me.agents.stat.activeSub', { time: duration(summary.medianActiveSeconds, t), turns: summary.medianTurns ?? 0 }) : undefined}
          />
          <StatTile
            label={t('me.agents.stat.output')}
            value={summary.measured ? t('me.agents.tokens', { n: compactNumber(summary.outputTokens, locale) }) : '—'}
            sub={summary.medianOutputTokens != null ? t('me.agents.stat.outputSub', { n: compactNumber(summary.medianOutputTokens, locale) }) : undefined}
          />
          <StatTile
            label={t('me.agents.stat.cost')}
            value={summary.measured ? money(summary.costUsd) : '—'}
            sub={summary.medianCostUsd != null ? t('me.agents.stat.costSub', { median: money(summary.medianCostUsd) }) : t('me.agents.stat.costNote')}
          />
        </div>

        {visibleAgents.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleAgents.map((a) => <AgentCard key={a.id} agent={a} runs={runs} now={now} presence={presence[a.id] ?? 'unknown'} onOpenTicket={open} />)}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <DayBars title={t('me.agents.chart.tasks')} subtitle={t('me.agents.chart.tasksSub')} points={days} pick={(p) => p.tasks} label={(v) => t('me.agents.chart.tasksValue', { n: v })} />
          <DayBars title={t('me.agents.chart.minutes')} subtitle={t('me.agents.chart.minutesSub')} points={days} pick={(p) => p.activeMinutes} label={(v) => t('me.agents.dur.min', { n: v })} />
        </div>

        {models.length > 0 && (
          <section className="rounded-xl border border-line bg-surface p-4 shadow-sm" data-agent-models>
            <h3 className="text-sm font-semibold text-fg">{t('me.agents.models.title')}</h3>
            <p className="text-xs text-fg-muted">{t('me.agents.models.sub')}</p>
            <div className="mt-3 flex h-5 gap-0.5" role="img" aria-label={models.map((m) => `${m.model === OTHER_MODEL ? t('me.agents.models.other') : modelLabel(m.model)}: ${m.count}`).join(', ')}>
              {models.map((m) => (
                <span key={m.model} className={`h-full rounded-md ${slotClass(m.slot)}`} style={{ flexGrow: m.count, flexBasis: 0, minWidth: 4 }} title={`${m.model === OTHER_MODEL ? t('me.agents.models.other') : modelLabel(m.model)} · ${t('me.agents.chart.tasksValue', { n: m.count })}`} />
              ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
              {models.map((m) => (
                <li key={m.model} className="flex items-center gap-1.5 text-xs text-fg-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${slotClass(m.slot)}`} aria-hidden="true" />
                  {m.model === OTHER_MODEL ? t('me.agents.models.other') : modelLabel(m.model)}
                  <span className="text-fg-muted tabular-nums">· {t('me.agents.chart.tasksValue', { n: m.count })} · {percent(m.count / modelTotal)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-line bg-surface shadow-sm" data-agent-runs>
          {/* A phone cannot read nine columns: the same runs as a list, one tap to the detail. */}
          <ul className="divide-y divide-line-soft sm:hidden" data-agent-run-list>
            {runs.slice(0, shown).map((r) => {
              const title = r.ticket?.title ?? r.ticket_title ?? t('settings.agent.untitled')
              const facts = [
                r.model ? modelLabel(r.model) : null,
                isMeasured(r) ? duration(r.active_seconds ?? 0, t) : null,
                r.turns != null ? t('me.agents.turnsShort', { n: r.turns }) : null,
                r.cost_usd != null ? money(Number(r.cost_usd)) : null,
              ].filter(Boolean)
              return (
                <li key={r.id}>
                  <button type="button" data-agent-run-card={r.id} aria-label={t('me.agents.detail.open', { title })} onClick={() => setDetailId(r.id)} className="block w-full px-4 py-3 text-left hover:bg-raised/60 cursor-pointer">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{title}</span>
                      <span className="flex-shrink-0"><RunStatus run={r} now={now} t={t} /></span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-fg-muted">
                      {r.ticket_id ? `#${r.ticket_id.slice(0, 6).toUpperCase()}` : t('me.agents.ticketGone')}{r.ticket?.project?.name ? ` · ${r.ticket.project.name}` : ''} · {displayTime(r.started_at)}
                    </span>
                    <span className="mt-1 block text-xs text-fg-2 tabular-nums">{facts.length ? facts.join(' · ') : t('me.agents.unmeasuredRow')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  <th className="w-full px-4 py-2.5 font-semibold">{t('me.agents.col.task')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('me.agents.col.model')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('me.agents.col.active')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('me.agents.col.turns')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('me.agents.col.output')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('me.agents.col.cacheRead')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('me.agents.col.cost')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('me.agents.col.result')}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{t('me.agents.col.started')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, shown).map((r) => {
                  const measured = isMeasured(r)
                  const dash = <span className="text-fg-faint" title={r.source === 'queue' ? t('me.agents.unmeasuredRow') : undefined}>—</span>
                  const title = r.ticket?.title ?? r.ticket_title ?? t('settings.agent.untitled')
                  return (
                    <tr
                      key={r.id}
                      data-agent-run={r.id}
                      tabIndex={0}
                      aria-label={t('me.agents.detail.open', { title })}
                      onClick={() => setDetailId(r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setDetailId(r.id) }}
                      className="border-b border-line-soft last:border-b-0 hover:bg-raised/60 cursor-pointer outline-none focus-visible:bg-raised"
                    >
                      <td className="w-full max-w-0 px-4 py-2">
                        {r.ticket ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); open(r.ticket!.id) }} className="block max-w-full truncate rounded-md text-left font-medium text-fg hover:underline cursor-pointer">{title}</button>
                        ) : (
                          <span className="block truncate font-medium text-fg-2" title={t('me.agents.ticketGone')}>{title}</span>
                        )}
                        <span className="block truncate text-xs text-fg-muted">
                          {r.ticket_id ? `#${r.ticket_id.slice(0, 6).toUpperCase()}` : t('me.agents.ticketGone')}{r.ticket?.project?.name ? ` · ${r.ticket.project.name}` : ''}{r.version ? ` · v${r.version}` : ''}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-fg-2">{r.model ? modelLabel(r.model) : dash}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg-2">{measured ? duration(r.active_seconds ?? 0, t) : dash}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-2">{r.turns ?? dash}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg-2">{r.output_tokens != null ? compactNumber(r.output_tokens, locale) : dash}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg-2">{r.cache_read_tokens != null ? compactNumber(r.cache_read_tokens, locale) : dash}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg-2">{r.cost_usd != null ? money(Number(r.cost_usd)) : dash}</td>
                      <td className="whitespace-nowrap px-3 py-2"><RunStatus run={r} now={now} t={t} /></td>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-fg-muted" title={exactTime(r.started_at)}>
                        {displayTime(r.started_at)}
                        <Icon name="chevronRight" className="ml-1.5 inline-block text-fg-faint" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!isLoading && runs.length === 0 && <p className="px-4 py-10 text-center text-sm text-fg-muted">{t('me.agents.empty')}</p>}
          {isLoading && <p className="px-4 py-10 text-center text-sm text-fg-muted">{t('common.loading')}</p>}
          {runs.length > shown && (
            <div className="border-t border-line-soft px-4 py-2.5 text-center">
              <button type="button" data-agent-more onClick={() => setShown((n) => n + PAGE * 2)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 hover:bg-raised cursor-pointer">
                {t('me.agents.more', { n: runs.length - shown })}
              </button>
            </div>
          )}
        </section>

        {detail && (
          <RunDetail
            run={detail}
            status={<RunStatus run={detail} now={now} t={t} />}
            onClose={() => setDetailId(null)}
            onOpenTicket={(id) => { setDetailId(null); open(id) }}
            onOpenPage={(id) => { setDetailId(null); go(navigate, `/page/${id}`) }}
          />
        )}

        <footer className="space-y-1 text-xs text-fg-muted">
          {summary.unmeasured > 0 && <p>{t('me.agents.note.unmeasured', { n: summary.unmeasured })}</p>}
          <p>{t('me.agents.note.cost')}</p>
          {passive.count > 0 && (
            <p data-agent-passive>
              {passive.translations === 0 ? t('me.agents.note.passive', { n: passive.pictures })
                : passive.pictures === 0 ? t('me.agents.note.passiveTexts', { m: passive.translations })
                : t('me.agents.note.passiveBoth', { n: passive.pictures, m: passive.translations })}
              {passive.measured > 0 && <> · {duration(passive.seconds, t)} · {t('me.agents.note.passiveCost', { cost: money(passive.costUsd) })}</>}
            </p>
          )}
          {runs.length >= RUNS_CAP && <p>{t('me.agents.note.cap', { n: RUNS_CAP })}</p>}
        </footer>
      </div>
    </div>
  )
}
