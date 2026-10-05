/**
 * The arithmetic of the agent panel (103, #30adc936): totals, medians, the two
 * daily series and the model split, from the run records the panel loaded.
 * Pure, so the numbers on the screen can be tested against known runs.
 *
 * What is counted, deliberately: results and time. There is no ranking of
 * people and no "most tokens" anywhere (report §4: a token leaderboard gets
 * gamed) — tokens appear as what a task cost, next to the task.
 */

export type RunOutcome = 'running' | 'done' | 'failed' | 'cancelled'
export type RunSource = 'runner' | 'transcript' | 'queue'

/** The columns of ai_runs the panel needs. */
export interface RunLike {
  outcome: RunOutcome
  source: RunSource
  started_at: string
  finished_at: string | null
  active_seconds: number | null
  turns: number | null
  model: string | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cost_usd: number | null
}

/**
 * A run that is "running" but has not been heard from for five minutes: the
 * listener that was on it is gone (it sends a heartbeat a minute while a job
 * is open). The work is not lost — it is taken up again when the agent
 * reconnects — but nobody is on it now, and the screens say so instead of
 * "working" (#a47fbec8).
 */
export const STALL_MS = 5 * 60_000
export function runStalled(run: { outcome: RunOutcome; heartbeat_at?: string | null; started_at: string }, now: number = Date.now()): boolean {
  if (run.outcome !== 'running') return false
  const last = new Date(run.heartbeat_at ?? run.started_at).getTime()
  return Number.isFinite(last) && now - last > STALL_MS
}

/** One rule page a run read when it was taken (108). */
export interface RunRule { page_id: string; title: string; scope: 'team' | 'list'; required: boolean; updated_at: string | null }
export interface RunRuleView extends RunRule {
  /** same = the page is as the agent read it · changed = edited since · gone = deleted or in the trash · unknown = not looked up yet */
  state: 'same' | 'changed' | 'gone' | 'unknown'
}

/**
 * The rules a run recorded, each with what became of its page since. `recorded`
 * is the run's `rules` column: null means nothing was recorded (a run from
 * before the record existed) and is answered with null — not with "no rules".
 */
export function runRuleViews(recorded: unknown, pages: { id: string; updated_at: string; archived_at: string | null }[] | undefined): RunRuleView[] | null {
  if (!Array.isArray(recorded)) return null
  const byId = new Map((pages ?? []).map((p) => [p.id, p]))
  return (recorded as RunRule[]).filter((r) => r && typeof r.page_id === 'string').map((r) => {
    const now = byId.get(r.page_id)
    const state: RunRuleView['state'] = !pages ? 'unknown'
      : !now || now.archived_at ? 'gone'
      : r.updated_at && new Date(now.updated_at).getTime() > new Date(r.updated_at).getTime() ? 'changed' : 'same'
    return { page_id: r.page_id, title: r.title ?? '', scope: r.scope === 'list' ? 'list' : 'team', required: !!r.required, updated_at: r.updated_at ?? null, state }
  })
}

/**
 * A picked date range (local days, both ends included) as query bounds: from
 * the first day's midnight up to the midnight after the last day. An open end
 * stays open; two dates given the wrong way round are read in order.
 */
export function rangeBounds(from: string | null, to: string | null): { since: Date | null; until: Date | null } {
  const day = (s: string | null): Date | null => {
    const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const a = day(from), b = day(to)
  const [lo, hi] = a && b && a.getTime() > b.getTime() ? [b, a] : [a, b]
  return { since: lo, until: hi ? new Date(hi.getFullYear(), hi.getMonth(), hi.getDate() + 1) : null }
}

/**
 * The path of one run, for its detail view (106): asked for → claimed → the
 * steps the agent named → closed. Each item knows how far into the work it
 * happened and how long it lasted (until the next one). Pure, so the timeline
 * on the screen can be tested.
 */
export interface TimelineItem {
  kind: 'requested' | 'claimed' | 'step' | 'finished'
  /** The agent's own words for a step; the screen names the other kinds. */
  label?: string
  at: string
  /** Seconds since the work was claimed (negative for "asked for"). */
  sinceStart: number
  /** Seconds until the next item; null for the last one. */
  duration: number | null
}
export function runTimeline(
  run: { requested_at?: string | null; started_at: string; finished_at: string | null },
  steps: { step: string; at: string }[],
): TimelineItem[] {
  const start = new Date(run.started_at).getTime()
  const raw: { kind: TimelineItem['kind']; label?: string; at: string }[] = []
  // "Asked for" only when it is a moment of its own: history rows carry the same time for both.
  if (run.requested_at && Math.abs(new Date(run.requested_at).getTime() - start) >= 1000 && new Date(run.requested_at).getTime() < start) {
    raw.push({ kind: 'requested', at: run.requested_at })
  }
  raw.push({ kind: 'claimed', at: run.started_at })
  const end = run.finished_at ? new Date(run.finished_at).getTime() : Infinity
  for (const st of [...steps].sort((a, b) => a.at.localeCompare(b.at))) {
    const t = new Date(st.at).getTime()
    if (t < start || t > end) continue   // a step outside the run belongs to another attempt
    raw.push({ kind: 'step', label: st.step, at: st.at })
  }
  if (run.finished_at) raw.push({ kind: 'finished', at: run.finished_at })
  return raw.map((item, i) => {
    const t = new Date(item.at).getTime()
    const next = raw[i + 1]
    return { ...item, sinceStart: Math.round((t - start) / 1000), duration: next ? Math.max(0, Math.round((new Date(next.at).getTime() - t) / 1000)) : null }
  })
}

/** Tool name → calls, most used first; ties by name so the order does not jump between renders. */
export function toolUsage(tools: Record<string, unknown> | null | undefined): { name: string; calls: number }[] {
  return Object.entries(tools ?? {})
    .map(([name, v]) => ({ name, calls: Number(v) }))
    .filter((x) => Number.isFinite(x.calls) && x.calls > 0)
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

export type Period = 'today' | '7d' | '30d' | 'all'
export const PERIODS: Period[] = ['today', '7d', '30d', 'all']

/** Where a period starts (local midnight), or null for everything. */
export function periodStart(period: Period, now: Date = new Date()): Date | null {
  if (period === 'all') return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === '7d') start.setDate(start.getDate() - 6)
  if (period === '30d') start.setDate(start.getDate() - 29)
  return start
}

/** A run whose time was really measured. History from the queue alone knows only when it was asked for and closed. */
export const isMeasured = (r: Pick<RunLike, 'source' | 'active_seconds'>) => r.source !== 'queue' && r.active_seconds != null

const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export interface RunSummary {
  /** Finished with the work done. */
  completed: number
  failed: number
  cancelled: number
  running: number
  /** Days on which at least one run started. */
  workingDays: number
  /** Runs with a measured duration, and how many closed runs have none. */
  measured: number
  unmeasured: number
  activeSeconds: number
  medianActiveSeconds: number | null
  medianTurns: number | null
  outputTokens: number
  medianOutputTokens: number | null
  costUsd: number
  medianCostUsd: number | null
}

export function summarizeRuns(runs: RunLike[]): RunSummary {
  const closed = runs.filter((r) => r.outcome !== 'running')
  const measured = closed.filter(isMeasured)
  const num = (xs: (number | null)[]) => xs.filter((x): x is number => x != null)
  return {
    completed: runs.filter((r) => r.outcome === 'done').length,
    failed: runs.filter((r) => r.outcome === 'failed').length,
    cancelled: runs.filter((r) => r.outcome === 'cancelled').length,
    running: runs.filter((r) => r.outcome === 'running').length,
    workingDays: new Set(runs.map((r) => dayKey(new Date(r.started_at)))).size,
    measured: measured.length,
    unmeasured: closed.length - measured.length,
    activeSeconds: measured.reduce((n, r) => n + (r.active_seconds ?? 0), 0),
    medianActiveSeconds: median(num(measured.map((r) => r.active_seconds))),
    medianTurns: median(num(measured.map((r) => r.turns))),
    outputTokens: measured.reduce((n, r) => n + (r.output_tokens ?? 0), 0),
    medianOutputTokens: median(num(measured.map((r) => r.output_tokens))),
    costUsd: Math.round(measured.reduce((n, r) => n + (r.cost_usd ?? 0), 0) * 100) / 100,
    medianCostUsd: median(num(measured.map((r) => r.cost_usd))),
  }
}

export interface DayPoint { day: string; tasks: number; activeMinutes: number }

/**
 * One point per calendar day from the first run to the last (days without work
 * are zero, not missing — a gap in the bars is information). `tasks` counts
 * finished work by the day it started; minutes come from measured runs only.
 */
export function runsByDay(runs: RunLike[]): DayPoint[] {
  const closed = runs.filter((r) => r.outcome !== 'running')
  if (!closed.length) return []
  const byDay = new Map<string, DayPoint>()
  let first = new Date(closed[0].started_at), last = first
  for (const r of closed) {
    const d = new Date(r.started_at)
    if (d < first) first = d
    if (d > last) last = d
    const key = dayKey(d)
    const p = byDay.get(key) ?? { day: key, tasks: 0, activeMinutes: 0 }
    if (r.outcome === 'done') p.tasks += 1
    if (isMeasured(r)) p.activeMinutes += (r.active_seconds ?? 0) / 60
    byDay.set(key, p)
  }
  const out: DayPoint[] = []
  for (const d = new Date(first.getFullYear(), first.getMonth(), first.getDate()); d <= last; d.setDate(d.getDate() + 1)) {
    const p = byDay.get(dayKey(d)) ?? { day: dayKey(d), tasks: 0, activeMinutes: 0 }
    out.push({ ...p, activeMinutes: Math.round(p.activeMinutes) })
  }
  return out
}

/**
 * Models in a FIXED order: a model keeps its colour whatever the period or the
 * filter shows (colour follows the entity, never its rank). A model that is
 * not on the list is counted under "other".
 */
export const MODEL_ORDER = ['claude-opus-5', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5']
export const OTHER_MODEL = 'other'

/** "claude-opus-5-5" → "Opus 5.5"; "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return '—'
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?$/.exec(id)
  if (!m) return id
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

export interface ModelShare { model: string; slot: number; count: number }

/** How many closed, measured runs each model did most of the output for, in the fixed order. `slot` is the colour slot. */
export function modelSplit(runs: RunLike[]): ModelShare[] {
  const counts = new Map<string, number>()
  for (const r of runs) {
    if (r.outcome === 'running' || !r.model) continue
    const key = MODEL_ORDER.includes(r.model) ? r.model : OTHER_MODEL
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const out: ModelShare[] = []
  MODEL_ORDER.forEach((model, i) => { const count = counts.get(model); if (count) out.push({ model, slot: i, count }) })
  const other = counts.get(OTHER_MODEL)
  if (other) out.push({ model: OTHER_MODEL, slot: -1, count: other })
  return out
}

/** Whole seconds, minutes, or hours and minutes — the three shapes a work duration is read in. */
export function durationParts(seconds: number): { unit: 'sec' | 'min' | 'hourMin'; h: number; m: number; s: number } {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return { unit: 'sec', h: 0, m: 0, s }
  const totalMin = Math.round(s / 60)
  if (totalMin < 60) return { unit: 'min', h: 0, m: totalMin, s: 0 }
  return { unit: 'hourMin', h: Math.floor(totalMin / 60), m: totalMin % 60, s: 0 }
}

/**
 * 737 → "737", 13 400 → "13 bin", 2 700 000 → "2,7 Mn" in Turkish; the
 * language's own short form elsewhere. Token counts are read as magnitudes,
 * never to the last digit.
 */
export function compactNumber(n: number, locale: string): string {
  if (n < 1000) return String(Math.round(n))
  if (locale.startsWith('tr')) {
    if (n < 1_000_000) return `${Math.round(n / 1000)} bin`
    return `${(n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mn`
  }
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** One finished passive job (110/112): what the call took, when the runner said so. */
export interface PassiveRow { ms: number | null; cost_usd: number | string | null; kind?: 'image_text' | 'translate'; translated?: boolean }
/**
 * Passive jobs of a period as one line for the panel. They are not runs and never enter the
 * agents' totals; a job whose runner did not report its time counts as a job, not as time.
 */
export function summarizePassive(rows: PassiveRow[]): { count: number; pictures: number; translations: number; seconds: number; costUsd: number; measured: number } {
  let ms = 0, cost = 0, measured = 0, pictures = 0, translations = 0
  for (const r of rows) {
    // A translation call that ended in "no translation needed" took time and is in the sums, but it is not a translation.
    if (r.kind === 'translate') { if (r.translated) translations++ } else pictures++
    if (typeof r.ms === 'number' && Number.isFinite(r.ms)) { ms += r.ms; measured++ }
    const c = Number(r.cost_usd)
    if (r.cost_usd != null && Number.isFinite(c)) cost += c
  }
  return { count: rows.length, pictures, translations, seconds: Math.round(ms / 1000), costUsd: Math.round(cost * 100) / 100, measured }
}

/**
 * First-pass approval (115) as the server counts it for a period: of the tasks an agent delivered,
 * how many were closed without coming back (`firstPass`), how many came back (`returned`), how
 * many still wait in review, and those that cannot be told (cancelled, or not visible to the reader).
 */
export interface FirstPass { delivered: number; firstPass: number; returned: number; waiting: number; other: number }
export const NO_FIRST_PASS: FirstPass = { delivered: 0, firstPass: 0, returned: 0, waiting: 0, other: 0 }

/** The server's answer, made safe (a missing or odd number is zero). */
export function readFirstPass(raw: unknown): FirstPass {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
  return { delivered: n(r.delivered), firstPass: n(r.first_pass), returned: n(r.returned), waiting: n(r.waiting), other: n(r.other) }
}

/**
 * Approved the first time, out of what has been decided: first / (first + returned).
 * What still waits in review is not held against the agent, and not counted for it either.
 * null while nothing has been decided: "no rate yet" is not 0 %.
 */
export function firstPassRate(fp: FirstPass): number | null {
  const decided = fp.firstPass + fp.returned
  return decided > 0 ? fp.firstPass / decided : null
}
