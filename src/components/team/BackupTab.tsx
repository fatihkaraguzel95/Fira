import { useMemo, useRef, useState } from 'react'
import { displayTime, useDateFormat } from '../../lib/time'
import { useQueryClient } from '@tanstack/react-query'
import type { Team } from '../../types'
import { useProjects } from '../../hooks/useProjects'
import { useTeamMemberProfiles } from '../../hooks/useTeams'
import { useStatuses } from '../../hooks/useStatuses'
import { useTags } from '../../hooks/useTags'
import { buildBackupZip, collectBundle, saveBlob } from '../../lib/backup/export'
import { csvPackage, xlsxPackage } from '../../lib/backup/csv'
import { toolExport, TOOL_LABELS, toolLosses, type ToolProfile } from '../../lib/backup/tools'
import { readBackupFile, previewImport, runImport, restoreFiles, guessMapping, planCsvImport, CSV_FIELDS, CSV_FIELD_KEYS, type CsvField, type ReadBackup, type Preview, type CsvPlan } from '../../lib/backup/import'
import { readWorkbook, SPREADSHEET_ACCEPT, type WorkbookDoc } from '../../lib/backup/sheet'
import { detectPlanner, buildPlannerPlan, type PlannerDoc, type PlannerPlan } from '../../lib/backup/planner'
import { countBundle, type ImportMode, type ImportReport } from '../../lib/backup/types'
import { formatBytes } from '../../lib/image'
// `t` is the loop variable for tickets/tags in this file, hence the alias.
import { useT, type TranslationKey } from '../../i18n'
import JSZip from 'jszip'
import { startSheetImportJob, useImportJob, dismissImportJob } from '../../lib/importJob'
import { ImportProgress, ImportLog, StopImportButton } from '../ui/ImportDock'

interface Props { team: Team; canManage: boolean }

/** Keys, not words: this table is built once at import, the text is looked up on render. */
const MODE_KEYS: Record<ImportMode, { label: TranslationKey; hint: TranslationKey }> = {
  restore: { label: 'team.backup.mode.restore', hint: 'team.backup.mode.restoreHint' },
  skip: { label: 'team.backup.mode.skip', hint: 'team.backup.mode.skipHint' },
  copy: { label: 'team.backup.mode.copy', hint: 'team.backup.mode.copyHint' },
}
const MODES = Object.keys(MODE_KEYS) as ImportMode[]

// Exposed for QA round-trip checks from the browser console (all calls are RLS/RPC-guarded).
;(window as unknown as { __firaBackup?: unknown }).__firaBackup = { collectBundle, buildBackupZip, previewImport, runImport, csvPackage, toolExport, readWorkbook, detectPlanner, buildPlannerPlan, planCsvImport }

export function BackupTab({ team, canManage }: Props) {
  const tr = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [includeFiles, setIncludeFiles] = useState(true)
  const [tool, setTool] = useState<ToolProfile>('jira')

  // JSON import
  const fileRef = useRef<HTMLInputElement>(null)
  const [read, setRead] = useState<ReadBackup | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mode, setMode] = useState<ImportMode>('restore')
  const [target, setTarget] = useState<'this' | 'new'>('this')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [fileErrors, setFileErrors] = useState<string[]>([])

  // Spreadsheet import (Excel first: a Planner export is a workbook, not a table)
  const csvRef = useRef<HTMLInputElement>(null)
  const { data: projects = [] } = useProjects(team.id)
  const [csvProject, setCsvProject] = useState<string>('')
  const { data: csvStatuses = [] } = useStatuses(csvProject || null)
  const { data: csvTags = [] } = useTags(csvProject || null)
  const members = useTeamMemberProfiles(team.id)
  const [wb, setWb] = useState<WorkbookDoc | null>(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [planner, setPlanner] = useState<PlannerDoc | null>(null)
  const [usePlanner, setUsePlanner] = useState(true)
  const [columnSource, setColumnSource] = useState<'bucket' | 'progress'>('bucket')
  const [checklistAsSubtasks, setChecklistAsSubtasks] = useState(true)
  const [completedToDone, setCompletedToDone] = useState(true)
  const [mapping, setMapping] = useState<Record<string, CsvField>>({})
  const [csvResult, setCsvResult] = useState<{ created: number; errors: string[]; people?: number } | null>(null)
  // Only this tab's own kind of job is shown here; a OneNote import has its own tab.
  const job = useImportJob()
  const sheetJob = job?.kind === 'sheet' ? job : null

  const sheet = wb?.sheets[sheetIdx] ?? null
  const plannerMode = !!planner && usePlanner

  const plannerPlan: PlannerPlan | null = useMemo(() => {
    if (!planner || !usePlanner) return null
    return buildPlannerPlan(planner, { columnSource, checklistAsSubtasks, completedToDone }, {
      statuses: csvStatuses.map((s) => ({ name: s.name, category: s.category })),
      tags: csvTags.map((t) => t.name),
      users: members.filter((m) => !!m.email).map((m) => ({ email: m.email!, name: m.full_name })),
    })
  }, [planner, usePlanner, columnSource, checklistAsSubtasks, completedToDone, csvStatuses, csvTags, members])

  const plan: CsvPlan | null = useMemo(() => {
    if (plannerPlan) return plannerPlan.plan
    if (!sheet) return null
    return planCsvImport(sheet.rows, mapping, { statuses: csvStatuses.map((s) => s.name), tags: csvTags.map((t) => t.name), users: members.map((m) => m.email ?? '') })
  }, [plannerPlan, sheet, mapping, csvStatuses, csvTags, members])

  const subtaskCount = plan?.tickets.filter((t) => t.parentKey).length ?? 0
  const canImport = plannerMode || Object.values(mapping).includes('title')

  const onProgress = (m: string, r: number) => { setMsg(m); setProgress(r) }
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null); setProgress(0)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  if (!canManage) return <p className="text-sm text-fg-faint">{tr('team.backup.onlyAdmins')}</p>

  const exportZip = () => run('zip', async () => {
    const { blob, bundle, fileName } = await buildBackupZip(team.id, { includeFiles }, onProgress)
    saveBlob(blob, fileName)
    const c = countBundle(bundle)
    setMsg(
      tr('team.backup.downloaded', {
        size: formatBytes(blob.size), lists: c.listeler, tickets: c.gorevler,
        subtasks: c.alt_gorevler, comments: c.yorumlar, files: c.dosyalar,
      }) + (bundle.warnings.length ? ` ${tr('team.backup.warningsSuffix', { n: bundle.warnings.length })}` : ''),
    )
    try { localStorage.setItem(`fira.lastBackup.${team.id}`, new Date().toISOString()) } catch { /* ignore */ }
  })
  const exportCsv = () => run('csv', async () => {
    const bundle = await collectBundle(team.id, onProgress)
    const zip = new JSZip()
    for (const f of csvPackage(bundle)) zip.file(f.name, f.content)
    zip.file('fira-tables.xlsx', xlsxPackage(bundle))
    saveBlob(await zip.generateAsync({ type: 'blob' }), `fira-csv-${bundle.exported_at.slice(0, 10)}.zip`)
    setMsg(tr('team.backup.csvDownloaded'))
  })
  const exportTool = () => run('tool', async () => {
    const bundle = await collectBundle(team.id, onProgress)
    const { name, blob } = toolExport(bundle, tool)
    saveBlob(blob, name)
    setMsg(tr('team.backup.toolDownloaded', { tool: TOOL_LABELS[tool], name, losses: toolLosses(tool).join(' · ') }))
  })

  const pickBackup = async (f: File | undefined) => {
    if (!f) return
    setReport(null); setFileErrors([]); setPreview(null); setRead(null)
    await run('read', async () => {
      const r = await readBackupFile(f)
      setRead(r)
      setPreview(await previewImport(r.bundle))
      setMode(r.bundle.team.id === team.id ? 'restore' : 'copy')
      setTarget('this')
    })
  }
  const doImport = () => read && run('import', async () => {
    const targetTeam = mode === 'copy' ? (target === 'this' ? team.id : null) : null
    const rep = await runImport(read.bundle, mode, targetTeam)
    setReport(rep)
    const errs = await restoreFiles(read, rep, onProgress)
    setFileErrors(errs)
    qc.invalidateQueries()
    setMsg(tr('team.backup.importDone'))
  })

  const pickSheet = (doc: WorkbookDoc, idx: number) => {
    setSheetIdx(idx)
    setMapping(guessMapping(doc.sheets[idx]?.headers ?? []))
  }
  const pickCsv = (f: File | undefined) => f && run('read', async () => {
    setCsvResult(null); setMsg(null)
    const doc = await readWorkbook(f)
    const detected = detectPlanner(doc)
    setWb(doc); setPlanner(detected); setUsePlanner(!!detected)
    // Default to the sheet the adapter picked, so manual mapping starts in the right place.
    const idx = detected ? Math.max(0, doc.sheets.findIndex((sh) => sh.name === detected.taskSheet)) : doc.sheets.findIndex((sh) => sh.rows.length > 0)
    pickSheet(doc, Math.max(0, idx))
    setMsg(detected
      ? tr('team.backup.plannerDetectedMsg', { tasks: detected.tasks.length, buckets: detected.buckets.length, users: detected.users.length })
      : tr('team.backup.sheetsRead', { n: doc.sheets.length }))
  })
  // The import is an app-level job now (#8DA9D47F): it survives closing this
  // window, reports in the dock and can be stopped — same as OneNote.
  const doCsv = () => {
    if (!plan || !csvProject) return
    const label = planner ? `Microsoft Planner · ${planner.planName}` : (wb?.fileName ?? null)
    setCsvResult(null)
    const started = startSheetImportJob({
      teamId: team.id,
      teamName: team.name,
      source: planner?.planName ?? wb?.fileName ?? '',
      projectId: csvProject,
      plan,
      sourceLabel: label,
    })
    setMsg(started ? tr('team.import.job.started') : tr('team.import.job.running'))
  }

  const lastBackup = (() => { try { return localStorage.getItem(`fira.lastBackup.${team.id}`) } catch { return null } })()
  const box = 'rounded-xl border border-line p-4 space-y-3'
  const btn = 'text-sm font-semibold px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50'
  const btn2 = 'text-sm font-medium px-3 py-2 rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-50'

  return (
    <div className="space-y-5">
      {(busy || msg || error) && (
        <div className={`rounded-lg px-3 py-2 text-sm ${error ? 'bg-danger/10 text-danger' : 'bg-raised text-fg-2'}`}>
          {busy && <div className="h-1 rounded-full bg-line overflow-hidden mb-1.5"><div className="h-full bg-primary-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          {error ?? msg}
        </div>
      )}

      {/* ── Export ── */}
      <section className={box}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">{tr('team.backup.zipTitle')}</h3>
            <p className="text-xs text-fg-muted mt-0.5">{tr('team.backup.zipDesc')}</p>
            {lastBackup && <p className="text-xs text-fg-faint mt-1">{tr('team.backup.lastBackup', { date: displayTime(lastBackup) })}</p>}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-2"><input type="checkbox" checked={includeFiles} onChange={(e) => setIncludeFiles(e.target.checked)} /> {tr('team.backup.includeFiles')}</label>
        <button className={btn} disabled={!!busy} onClick={exportZip}>{busy === 'zip' ? tr('team.backup.preparing') : tr('team.backup.download')}</button>
      </section>

      <section className={box}>
        <h3 className="text-sm font-semibold text-fg">{tr('team.backup.toolTitle')}</h3>
        <p className="text-xs text-fg-muted">{tr('team.backup.toolDesc')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn2} disabled={!!busy} onClick={exportCsv}>{tr('team.backup.csvPackage')}</button>
          <select value={tool} onChange={(e) => setTool(e.target.value as ToolProfile)} className="text-sm bg-field border border-line rounded-lg px-2 py-2 text-fg">
            {(Object.keys(TOOL_LABELS) as ToolProfile[]).map((k) => <option key={k} value={k}>{TOOL_LABELS[k]}</option>)}
          </select>
          <button className={btn2} disabled={!!busy} onClick={exportTool}>{tr('team.backup.downloadProfile')}</button>
        </div>
        <ul className="text-xs text-fg-faint list-disc pl-4">{toolLosses(tool).map((l) => <li key={l}>{l}</li>)}</ul>
      </section>

      {/* ── Import JSON ── */}
      <section className={box}>
        <h3 className="text-sm font-semibold text-fg">{tr('team.backup.importTitle')}</h3>
        <p className="text-xs text-fg-muted">{tr('team.backup.importDesc')}</p>
        <input ref={fileRef} type="file" accept=".zip,.json" className="hidden" onChange={(e) => { pickBackup(e.target.files?.[0]); e.target.value = '' }} />
        <button className={btn2} disabled={!!busy} onClick={() => fileRef.current?.click()}>{tr('team.backup.pickFile')}</button>

        {read && preview && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg bg-raised p-3 text-xs text-fg-2 space-y-1">
              <p><b>{read.bundle.team.name}</b> · {displayTime(read.bundle.exported_at)} · v{read.bundle.app_version} · {read.bundle.source_origin}</p>
              {(() => {
                const c = countBundle(read.bundle)
                return <p>{tr('team.backup.bundleCounts', {
                  lists: c.listeler, tickets: c.gorevler, subtasks: c.alt_gorevler, comments: c.yorumlar,
                  files: c.dosyalar, zipFiles: read.bundle.files.length, members: c.uyeler,
                })}</p>
              })()}
              <p>{tr('team.backup.teamLine', {
                state: preview.teamExists
                  ? (preview.isAdminOfTeam ? tr('team.backup.teamState.admin') : tr('team.backup.teamState.notAdmin'))
                  : tr('team.backup.teamState.absent'),
                existing: preview.existingTickets,
                known: preview.knownUsers,
                unmapped: preview.unmappedUsers.length
                  ? tr('team.backup.unmappedSuffix', {
                    n: preview.unmappedUsers.length,
                    list: preview.unmappedUsers.slice(0, 5).join(', ') + (preview.unmappedUsers.length > 5 ? '…' : ''),
                  })
                  : '',
              })}</p>
              {read.bundle.warnings.length > 0 && <p className="text-warning">{tr('team.backup.bundleWarnings', { n: read.bundle.warnings.length })}</p>}
            </div>
            <div className="space-y-1.5">
              {MODES.map((m) => (
                <label key={m} className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer ${mode === m ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/20' : 'border-line'}`}>
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="mt-0.5" />
                  <span><span className="font-medium text-fg">{tr(MODE_KEYS[m].label)}</span><br /><span className="text-xs text-fg-muted">{tr(MODE_KEYS[m].hint)}</span></span>
                </label>
              ))}
              {mode === 'copy' && (
                <div className="flex gap-3 text-xs text-fg-2 pl-1">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={target === 'this'} onChange={() => setTarget('this')} /> {tr('team.backup.copyToThis', { name: team.name })}</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} /> {tr('team.backup.copyToNew')}</label>
                </div>
              )}
              {mode !== 'copy' && preview.teamExists && !preview.isAdminOfTeam && <p className="text-xs text-danger">{tr('team.backup.needAdmin')}</p>}
            </div>
            <button className={btn} disabled={!!busy || (mode !== 'copy' && preview.teamExists && !preview.isAdminOfTeam)} onClick={doImport}>{busy === 'import' ? tr('team.backup.importing') : tr('team.backup.import')}</button>
          </div>
        )}
        {report && (
          <div className="rounded-lg bg-raised p-3 text-xs text-fg-2 space-y-1">
            <p className="font-semibold text-fg">{tr('team.backup.reportTitle', { mode: tr(MODE_KEYS[report.mode].label) })}</p>
            <p>{Object.entries(report.counts).map(([k, v]) => `${k}: ${v.inserted}`).join(' · ')}</p>
            {report.unmapped_users.length > 0 && <p>{tr('team.backup.reportUnmapped', { list: report.unmapped_users.join(', ') })}</p>}
            {fileErrors.length > 0 && <p className="text-danger">{tr('team.backup.fileErrors', { list: fileErrors.slice(0, 5).join(' · ') + (fileErrors.length > 5 ? ` (+${fileErrors.length - 5})` : '') })}</p>}
            <button className="text-primary-600 dark:text-primary-400 hover:underline" onClick={() => saveBlob(new Blob([JSON.stringify({ ...report, fileErrors }, null, 2)], { type: 'application/json' }), 'fira-import-report.json')}>{tr('team.backup.downloadReport')}</button>
          </div>
        )}
      </section>

      {/* ── Import from a spreadsheet ── */}
      <section className={box}>
        <h3 className="text-sm font-semibold text-fg">{tr('team.backup.sheetTitle')}</h3>
        <p className="text-xs text-fg-muted">{tr('team.backup.sheetDesc')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={csvProject} onChange={(e) => setCsvProject(e.target.value)} className="text-sm bg-field border border-line rounded-lg px-2 py-2 text-fg">
            <option value="">{tr('team.backup.targetList')}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input ref={csvRef} type="file" accept={SPREADSHEET_ACCEPT} className="hidden" onChange={(e) => { pickCsv(e.target.files?.[0]); e.target.value = '' }} />
          <button className={btn2} disabled={!!busy} onClick={() => csvRef.current?.click()}>{busy === 'read' ? tr('team.backup.reading') : tr('team.backup.pickSheetFile')}</button>
        </div>

        {wb && (
          <div className="space-y-2 text-xs">
            <p className="text-fg-2">
              {wb.fileName} · {tr('team.backup.sheetCount', { n: wb.sheets.length })}
              {wb.sheets.length > 1 && <span className="text-fg-faint"> ({wb.sheets.map((sh) => `${sh.name}: ${sh.rows.length}`).join(' · ')})</span>}
            </p>

            {planner && (
              <div className="rounded-lg border border-primary-300 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/20 p-3 space-y-2">
                <p className="font-semibold text-fg">{tr('team.backup.plannerDetected')}</p>
                <p className="text-fg-2">{tr('team.backup.planLabel')} <span className="font-medium">{planner.planName}</span> · {tr('team.backup.planStats', { tasks: planner.tasks.length, buckets: planner.buckets.length, list: planner.buckets.join(', '), users: planner.users.length })}</p>
                {usePlanner ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-fg-2">{tr('team.backup.columnsLabel')}</span>
                      <label className="inline-flex items-center gap-1.5"><input type="radio" checked={columnSource === 'bucket'} onChange={() => setColumnSource('bucket')} /> {tr('team.backup.bucketsOption', { n: planner.buckets.length })}</label>
                      <label className="inline-flex items-center gap-1.5"><input type="radio" checked={columnSource === 'progress'} onChange={() => setColumnSource('progress')} /> {tr('team.backup.progressOption')}</label>
                    </div>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={checklistAsSubtasks} onChange={(e) => setChecklistAsSubtasks(e.target.checked)} /> {tr('team.backup.checklistAsSubtasks')}</label>
                    {columnSource === 'bucket' && (
                      <label className="flex items-start gap-1.5">
                        <input type="checkbox" className="mt-0.5" checked={completedToDone} onChange={(e) => setCompletedToDone(e.target.checked)} />
                        <span>{tr('team.backup.completedToDone')} <span className="text-fg-faint">{tr('team.backup.completedToDoneHint')}</span></span>
                      </label>
                    )}
                    <button className="text-fg-muted underline hover:text-fg-2" onClick={() => setUsePlanner(false)}>{tr('team.backup.mapManually')}</button>
                  </div>
                ) : (
                  <button className="text-fg-muted underline hover:text-fg-2" onClick={() => setUsePlanner(true)}>{tr('team.backup.backToPlanner')}</button>
                )}
              </div>
            )}

            {!plannerMode && sheet && (
              <div className="space-y-2">
                {wb.sheets.length > 1 && (
                  <label className="flex items-center gap-2 text-fg-2">
                    {tr('team.backup.sheetLabel')}
                    <select value={sheetIdx} onChange={(e) => pickSheet(wb, Number(e.target.value))} className="text-xs bg-field border border-line rounded-md px-1.5 py-1 text-fg">
                      {wb.sheets.map((sh, i) => <option key={sh.name} value={i}>{`${sh.name} (${tr('team.backup.rowCount', { n: sh.rows.length })})`}</option>)}
                    </select>
                  </label>
                )}
                <p className="text-fg-2">{tr('team.backup.sheetSummary', { rows: sheet.rows.length, cols: sheet.headers.length })}</p>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center max-h-48 overflow-auto pr-1">
                  {sheet.headers.map((h) => (
                    <FragmentRow key={h} header={h} sample={sheet.rows[0]?.[h] ?? ''} value={mapping[h] ?? 'ignore'} onChange={(v) => setMapping({ ...mapping, [h]: v })} />
                  ))}
                </div>
              </div>
            )}

            {plan && (
              <div className="rounded-lg bg-raised p-3 text-fg-2 space-y-1">
                <p className="font-semibold text-fg">{tr('team.backup.dryRun')}</p>
                <p>
                  {tr('team.backup.dryTickets', { n: plan.tickets.length - subtaskCount })}
                  {subtaskCount > 0 && ` ${tr('team.backup.drySubtasks', { n: subtaskCount })}`}
                  {!csvProject && ` ${tr('team.backup.dryPickList')}`}
                </p>
                {plannerPlan && <p>{tr('team.backup.plannerStats', { notes: plannerPlan.stats.withNotes, labels: plannerPlan.stats.labels, users: plannerPlan.stats.matchedUsers })}</p>}
                {plannerPlan && plannerPlan.stats.movedToDone > 0 && <p>{tr('team.backup.movedToDone', { n: plannerPlan.stats.movedToDone })}</p>}
                {plannerPlan && plannerPlan.stats.completions > 0 && <p>{tr('team.backup.completionsLogged', { n: plannerPlan.stats.completions })}</p>}
                {plan.newStatuses.length > 0 && <p>{tr('team.backup.newStatuses', { list: plan.newStatuses.map((st) => st.name).join(', ') })}</p>}
                {plan.newTags.length > 0 && <p>{tr('team.backup.newTags', { list: plan.newTags.join(', ') })}</p>}
                {plan.unknownUsers.length > 0 && (
                  <p>
                    {tr('team.backup.unknownUsers', { n: plan.unknownUsers.length })}{' '}
                    <span className="text-fg-muted">{plan.unknownUsers.join(', ')}</span>
                    <br />
                    <span className="text-fg-faint">{tr('team.backup.unknownUsersNote')}</span>
                  </p>
                )}
                {plannerPlan?.warnings.map((w) => <p key={w} className="text-warning">{w}</p>)}
                {!canImport && <p className="text-danger">{tr('team.backup.titleRequired', { field: tr(CSV_FIELD_KEYS.title) })}</p>}
              </div>
            )}
            <button className={btn} disabled={!!busy || !!sheetJob || !csvProject || !plan || !canImport} onClick={doCsv}>{sheetJob?.status === 'running' ? tr('team.backup.importing') : tr('team.backup.import')}</button>
            {sheetJob && (
              <div className="rounded-lg border border-line p-3 space-y-2">
                {sheetJob.status === 'running' ? <ImportProgress job={sheetJob} /> : (
                  <p className="text-fg-2">
                    {tr('team.import.job.summary', { created: sheetJob.sheet?.created ?? 0, people: sheetJob.sheet?.people ?? 0 })}
                    {sheetJob.status === 'stopped' ? ` · ${tr('team.import.job.stopped')}` : ''}
                    {sheetJob.error ? ` · ${sheetJob.error}` : ''}
                  </p>
                )}
                <ImportLog job={sheetJob} height="h-32" />
                <div className="flex items-center gap-2">
                  {sheetJob.status === 'running'
                    ? <StopImportButton job={sheetJob} />
                    : <button type="button" className={btn2} onClick={dismissImportJob}>{tr('common.close')}</button>}
                </div>
              </div>
            )}
            {csvResult && (
              <p className="text-fg-2">
                {tr('team.backup.csvCreated', { n: csvResult.created })}
                {csvResult.people ? tr('team.backup.csvPeople', { n: csvResult.people }) : ''}
                {'.'}
                {csvResult.errors.length ? ` ${tr('team.backup.csvErrors', { list: csvResult.errors.slice(0, 3).join(' · ') })}` : ''}
              </p>
            )}
          </div>
        )}
      </section>

      <section className={box}>
        <h3 className="text-sm font-semibold text-fg">{tr('team.backup.serverTitle')}</h3>
        <p className="text-xs text-fg-muted">{tr('team.backup.serverDesc')}</p>
      </section>
    </div>
  )
}

function FragmentRow({ header, sample, value, onChange }: { header: string; sample: string; value: CsvField; onChange: (v: CsvField) => void }) {
  const tr = useT()
  return (
    <>
      <div className="min-w-0"><span className="font-medium text-fg">{header}</span> <span className="text-fg-faint truncate">— {sample.slice(0, 40)}</span></div>
      <select value={value} onChange={(e) => onChange(e.target.value as CsvField)} className="text-xs bg-field border border-line rounded-md px-1.5 py-1 text-fg">
        {CSV_FIELDS.map((f) => <option key={f} value={f}>{tr(CSV_FIELD_KEYS[f])}</option>)}
      </select>
    </>
  )
}
