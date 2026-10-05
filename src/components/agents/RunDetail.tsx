import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { markHandled } from '../../lib/keys'
import { compactNumber, durationParts, isMeasured, modelLabel, runRuleViews, runTimeline, toolUsage, type TimelineItem } from '../../lib/agentStats'
import { exactTime } from '../../lib/time'
import { localeOf, useT, type TranslationKey } from '../../i18n'
import type { AiRun } from '../../types'

/**
 * One run, in full (106, #c94673c2): the path the work took (asked for →
 * claimed → the steps the agent named → closed, each with its moment and how
 * long it lasted), which tools were called how often, and where the session is.
 *
 * Opened from a row of the agent panel. Everything the list already has comes
 * in with `run`; the rest (steps, tool use, who asked) is read when it opens.
 * What was never measured is said to be unmeasured — history from before the
 * steps existed has a start and an end and nothing in between.
 */

type Translate = ReturnType<typeof useT>

interface RunExtra {
  tools: Record<string, unknown> | null
  tool_calls: number | null
  input_tokens: number | null
  cache_write_tokens: number | null
  session_id: string | null
  request: { source: string | null; requester: { full_name: string | null } | null } | null
  agent: { profile: { full_name: string | null } | null } | null
  steps: { step: string; at: string }[]
  /** The rule pages read when the job was taken (108); null = not recorded. */
  rules: unknown
  rules_personal: boolean | null
  /** Those pages as they are now (only the ones this reader may see). */
  rulePages: { id: string; updated_at: string; archived_at: string | null }[]
}

function useRunDetail(runId: string) {
  return useQuery({
    queryKey: ['ai_runs', 'detail', runId],
    queryFn: async (): Promise<RunExtra | null> => {
      const { data, error } = await supabase
        .from('ai_runs')
        .select(
          'tools, tool_calls, input_tokens, cache_write_tokens, session_id, rules, rules_personal, ' +
          'request:ai_work_requests!ai_runs_request_id_fkey(source, requester:profiles!ai_work_requests_requested_by_fkey(full_name)), ' +
          'agent:agents!ai_runs_agent_id_fkey(profile:profiles!agents_profile_id_fkey(full_name)), ' +
          'steps:ai_run_steps(step, at)',
        )
        .eq('id', runId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const extra = data as unknown as RunExtra
      // What became of the rule pages since: one small read, only when there are any.
      const ids = Array.isArray(extra.rules) ? (extra.rules as { page_id?: string }[]).map((r) => r?.page_id).filter((x): x is string => typeof x === 'string') : []
      extra.rulePages = []
      if (ids.length) {
        const { data: pages } = await supabase.from('pages').select('id, updated_at, archived_at').in('id', ids)
        extra.rulePages = (pages ?? []) as RunExtra['rulePages']
      }
      return extra
    },
    // A run in progress grows a step at a time.
    refetchInterval: 30_000,
  })
}

function duration(seconds: number, t: Translate): string {
  const d = durationParts(seconds)
  if (d.unit === 'sec') return t('me.agents.dur.sec', { n: d.s })
  if (d.unit === 'min') return t('me.agents.dur.min', { n: d.m })
  return d.m ? t('me.agents.dur.hourMin', { h: d.h, m: d.m }) : t('me.agents.dur.hour', { h: d.h })
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const money = (usd: number) => new Intl.NumberFormat(localeOf(), { style: 'currency', currency: 'USD' }).format(usd)

const KIND_KEY: Record<Exclude<TimelineItem['kind'], 'step'>, TranslationKey> = {
  requested: 'me.agents.detail.requested', claimed: 'me.agents.detail.claimed', finished: 'me.agents.detail.finished',
}
const SOURCE_KEY: Record<AiRun['source'], TranslationKey> = {
  runner: 'me.agents.detail.sourceRunner', transcript: 'me.agents.detail.sourceTranscript', queue: 'me.agents.detail.sourceQueue',
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
    </div>
  )
}

/** The session's id, and for a session without a link the command that reopens it where it ran. */
function SessionId({ id, local }: { id: string; local: boolean }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const command = `claude --resume ${id}`
  const copy = () => { void navigator.clipboard.writeText(local ? command : id).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }) }
  return (
    <div className="mt-1" data-run-session-id>
      {local && <p>{t('me.agents.detail.sessionLocal')}</p>}
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 truncate rounded-md bg-raised px-1.5 py-0.5 text-xs text-fg-2">{local ? command : id}</code>
        <button type="button" onClick={copy} className="flex-shrink-0 rounded-md border border-line px-1.5 py-0.5 text-xs text-fg-2 hover:bg-raised">
          {t(copied ? 'common.copied' : 'common.copy')}
        </button>
      </div>
    </div>
  )
}

export function RunDetail({ run, status, onClose, onOpenTicket, onOpenPage }: {
  run: AiRun
  /** The run's result chip, drawn by the list so the two always agree. */
  status: React.ReactNode
  onClose: () => void
  onOpenTicket: (id: string) => void
  onOpenPage: (id: string) => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { markHandled(e); onClose() } }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  const { data: extra, isLoading } = useRunDetail(run.id)
  const locale = localeOf()
  const measured = isMeasured(run)
  // A job that is still going has no numbers yet — that is not "never measured".
  const running = run.outcome === 'running'
  const title = run.ticket?.title ?? run.ticket_title ?? t('settings.agent.untitled')
  const timeline = runTimeline(run, extra?.steps ?? [])
  const tools = toolUsage(extra?.tools)
  const rules = extra ? runRuleViews(extra.rules, extra.rulePages) : undefined
  const maxCalls = Math.max(1, ...tools.map((x) => x.calls))
  const wall = run.finished_at ? (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000 : null
  const meta = [
    run.ticket_id ? `#${run.ticket_id.slice(0, 6).toUpperCase()}` : null,
    run.ticket?.project?.name ?? null,
    extra?.request?.requester?.full_name ? t('me.agents.detail.askedBy', { name: extra.request.requester.full_name }) : null,
    extra?.agent?.profile?.full_name ?? null,
  ].filter(Boolean)

  // In the body, not in the panel: the panel stacks its sections with `space-y`,
  // and that margin pushed the fixed backdrop 16 px down, leaving a bright strip
  // across the top of the window (#c94673c2).
  return createPortal(
    <div data-run-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('me.agents.detail.title')} data-run-detail className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-line bg-app shadow-2xl outline-none animate-fade-in">
        <header className="flex items-start gap-3 border-b border-line-soft bg-surface px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg-muted">{t('me.agents.detail.title')}</p>
            {run.ticket ? (
              <button type="button" onClick={() => onOpenTicket(run.ticket!.id)} className="block max-w-full truncate rounded-md text-left text-lg font-semibold text-fg hover:underline cursor-pointer">{title}</button>
            ) : (
              <p className="truncate text-lg font-semibold text-fg-2" title={t('me.agents.ticketGone')}>{title}</p>
            )}
            <p className="truncate text-xs text-fg-muted">
              {meta.join(' · ')}{meta.length ? ' · ' : ''}<span title={exactTime(run.started_at)}>{new Date(run.started_at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </p>
          </div>
          <span className="mt-1 flex-shrink-0">{status}</span>
          <button type="button" onClick={onClose} className="tap flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-raised hover:text-fg cursor-pointer" aria-label={t('common.close')}>
            <Icon name="close" />
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto scrollbar-thin p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={t('me.agents.detail.time')}
              value={measured ? duration(run.active_seconds ?? 0, t) : '—'}
              sub={measured ? (wall != null ? t('me.agents.detail.timeSub', { wall: duration(wall, t) }) : t('me.agents.outcome.running')) : running ? t('me.agents.detail.pending') : t('me.agents.unmeasuredRow')}
            />
            <Tile
              label={t('me.agents.col.model')}
              value={run.model ? modelLabel(run.model) : '—'}
              sub={run.turns != null ? t('me.agents.detail.modelSub', { turns: run.turns, calls: extra?.tool_calls ?? '—' }) : undefined}
            />
            <Tile
              label={t('me.agents.col.output')}
              value={run.output_tokens != null ? t('me.agents.tokens', { n: compactNumber(run.output_tokens, locale) }) : '—'}
              sub={run.cache_read_tokens != null ? t('me.agents.detail.outputSub', { n: compactNumber(run.cache_read_tokens, locale) }) : undefined}
            />
            <Tile label={t('me.agents.col.cost')} value={run.cost_usd != null ? money(Number(run.cost_usd)) : '—'} sub={t('me.agents.detail.costSub')} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <section className="rounded-xl border border-line bg-surface p-4" data-run-timeline>
              <h3 className="text-sm font-semibold text-fg">{t('me.agents.detail.timeline')}</h3>
              <p className="text-xs text-fg-muted">{t('me.agents.detail.timelineSub')}</p>
              <ol className="mt-3">
                {timeline.map((item, i) => (
                  <li key={`${item.kind}-${item.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < timeline.length - 1 && <span className="absolute left-[5px] top-3.5 h-full w-px bg-line" aria-hidden="true" />}
                    <span className={`relative mt-1 h-[11px] w-[11px] flex-shrink-0 rounded-full ${item.kind === 'step' ? 'bg-primary-500 dark:bg-primary-400' : 'border-2 border-primary-500 bg-surface dark:border-primary-400'}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">{item.kind === 'step' ? item.label : t(KIND_KEY[item.kind])}</p>
                      <p className="text-xs text-fg-muted tabular-nums">
                        <span title={exactTime(item.at)}>{clock(item.at)}</span>
                        {item.kind !== 'requested' && item.kind !== 'claimed' && <> · {t('me.agents.detail.atMinute', { time: duration(item.sinceStart, t) })}</>}
                        {item.duration != null && <> · {t(item.kind === 'requested' ? 'me.agents.detail.waited' : 'me.agents.detail.took', { time: duration(item.duration, t) })}</>}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {!isLoading && (extra?.steps?.length ?? 0) === 0 && <p className="mt-3 text-xs text-fg-muted">{t('me.agents.detail.noSteps')}</p>}
            </section>

            <section className="rounded-xl border border-line bg-surface p-4" data-run-tools>
              <h3 className="text-sm font-semibold text-fg">{t('me.agents.detail.tools')}</h3>
              <p className="text-xs text-fg-muted">{t('me.agents.detail.toolsSub')}</p>
              {tools.length ? (
                <ul className="mt-3 space-y-2">
                  {tools.map((x) => (
                    <li key={x.name} className="flex items-center gap-2.5 text-sm">
                      <span className="w-24 flex-shrink-0 truncate text-fg-2" title={x.name}>{x.name}</span>
                      <span className="h-2 min-w-0 flex-1 rounded-full bg-raised">
                        <span className="block h-full rounded-full bg-primary-500 dark:bg-primary-400" style={{ width: `max(4px, ${(x.calls / maxCalls) * 100}%)` }} />
                      </span>
                      <span className="w-8 flex-shrink-0 text-right font-medium text-fg tabular-nums">{x.calls}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-fg-muted">{isLoading ? t('common.loading') : t(running ? 'me.agents.detail.toolsPending' : 'me.agents.detail.noTools')}</p>
              )}
            </section>

            <section className="rounded-xl border border-line bg-surface p-4" data-run-session>
              <h3 className="text-sm font-semibold text-fg">{t('me.agents.detail.session')}</h3>
              <p className="text-xs text-fg-muted">{t('me.agents.detail.sessionSub')}</p>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="font-medium text-fg">{t('me.agents.detail.sessionLink')}</dt>
                  <dd className="text-xs text-fg-muted">
                    {run.session_url
                      ? <a href={run.session_url} target="_blank" rel="noopener noreferrer" className="text-primary-700 underline dark:text-primary-300">{t('me.agents.detail.sessionOpen')}</a>
                      : extra?.session_id ? null : t(running ? 'me.agents.detail.sessionPending' : 'me.agents.detail.sessionNone')}
                    {/* A runner's session lives on the runner's computer (#c0338c07): no link, but its id, and
                        the command that continues it there. Other sessions show the id beside their link. */}
                    {extra?.session_id && <SessionId id={extra.session_id} local={!run.session_url && run.source === 'runner'} />}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-fg">{t('me.agents.detail.result')}</dt>
                  <dd className="text-xs text-fg-muted">
                    {running ? t('me.agents.detail.resultRunning') : run.version ? t('me.agents.detail.resultVersion', { version: run.version }) : t('me.agents.detail.resultNoVersion')}
                    {run.ticket?.status_info?.name ? ` · ${run.ticket.status_info.name}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-fg">{t('me.agents.detail.source')}</dt>
                  <dd className="text-xs text-fg-muted">{t(running && !measured ? 'me.agents.detail.sourceRunning' : SOURCE_KEY[run.source])}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="rounded-xl border border-line bg-surface p-4" data-run-rules>
            <h3 className="text-sm font-semibold text-fg">{t('me.agents.detail.rules')}</h3>
            <p className="text-xs text-fg-muted">{t('me.agents.detail.rulesSub')}</p>
            {rules === undefined ? (
              <p className="mt-3 text-xs text-fg-muted">{t('common.loading')}</p>
            ) : rules === null ? (
              <p className="mt-3 text-xs text-fg-muted">{t('me.agents.detail.rulesUnrecorded')}</p>
            ) : (
              <>
                {rules.length === 0 && <p className="mt-3 text-xs text-fg-muted">{t('me.agents.detail.rulesNone')}</p>}
                {rules.length > 0 && (
                  <ul className="mt-3 divide-y divide-line-soft">
                    {rules.map((r) => (
                      <li key={r.page_id + r.scope} data-run-rule={r.state} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                        <span className="w-12 flex-shrink-0 text-xs text-fg-muted">{t(r.scope === 'list' ? 'me.agents.detail.ruleList' : 'me.agents.detail.ruleTeam')}</span>
                        <span className="min-w-0 flex-1">
                          {r.state === 'gone' ? (
                            <span className="block truncate text-sm text-fg-2">{r.title || t('page.untitled')}</span>
                          ) : (
                            <button type="button" onClick={() => onOpenPage(r.page_id)} className="block max-w-full truncate rounded-md text-left text-sm font-medium text-fg hover:underline cursor-pointer">{r.title || t('page.untitled')}</button>
                          )}
                          {r.updated_at && <span className="block text-xs text-fg-muted">{t('me.agents.detail.ruleRead', { time: exactTime(r.updated_at) })}</span>}
                        </span>
                        {r.required && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-md bg-primary-500/10 text-primary-700 dark:text-primary-300">{t('me.agents.detail.ruleRequired')}</span>}
                        {r.state === 'changed' && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-md border border-warning/40 bg-warning/10 text-warning">{t('me.agents.detail.ruleChanged')}</span>}
                        {r.state === 'gone' && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-md border border-line bg-raised text-fg-muted">{t('me.agents.detail.ruleGone')}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {extra?.rules_personal && <p className="mt-3 text-xs text-fg-muted">{t('me.agents.detail.rulesPersonal')}</p>}
              </>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
