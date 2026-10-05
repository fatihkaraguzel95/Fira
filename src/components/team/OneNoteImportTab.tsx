import { useEffect, useMemo, useRef, useState } from 'react'
import type { Team } from '../../types'
import { scanNotebook, type ScanResult, type Progress, type ImportReport } from '../../lib/onenote/import'
import { useImportJob, startImportJob, dismissImportJob } from '../../lib/importJob'
import { ImportLog, ImportProgress, StopImportButton, importRatio } from '../ui/ImportDock'
import { formatBytes } from '../../lib/image'
import { useT } from '../../i18n'

/**
 * Team settings › OneNote (#AAC9D463). Loaded on demand: it pulls in the
 * OneNote converter (WebAssembly, ~1.5 MB) and turndown.
 *
 * The import itself is an app-level job (lib/importJob, #684A9085): this tab
 * starts it and shows it, but closing the window does not end it — the dock at
 * the bottom right keeps showing it. Scanning (read-only) stays in the tab.
 */
export function OneNoteImportTab({ team, canManage }: { team: Team; canManage: boolean }) {
  const t = useT()
  const job = useImportJob()
  const mine = job?.teamId === team.id ? job : null
  const otherRunning = job?.status === 'running' && job.teamId !== team.id ? job : null
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<Progress | null>(null)
  const [busy, setBusy] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Leaving mid-scan throws the scan away; the browser asks first (the import job guards itself).
  useEffect(() => {
    if (!busy) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [busy])

  const pick = async (list: FileList | null) => {
    if (!list?.length) return
    setFailure(null); setEmpty(false); setScan(null); setBusy(true)
    try {
      const res = await scanNotebook(Array.from(list), setProgress)
      if (!res.sections.length) setEmpty(true)
      setScan(res)
      setChosen(new Set(res.sections.map((s) => s.relPath)))
    } catch (e) {
      setFailure((e as Error)?.message ?? String(e))
    } finally {
      setBusy(false); setProgress(null)
      if (folderRef.current) folderRef.current.value = ''
      if (filesRef.current) filesRef.current.value = ''
    }
  }

  const selected = useMemo(() => scan?.sections.filter((s) => chosen.has(s.relPath)) ?? [], [scan, chosen])
  const totals = useMemo(() => selected.reduce((a, s) => ({
    pages: a.pages + s.pages, images: a.images + s.images, files: a.files + s.files, bytes: a.bytes + s.bytes,
    ocr: a.ocr + s.ocrImages, tooBig: [...a.tooBig, ...s.tooBig], revisions: a.revisions + s.revisions,
    history: a.history + s.versionHistoryPages, historySections: s.versionHistoryPages ? [...a.historySections, s.name] : a.historySections,
  }), { pages: 0, images: 0, files: 0, bytes: 0, ocr: 0, revisions: 0, tooBig: [] as { name: string; bytes: number }[], history: 0, historySections: [] as string[] }), [selected])

  const start = () => {
    if (!selected.length || !scan) return
    setFailure(null)
    if (startImportJob({ teamId: team.id, teamName: team.name, notebook: scan.notebook, sections: selected })) setScan(null)
  }
  const again = () => { dismissImportJob(); setScan(null) }

  if (!canManage) return <p className="text-sm text-fg-muted">{t('onenote.managersOnly')}</p>

  const toggle = (rel: string) => setChosen((s) => { const n = new Set(s); if (n.has(rel)) n.delete(rel); else n.add(rel); return n })
  const groups = scan ? Array.from(new Set(scan.sections.map((s) => s.group))) : []

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-fg">{t('onenote.title')}{scan?.notebook ? ` · ${scan.notebook}` : ''}</h3>
        <p className="text-xs text-fg-muted mt-1 leading-relaxed">{t('onenote.intro')}</p>
        <p className="text-xs text-fg-faint mt-1 leading-relaxed">{t('onenote.howTo')}</p>
      </div>

      {/* The import of this team: running (progress, log, stop) or finished (report). */}
      {mine && mine.status === 'running' && (
        <div className="space-y-3">
          <ImportProgress job={mine} />
          <p className="text-xs text-fg-muted">{t('onenote.keepOpen')}</p>
          <ImportLog job={mine} height="h-64" />
          <div className="flex justify-end"><StopImportButton job={mine} /></div>
        </div>
      )}
      {mine && mine.status !== 'running' && (
        <div className="space-y-3">
          {mine.status === 'stopped' && <p className="text-sm text-warning">{t('onenote.stoppedNote')}</p>}
          {mine.status === 'failed' && <p className="text-sm text-danger" role="alert">{t('onenote.failedNote', { error: mine.error ?? '' })}</p>}
          {mine.report && <ReportView report={mine.report} onAgain={again} />}
          {!mine.report && <button type="button" onClick={again} className="px-4 py-2 border border-line text-fg-2 text-sm font-medium rounded-lg hover:bg-raised">{t('onenote.again')}</button>}
          <details className="text-xs">
            <summary className="cursor-pointer text-fg-muted">{t('onenote.showLog')}</summary>
            <div className="mt-2"><ImportLog job={mine} height="h-64" /></div>
          </details>
        </div>
      )}
      {otherRunning && <p className="text-sm text-warning">{t('onenote.otherTeam', { team: otherRunning.teamName })}</p>}

      {!busy && !mine && !otherRunning && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => folderRef.current?.click()} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700">
            {t('onenote.pickFolder')}
          </button>
          <button type="button" onClick={() => filesRef.current?.click()} className="px-4 py-2 border border-line text-fg-2 text-sm font-medium rounded-lg hover:bg-raised">
            {t('onenote.pickFiles')}
          </button>
          <input ref={folderRef} type="file" multiple hidden onChange={(e) => void pick(e.target.files)} {...{ webkitdirectory: '', directory: '' }} />
          <input ref={filesRef} type="file" multiple accept=".one" hidden onChange={(e) => void pick(e.target.files)} />
        </div>
      )}

      {empty && <p className="text-sm text-warning">{t('onenote.noSections')}</p>}
      {failure && <p className="text-sm text-danger" role="alert">{failure}</p>}

      {progress && <ProgressBar p={progress} />}

      {scan && !busy && !mine && !otherRunning && scan.sections.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-fg-2">{t('onenote.summary', { sections: selected.length, pages: totals.pages, images: totals.images, files: totals.files, size: formatBytes(totals.bytes) })}</p>
          {totals.ocr > 0 && <p className="text-xs text-success">{t('onenote.ocr', { n: totals.ocr })}</p>}
          {totals.revisions > 0 && <p className="text-xs text-fg-muted">{t('onenote.revisions', { n: totals.revisions })}</p>}
          {totals.history > 0 && (
            <p className="text-xs text-warning leading-relaxed" role="alert">{t('onenote.versionHistory', { n: totals.history, sections: totals.historySections.join(', ') })}</p>
          )}
          {totals.tooBig.length > 0 && (
            <div className="text-xs text-warning">
              {t('onenote.tooBig', { n: totals.tooBig.length })}{' '}
              {totals.tooBig.map((f) => `${f.name} (${formatBytes(f.bytes)})`).join(', ')}
            </div>
          )}

          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setChosen(new Set(scan.sections.map((s) => s.relPath)))} className="text-primary-600 dark:text-primary-400 hover:underline">{t('onenote.selectAll')}</button>
            <button type="button" onClick={() => setChosen(new Set())} className="text-fg-muted hover:underline">{t('onenote.selectNone')}</button>
          </div>

          <div className="border border-line-soft rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-72 overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="bg-raised text-fg-muted sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">{t('onenote.col.section')}</th>
                    <th className="text-right font-medium px-2 py-2">{t('onenote.col.pages')}</th>
                    <th className="text-right font-medium px-2 py-2">{t('onenote.col.images')}</th>
                    <th className="text-right font-medium px-2 py-2">{t('onenote.col.files')}</th>
                    <th className="text-right font-medium px-3 py-2">{t('onenote.col.size')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <GroupRows key={g ?? '__root'} label={g ?? t('onenote.root')} sections={scan.sections.filter((s) => s.group === g)} chosen={chosen} onToggle={toggle} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-fg-faint">{t('onenote.reimport')}</p>
          {/* Always in view (#684A9085): a long section list pushed the button off screen and
              the import looked done. Sticks to the bottom edge of the settings window. */}
          <div className="sticky -bottom-6 -mx-6 px-6 py-3 bg-surface/95 backdrop-blur-sm border-t border-line-soft flex items-center gap-2 z-10">
            <button type="button" disabled={!selected.length} onClick={start} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {t('onenote.start', { n: selected.length })}
            </button>
            <button type="button" onClick={() => setScan(null)} className="px-4 py-2 text-sm text-fg-muted hover:text-fg">{t('onenote.cancel')}</button>
            <span className="flex-1" />
            <span className="text-xs text-fg-muted text-right hidden sm:inline">{t('onenote.summary', { sections: selected.length, pages: totals.pages, images: totals.images, files: totals.files, size: formatBytes(totals.bytes) })}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function GroupRows({ label, sections, chosen, onToggle }: {
  label: string
  sections: ScanResult['sections']
  chosen: Set<string>
  onToggle: (rel: string) => void
}) {
  const t = useT()
  return (
    <>
      <tr className="bg-app/60"><td colSpan={5} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-fg-faint">{label}</td></tr>
      {sections.map((s) => (
        <tr key={s.relPath} className="border-t border-line-soft">
          <td className="px-3 py-1.5">
            <label className="flex items-center gap-2 cursor-pointer min-w-0">
              <input type="checkbox" checked={chosen.has(s.relPath)} onChange={() => onToggle(s.relPath)} className="accent-primary-600" />
              <span className="truncate text-fg-2">{s.name}</span>
              {s.failedPages > 0
                ? <span className="text-warning flex-shrink-0" title={s.error ?? ''}>⚠ {t('onenote.unreadablePages', { n: s.failedPages })}</span>
                : s.error && <span className="text-warning flex-shrink-0" title={s.error}>⚠ {t('onenote.sectionError')}</span>}
            </label>
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums text-fg-2">{s.pages}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{s.images}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{s.files}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted">{formatBytes(s.bytes)}</td>
        </tr>
      ))}
    </>
  )
}

function ProgressBar({ p }: { p: Progress }) {
  const t = useT()
  const ratio = importRatio(p)
  const text = p.phase === 'scan'
    ? t('onenote.scanning', { done: p.done, total: p.total })
    : t('onenote.importing', { section: Math.min(p.section + 1, p.sections), sections: p.sections, pages: p.pagesDone, pagesTotal: p.pagesTotal, done: formatBytes(p.bytesDone), total: formatBytes(p.bytesTotal) })
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <div className="flex justify-between text-xs text-fg-2"><span>{text}</span><span className="tabular-nums">{Math.round(ratio * 100)}%</span></div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full bg-primary-500 transition-all" style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
      <p className="text-xs text-fg-faint truncate">{p.current}</p>
    </div>
  )
}

function ReportView({ report, onAgain }: { report: ImportReport; onAgain: () => void }) {
  const t = useT()
  const ok = report.errors.length === 0 && report.unreadable.length === 0
  return (
    <div className="space-y-3">
      <p className={`text-sm font-semibold ${ok ? 'text-success' : 'text-warning'}`}>{ok ? t('onenote.done') : t('onenote.doneWithErrors')}</p>
      <p className="text-sm text-fg-2">{t('onenote.report', { created: report.created, updated: report.updated, unchanged: report.unchanged, folders: report.folders, uploaded: report.uploaded, size: formatBytes(report.uploadedBytes) })}</p>
      {report.versions > 0 && <p className="text-xs text-fg-muted">{t('onenote.versionsAdded', { n: report.versions })}</p>}
      {report.kept.length > 0 && (
        <details open className="text-xs text-fg-2">
          <summary className="cursor-pointer font-medium">{t('onenote.kept', { n: report.kept.length })}</summary>
          <p className="mt-1 text-fg-muted">{t('onenote.keptHint')}</p>
          <ul className="mt-1 ml-4 list-disc">{report.kept.map((k, i) => <li key={i}>{k}</li>)}</ul>
        </details>
      )}
      {report.skippedFiles.length > 0 && (
        <details className="text-xs text-fg-muted">
          <summary className="cursor-pointer">{t('onenote.skipped', { n: report.skippedFiles.length })}</summary>
          <ul className="mt-1 ml-4 list-disc">{report.skippedFiles.map((f, i) => <li key={i}>{f.page} › {f.name} ({formatBytes(f.bytes)})</li>)}</ul>
        </details>
      )}
      {report.unreadable.length > 0 && (
        <details open className="text-xs text-warning">
          <summary className="cursor-pointer">{t('onenote.unreadable', { n: report.unreadable.reduce((n, u) => n + u.pages, 0) })}</summary>
          <ul className="mt-1 ml-4 list-disc">
            {report.unreadable.map((u, i) => (
              <li key={i}>{u.versionHistory === u.pages ? t('onenote.unreadableHistory', { section: u.section, n: u.pages }) : t('onenote.unreadableRow', { section: u.section, n: u.pages })}</li>
            ))}
          </ul>
        </details>
      )}
      {report.errors.length > 0 && (
        <details open className="text-xs text-danger">
          <summary className="cursor-pointer">{t('onenote.errors', { n: report.errors.length })}</summary>
          <ul className="mt-1 ml-4 list-disc">{report.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      )}
      <button type="button" onClick={onAgain} className="px-4 py-2 border border-line text-fg-2 text-sm font-medium rounded-lg hover:bg-raised">{t('onenote.again')}</button>
    </div>
  )
}
