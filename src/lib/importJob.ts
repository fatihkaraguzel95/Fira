/**
 * The running import, owned by the app rather than by the settings window
 * (#684A9085, genişletme #8DA9D47F). Closing the window, pressing Esc or
 * clicking outside no longer ends it: the job lives here, the dock
 * (ImportDock) shows its progress and log anywhere in the app, and stopping is
 * an explicit action.
 *
 * Two kinds of job share all of this:
 *  - `onenote`: notebook → pages; reports sections/pages/bytes and locks the
 *    team's tree while it writes (useImportLock).
 *  - `sheet`: Excel/CSV/Planner → tasks; reports a single ratio and the line
 *    it is on. Nothing is locked — it only creates tasks in one list.
 *
 * One job at a time. Reloading or closing the tab still ends it — the browser
 * asks first while it runs.
 */
import { useSyncExternalStore } from 'react'
import { queryClient } from './queryClient'
// Types only: the importers (turndown, parser, converter, xlsx) load when an
// import starts, not with the app.
import type { ImportLogLine, ImportReport, Progress, ScannedSection } from './onenote/import'
import type { CsvPlan } from './backup/import'

export type ImportKind = 'onenote' | 'sheet'

/** What a finished sheet import produced. */
export interface SheetResult {
  created: number
  people: number
  errors: string[]
}

export interface ImportJob {
  kind: ImportKind
  teamId: string
  teamName: string
  /** Notebook name (OneNote) or file / plan name (sheet). */
  source: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  stopRequested: boolean
  /** OneNote: phase, sections, pages, bytes. */
  progress: Progress | null
  /** Sheet: one ratio plus the line being written. */
  simple: { ratio: number; label: string } | null
  /** Newest last; the oldest lines drop off past LOG_MAX. */
  log: ImportLogLine[]
  /** Lines that dropped off the front. */
  logDropped: number
  report: ImportReport | null
  sheet: SheetResult | null
  error: string | null
  startedAt: number
  endedAt: number | null
}

const LOG_MAX = 400
let job: ImportJob | null = null
const listeners = new Set<() => void>()

// Progress arrives many times a second; the UI repaints at most ~8 times a second.
let pending = false
const emit = (now = false) => {
  if (now) { pending = false; listeners.forEach((l) => l()); return }
  if (pending) return
  pending = true
  setTimeout(() => { pending = false; listeners.forEach((l) => l()) }, 120)
}
const update = (patch: Partial<ImportJob>, now = false) => { if (job) { job = { ...job, ...patch }; emit(now) } }

const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }

/** Append one line, dropping the oldest once the log is full. */
const addLog = (line: ImportLogLine) => {
  if (!job) return
  const log = [...job.log, line]
  const over = Math.max(0, log.length - LOG_MAX)
  update({ log: over ? log.slice(over) : log, logDropped: job.logDropped + over })
}

export function subscribeImportJob(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
export const getImportJob = () => job

export function useImportJob(): ImportJob | null {
  return useSyncExternalStore(subscribeImportJob, getImportJob, getImportJob)
}

/**
 * True while a OneNote import writes into this team: its pages and folders are
 * not editable meanwhile. A sheet import does not lock anything — it creates
 * tasks in one list and touches no page.
 */
export function useImportLock(teamId: string | null | undefined): boolean {
  const j = useImportJob()
  return !!teamId && j?.kind === 'onenote' && j.status === 'running' && j.teamId === teamId
}

const base = (kind: ImportKind, teamId: string, teamName: string, source: string): ImportJob => ({
  kind, teamId, teamName, source, status: 'running', stopRequested: false, progress: null, simple: null,
  log: [], logDropped: 0, report: null, sheet: null, error: null, startedAt: Date.now(), endedAt: null,
})

export function startImportJob(opts: { teamId: string; teamName: string; notebook: string; sections: ScannedSection[] }): boolean {
  if (job?.status === 'running') return false
  job = base('onenote', opts.teamId, opts.teamName, opts.notebook)
  emit(true)
  window.addEventListener('beforeunload', onBeforeUnload)
  void (async () => {
    try {
      const { runOneNoteImport } = await import('./onenote/import')
      const r = await runOneNoteImport({
        teamId: opts.teamId,
        sections: opts.sections,
        onProgress: (p) => update({ progress: p }),
        onLog: addLog,
        shouldStop: () => !!job?.stopRequested,
      })
      update({ status: r.stopped ? 'stopped' : 'done', report: r, endedAt: Date.now(), progress: null }, true)
    } catch (e) {
      update({ status: 'failed', error: (e as Error)?.message ?? String(e), endedAt: Date.now(), progress: null }, true)
    } finally {
      window.removeEventListener('beforeunload', onBeforeUnload)
      queryClient.invalidateQueries({ queryKey: ['pages'] })
      queryClient.invalidateQueries({ queryKey: ['folders', opts.teamId] })
    }
  })()
  return true
}

/**
 * Excel / CSV / Planner → tasks, as a background job (#8DA9D47F). The plan is
 * already built and reviewed in the Backup tab; this only runs it.
 */
export function startSheetImportJob(opts: {
  teamId: string
  teamName: string
  source: string
  projectId: string
  plan: CsvPlan
  sourceLabel: string | null
}): boolean {
  if (job?.status === 'running') return false
  job = base('sheet', opts.teamId, opts.teamName, opts.source)
  emit(true)
  window.addEventListener('beforeunload', onBeforeUnload)
  void (async () => {
    const t0 = Date.now()
    try {
      const { runCsvImport } = await import('./backup/import')
      const r = await runCsvImport(opts.plan, opts.projectId, (label, ratio) => {
        update({ simple: { ratio, label } })
        addLog({ at: Date.now() - t0, kind: 'write', key: 'sheetStep', text: label })
      }, opts.sourceLabel, () => !!job?.stopRequested)
      update({
        status: r.stopped ? 'stopped' : 'done',
        sheet: { created: r.created, people: r.people, errors: r.errors },
        endedAt: Date.now(), simple: null,
      }, true)
      for (const e of r.errors.slice(0, 20)) addLog({ at: Date.now() - t0, kind: 'error', key: 'sheetStep', text: e })
    } catch (e) {
      update({ status: 'failed', error: (e as Error)?.message ?? String(e), endedAt: Date.now(), simple: null }, true)
    } finally {
      window.removeEventListener('beforeunload', onBeforeUnload)
      queryClient.invalidateQueries()
    }
  })()
  return true
}

/** Ask the running import to stop: it finishes the step in hand and ends. */
export function requestStopImport() { update({ stopRequested: true }, true) }

/** Forget a finished job (the dock and the settings tab stop showing it). */
export function dismissImportJob() { if (job && job.status !== 'running') { job = null; emit(true) } }
