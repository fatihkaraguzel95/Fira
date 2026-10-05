import { useEffect, useRef, useState } from 'react'
import { useImportJob, requestStopImport, dismissImportJob, type ImportJob } from '../../lib/importJob'
import type { ImportLogLine, Progress } from '../../lib/onenote/import'
import { openTeamSettings } from '../../lib/teamSettingsBus'
import { Spinner } from './Spinner'
import { formatBytes } from '../../lib/image'
import { useT, type TranslationKey } from '../../i18n'

/** 0–1 share of the work done: bytes and pages both count (a text-only notebook has no bytes). */
export function importRatio(p: Progress | null): number {
  if (!p) return 0
  if (p.phase === 'scan') return p.total ? p.done / p.total : 0
  return p.bytesTotal ? (p.bytesDone + p.pagesDone) / (p.bytesTotal + p.pagesTotal) : p.pagesDone / Math.max(1, p.pagesTotal)
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
const secs = (ms: number) => `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: ms < 10000 ? 1 : 0 })} s`

/** Re-render every second while running (the elapsed clock). */
function useTicker(on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => set((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [on])
}

const KIND_MARK: Record<ImportLogLine['kind'], { mark: string; cls: string }> = {
  step: { mark: '▶', cls: 'text-fg' },
  ok: { mark: '✓', cls: 'text-success' },
  upload: { mark: '↑', cls: 'text-info' },
  write: { mark: '✎', cls: 'text-fg-2' },
  warn: { mark: '!', cls: 'text-warning' },
  error: { mark: '✗', cls: 'text-danger' },
}

/**
 * The import's running log, like a terminal's download list (#684A9085): each
 * step with the time it started and how long it took, newest at the bottom.
 * Follows the end unless the reader scrolled up.
 */
export function ImportLog({ job, height = 'h-44' }: { job: ImportJob; height?: string }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // Follow the end while the reader is at the bottom. The counter has to be
  // every line ever written, not `log.length`: the log is capped at LOG_MAX, so
  // once it is full the length stops changing and the effect stopped firing —
  // the log froze mid-import until the reader scrolled by hand (#684A9085).
  const written = job.log.length + job.logDropped
  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [written])
  const text = (l: ImportLogLine) => {
    if (l.text) return l.text
    const v: Record<string, string | number> = { ...(l.values ?? {}) }
    if (typeof v.bytes === 'number') v.size = formatBytes(v.bytes)
    return t(`onenote.log.${l.key}` as TranslationKey, v)
  }
  return (
    <div
      ref={box}
      // Back at (or near) the end: follow again. The slack covers fractional device pixels and the last line's descenders.
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32 }}
      className={`${height} overflow-y-auto scrollbar-thin rounded-lg bg-app border border-line-soft px-2 py-1.5 font-mono text-2xs leading-[1.55]`}
      role="log"
      aria-live="off"
    >
      {job.logDropped > 0 && <div className="text-fg-faint">{t('onenote.dock.dropped', { n: job.logDropped })}</div>}
      {job.log.map((l, i) => {
        const k = KIND_MARK[l.kind]
        return (
          <div key={job.logDropped + i} className="flex gap-2 min-w-0">
            <span className="text-fg-faint tabular-nums flex-shrink-0">{clock(l.at)}</span>
            <span className={`${k.cls} flex-shrink-0 w-3 text-center`}>{k.mark}</span>
            <span className={`flex-1 min-w-0 break-words ${l.kind === 'step' ? 'font-semibold text-fg' : l.kind === 'error' ? 'text-danger' : 'text-fg-2'}`}>{text(l)}</span>
            {l.ms !== undefined && <span className="text-fg-faint tabular-nums flex-shrink-0">{secs(l.ms)}</span>}
          </div>
        )
      })}
    </div>
  )
}

/** Bar + counts for a running job; the same block in the dock and in the OneNote tab. */
export function ImportProgress({ job }: { job: ImportJob }) {
  const t = useT()
  useTicker(job.status === 'running')
  const p = job.progress
  const pct = Math.round((job.kind === 'sheet' ? (job.simple?.ratio ?? 0) : importRatio(p)) * 100)
  const line = job.kind === 'sheet'
    ? job.simple?.label ?? ''
    : p?.phase === 'import'
    ? t('onenote.importing', { section: Math.min(p.section + 1, p.sections), sections: p.sections, pages: p.pagesDone, pagesTotal: p.pagesTotal, done: formatBytes(p.bytesDone), total: formatBytes(p.bytesTotal) })
    : null
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <div className="flex justify-between gap-2 text-xs text-fg-2">
        <span className="min-w-0">{line}</span>
        <span className="tabular-nums flex-shrink-0">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="flex justify-between gap-2 text-xs text-fg-faint">
        <span className="truncate min-w-0">{job.kind === 'onenote' && p?.phase === 'import' ? p.current : ''}</span>
        <span className="tabular-nums flex-shrink-0">{t('onenote.dock.running', { time: clock(Date.now() - job.startedAt) })}</span>
      </div>
    </div>
  )
}

/** "Durdur" with an in-place confirmation (no window.confirm — CLAUDE.md). */
export function StopImportButton({ job }: { job: ImportJob }) {
  const t = useT()
  const [asking, setAsking] = useState(false)
  if (job.stopRequested) return <span className="text-xs text-warning">{t('onenote.stopping')}</span>
  if (!asking) return <button type="button" onClick={() => setAsking(true)} className="px-2.5 py-1 text-xs font-medium rounded-md border border-line text-fg-2 hover:bg-raised">{t('onenote.stop')}</button>
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <p className="text-xs text-fg-2 leading-relaxed">{t('onenote.stopConfirm')}</p>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setAsking(false)} className="px-2.5 py-1 text-xs rounded-md text-fg-muted hover:bg-raised">{t('common.giveUp')}</button>
        <button type="button" onClick={() => { requestStopImport(); setAsking(false) }} className="px-2.5 py-1 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700">{t('onenote.stopYes')}</button>
      </div>
    </div>
  )
}

/**
 * Bottom-right card for the OneNote import (#684A9085), shown anywhere in the
 * app while an import runs and after it ends until dismissed: progress, the
 * section/page in hand, elapsed time, the log on demand, stop / open report.
 * Lives in NotificationHost's column, so toasts stack above it.
 */
export function ImportDock() {
  const t = useT()
  const job = useImportJob()
  const [open, setOpen] = useState(true)
  const [showLog, setShowLog] = useState(false)
  if (!job) return null
  const running = job.status === 'running'
  const sheet = job.kind === 'sheet'
  const title = running ? (sheet ? t('team.import.job.title') : t('onenote.dock.title'))
    : job.status === 'done' ? (sheet ? t('team.import.job.done') : t('onenote.dock.done'))
    : job.status === 'stopped' ? (sheet ? t('team.import.job.stopped') : t('onenote.dock.stopped'))
    : sheet ? t('team.import.job.failed') : t('onenote.dock.failed')
  const problems = sheet ? job.sheet?.errors.length ?? 0 : job.report?.errors.length ?? 0
  const tone = running ? 'text-primary-600 dark:text-primary-400' : job.status === 'done' && !problems ? 'text-success' : 'text-warning'
  const r = job.report
  return (
    <section aria-label={t('onenote.dock.title')} className="pointer-events-auto rounded-xl border border-line bg-surface shadow-lg p-3 animate-fade-in space-y-2">
      <div className="flex items-center gap-2">
        {running
          ? <Spinner className="text-primary-500" />
          : <span className={`${tone} flex-shrink-0 text-sm leading-none`} aria-hidden>{job.status === 'done' ? '✓' : '!'}</span>}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex-1 min-w-0 text-left">
          <span className={`block text-xs font-semibold truncate ${tone}`}>{title}</span>
          <span className="block text-xs text-fg-muted truncate">{job.teamName}{job.source ? ` · ${job.source}` : ''}</span>
        </button>
        {running && !open && <span className="text-2xs tabular-nums text-fg-muted">{Math.round(importRatio(job.progress) * 100)}%</span>}
        {!running && (
          <button type="button" onClick={dismissImportJob} aria-label={t('common.close')} className="text-fg-faint hover:text-fg-2 leading-none px-1">×</button>
        )}
      </div>

      {open && (
        <>
          {running && <ImportProgress job={job} />}
          {!running && (r || job.sheet) && (
            <p className="text-xs text-fg-2">
              {sheet && job.sheet
                ? t('team.import.job.summary', { created: job.sheet.created, people: job.sheet.people })
                : r ? t('onenote.dock.summary', { created: r.created, updated: r.updated, unchanged: r.unchanged }) : ''}
              {job.endedAt ? <span className="text-fg-faint"> · {t('onenote.dock.elapsed', { time: clock(job.endedAt - job.startedAt) })}</span> : null}
              {problems > 0 && <span className="text-warning"> · {t('team.import.job.errors', { n: problems })}</span>}
            </p>
          )}
          {job.status === 'failed' && job.error && <p className="text-xs text-danger break-words">{t('onenote.failedNote', { error: job.error })}</p>}
          {showLog && <ImportLog job={job} />}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setShowLog((s) => !s)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
              {showLog ? t('onenote.hideLog') : t('onenote.showLog')}
            </button>
            <span className="flex-1" />
            {!running && (
              <button
                type="button"
                onClick={() => openTeamSettings(job.teamId, sheet ? 'backup' : 'onenote')}
                className="px-2.5 py-1 text-xs font-medium rounded-md border border-line text-fg-2 hover:bg-raised"
              >
                {sheet ? t('team.import.job.openReport') : t('onenote.dock.openReport')}
              </button>
            )}
            {running && <StopImportButton job={job} />}
          </div>
        </>
      )}
    </section>
  )
}
