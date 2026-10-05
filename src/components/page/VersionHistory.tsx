import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { diffArrays, diffWordsWithSpace } from 'diff'
import type { Page } from '../../types'
import { usePageVersions, useRestorePageVersion, type PageVersion } from '../../hooks/usePages'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { DescriptionEditor } from '../ticket/DescriptionEditor'
import { displayTime, exactTime } from '../../lib/time'
import { markHandled } from '../../lib/keys'
import { useT } from '../../i18n'
import { LoadingLine } from '../ui/Spinner'

/**
 * A page's history (067): who changed it and when, what each earlier state
 * looked like, what differs from now, and "restore" — which keeps the current
 * state as a version too, so going back never loses anything (like Confluence).
 */
export function VersionHistory({ page, canWrite, onClose, onRestored }: {
  page: Page
  canWrite: boolean
  onClose: () => void
  /** The page row changed under the editor; it must reload. */
  onRestored: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  const { data: versions = [], isLoading } = usePageVersions(page.id)
  const restore = useRestorePageVersion()
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'preview' | 'changes'>('changes')
  const current = versions.find((v) => v.id === selected) ?? null

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { markHandled(e); e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  const doRestore = async () => {
    if (!current) return
    await restore.mutateAsync({ versionId: current.id })
    onRestored()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('page.versions.title')}
        className="bg-surface rounded-xl shadow-2xl w-full max-w-6xl h-[min(88vh,820px)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg truncate">{t('page.versions.title')} · {page.title.trim() || t('page.untitled')}</h2>
            <p className="text-xs text-fg-muted">{t('page.versions.count', { n: versions.length })}</p>
          </div>
          <button onClick={onClose} aria-label={t('page.versions.close')} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <ul className="md:w-72 flex-shrink-0 border-b md:border-b-0 md:border-r border-line-soft overflow-y-auto scrollbar-thin max-h-48 md:max-h-none py-1">
            <li>
              <button onClick={() => setSelected(null)} aria-current={selected === null ? 'true' : undefined}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${selected === null ? 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300' : 'text-fg-2 hover:bg-raised'}`}>
                <span className="font-medium">{t('page.versions.current')}</span>
                <span className="block text-xs text-fg-faint" title={exactTime(page.updated_at)}>{authorOfPage(page, t)} · {displayTime(page.updated_at)}</span>
              </button>
            </li>
            {versions.map((v) => (
              <li key={v.id}>
                <button onClick={() => setSelected(v.id)} aria-current={selected === v.id ? 'true' : undefined}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${selected === v.id ? 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300' : 'text-fg-2 hover:bg-raised'}`}>
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium" title={exactTime(v.saved_at)}>{exactTime(v.saved_at)}</span>
                    {v.source !== 'fira' && (
                      <span className={`text-2xs font-semibold px-1.5 rounded-md ${v.source === 'onenote' ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300' : 'bg-warning/15 text-warning'}`}>
                        {v.source === 'onenote' ? t('page.versions.sourceOneNote') : t('page.versions.sourceConflict')}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-fg-faint truncate">{authorOf(v, t)}{v.title !== page.title ? ` · ${v.title.trim() || t('page.untitled')}` : ''}</span>
                </button>
              </li>
            ))}
            {isLoading && <li className="px-4 py-3 text-xs"><LoadingLine text={t('common.loading')} /></li>}
            {!isLoading && versions.length === 0 && <li className="px-4 py-3 text-xs text-fg-faint">{t('page.versions.empty')}</li>}
          </ul>

          <div className="flex-1 min-w-0 flex flex-col">
            {current ? (
              <>
                <div className="flex items-center gap-1 px-4 pt-3 flex-shrink-0">
                  {(['changes', 'preview'] as const).map((k) => (
                    <button key={k} onClick={() => setView(k)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg ${view === k ? 'bg-raised text-fg' : 'text-fg-muted hover:text-fg'}`}>
                      {k === 'changes' ? t('page.versions.changes') : t('page.versions.preview')}
                    </button>
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3">
                  {current.title !== page.title && <p className="text-xs text-fg-muted mb-2">{t('page.versions.titleWas', { title: current.title })}</p>}
                  {view === 'changes'
                    ? <Changes from={current.content} to={page.content ?? ''} fromLabel={`${exactTime(current.saved_at)} · ${authorOf(current, t)}`} toLabel={t('page.versions.current')} />
                    : <DescriptionEditor key={current.id} value={current.content} onChange={() => {}} ticketId={page.id} readOnly minHeight="120px" />}
                </div>
                {canWrite && (
                  <div className="flex items-center gap-3 px-4 py-3 border-t border-line-soft flex-shrink-0">
                    <button onClick={() => void doRestore()} disabled={restore.isPending}
                      className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">
                      {t('page.versions.restore')}
                    </button>
                    <span className="text-xs text-fg-faint">{t('page.versions.restoreHint')}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3">
                <DescriptionEditor key={`cur-${page.updated_at}`} value={page.content ?? ''} onChange={() => {}} ticketId={page.id} readOnly minHeight="120px" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type Translate = ReturnType<typeof useT>
const authorOf = (v: PageVersion, t: Translate) => v.author?.full_name || v.author?.email || v.author_name || t('page.versions.unknownAuthor')
const authorOfPage = (p: Page, t: Translate) => p.updater?.full_name || p.updater?.email || p.creator?.full_name || t('page.versions.unknownAuthor')

/** Lines that differ only in spacing (or a non-breaking space) are the same line. */
const normLine = (l: string) => l.replace(/[\s ]+/g, ' ').trim()

type DiffRow =
  | { kind: 'same' | 'change' | 'del' | 'add'; left: string | null; right: string | null; l: number | null; r: number | null }
  | { kind: 'fold'; rows: DiffRow[] }

/** Unchanged lines kept around each change; longer unchanged runs fold. */
const CONTEXT = 3

function buildRows(from: string, to: string): DiffRow[] {
  // Diff the lines with spacing normalised, then show the original lines.
  const A = from.split('\n'), B = to.split('\n')
  const parts = diffArrays(A.map(normLine), B.map(normLine))
  const rows: DiffRow[] = []
  let a = 0, b = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const n = p.count ?? p.value.length
    if (!p.added && !p.removed) {
      for (let k = 0; k < n; k++, a++, b++) rows.push({ kind: 'same', left: A[a], right: B[b], l: a + 1, r: b + 1 })
      continue
    }
    // A removal followed by an addition is an edit: pair the lines so each
    // pair can show which words changed.
    const del = p.removed ? n : 0
    const nextAdd = !p.added && parts[i + 1]?.added ? parts[++i] : null
    const add = p.added ? n : nextAdd ? (nextAdd.count ?? nextAdd.value.length) : 0
    for (let k = 0; k < Math.max(del, add); k++) {
      const left = k < del ? A[a + k] : null, right = k < add ? B[b + k] : null
      rows.push({ kind: left !== null && right !== null ? 'change' : left !== null ? 'del' : 'add', left, right, l: left !== null ? a + k + 1 : null, r: right !== null ? b + k + 1 : null })
    }
    a += del; b += add
  }
  // Fold long runs of unchanged lines, keeping CONTEXT lines next to each change.
  const out: DiffRow[] = []
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind !== 'same') { out.push(rows[i++]); continue }
    let j = i
    while (j < rows.length && rows[j].kind === 'same') j++
    const run = rows.slice(i, j)
    const keepHead = i === 0 ? 0 : CONTEXT, keepTail = j === rows.length ? 0 : CONTEXT
    if (run.length > keepHead + keepTail + 1) {
      out.push(...run.slice(0, keepHead), { kind: 'fold', rows: run.slice(keepHead, run.length - keepTail) }, ...run.slice(run.length - keepTail))
    } else out.push(...run)
    i = j
  }
  return out
}

/** One side of an edited line: the words that changed are marked, the rest stays plain. */
function WordDiff({ left, right, side }: { left: string; right: string; side: 'left' | 'right' }) {
  const parts = useMemo(() => diffWordsWithSpace(left, right), [left, right])
  return (
    <>
      {parts.map((p, i) => {
        if (side === 'left' && p.added) return null
        if (side === 'right' && p.removed) return null
        const mark = side === 'left' ? p.removed : p.added
        return <span key={i} className={mark ? (side === 'left' ? 'bg-danger/25 rounded-md line-through decoration-danger/60' : 'bg-success/25 rounded-md') : ''}>{p.value}</span>
      })}
    </>
  )
}

/**
 * Side by side: this version on the left, the page as it is now on the right.
 * An edited line shows only its changed words highlighted (#684A9085: one word
 * swapped in a sentence must not look like the whole sentence changed).
 */
function Changes({ from, to, fromLabel, toLabel }: { from: string; to: string; fromLabel: string; toLabel: string }) {
  const t = useT()
  const rows = useMemo(() => buildRows(from, to), [from, to])
  const [open, setOpen] = useState<Set<number>>(new Set())
  if (!rows.some((row) => row.kind !== 'same' && row.kind !== 'fold')) return <p className="text-sm text-fg-muted">{t('page.versions.noChanges')}</p>
  const num = 'select-none w-8 flex-shrink-0 text-right pr-2 text-fg-faint tabular-nums'
  const cell = (kind: string, side: 'left' | 'right') =>
    kind === 'same' ? 'text-fg-muted'
      : side === 'left' ? (kind === 'add' ? 'bg-raised/60' : 'bg-danger/5 text-fg')
      : (kind === 'del' ? 'bg-raised/60' : 'bg-success/5 text-fg')
  const render = (row: DiffRow, key: string): React.ReactNode => {
    if (row.kind === 'fold') {
      const id = Number(key)
      if (open.has(id)) return row.rows.map((r, k) => render(r, `${key}.${k}`))
      return (
        <button key={key} type="button" onClick={() => setOpen((s) => new Set(s).add(id))}
          className="col-span-2 w-full text-center py-1 text-xs text-fg-faint bg-raised/50 hover:bg-raised hover:text-fg-2 border-y border-line-soft">
          {t('page.versions.unchangedLines', { n: row.rows.length })}
        </button>
      )
    }
    return [
      <div key={`${key}L`} className={`flex min-w-0 border-r border-line-soft ${cell(row.kind, 'left')}`}>
        <span aria-hidden className={num}>{row.l ?? ''}</span>
        <span className="flex-1 min-w-0 pr-2 whitespace-pre-wrap break-words">{row.kind === 'change' ? <WordDiff left={row.left!} right={row.right!} side="left" /> : (row.left ?? '') || ' '}</span>
      </div>,
      <div key={`${key}R`} className={`flex min-w-0 ${cell(row.kind, 'right')}`}>
        <span aria-hidden className={num}>{row.r ?? ''}</span>
        <span className="flex-1 min-w-0 pr-2 whitespace-pre-wrap break-words">{row.kind === 'change' ? <WordDiff left={row.left!} right={row.right!} side="right" /> : (row.right ?? '') || ' '}</span>
      </div>,
    ]
  }
  return (
    <div className="rounded-lg border border-line-soft overflow-hidden text-xs leading-relaxed font-mono">
      <div className="grid grid-cols-2 bg-raised text-xs font-sans font-semibold text-fg-2 border-b border-line-soft">
        <span className="px-3 py-1.5 border-r border-line-soft truncate">{fromLabel}</span>
        <span className="px-3 py-1.5 truncate">{toLabel}</span>
      </div>
      <div className="grid grid-cols-2">{rows.map((row, i) => render(row, String(i)))}</div>
    </div>
  )
}
