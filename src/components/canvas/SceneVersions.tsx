import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import type { CanvasKind, Page } from '../../types'
import { useSceneVersions, useRestoreSceneVersion, type SceneVersion } from '../../hooks/useCanvas'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { displayTime, exactTime, useDateFormat } from '../../lib/time'
import { emitError } from '../../lib/errorToast'
import { useT } from '../../i18n'

/**
 * Past states of a canvas (096): a copy every half hour while it is being
 * edited, and before an import or a restore. Picking one shows it; restoring
 * keeps the current state as a version first (server-side), so nothing is lost.
 */
export function SceneVersions({ page, kind, canWrite, onClose, onRestored }: {
  page: Page; kind: CanvasKind; canWrite: boolean; onClose: () => void; onRestored: () => void
}) {
  const t = useT()
  useDateFormat()
  const { data: versions = [], isLoading } = useSceneVersions(page.id)
  const restore = useRestoreSceneVersion()
  const [picked, setPicked] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  const current = versions.find((v) => v.id === picked) ?? versions[0] ?? null
  useEffect(() => { if (!picked && versions[0]) setPicked(versions[0].id) }, [versions, picked])

  const doRestore = async (v: SceneVersion) => {
    try {
      await restore.mutateAsync({ versionId: v.id, pageId: page.id })
      onRestored()
      onClose()
    } catch (e) { emitError(e) }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('canvas.versions.title')} tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        className="w-full max-w-4xl h-[min(640px,90vh)] bg-surface rounded-xl shadow-2xl flex flex-col overflow-hidden focus:outline-none">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line-soft">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-fg">{t('canvas.versions.title')}</h2>
            <p className="text-xs text-fg-muted mt-0.5">{t('canvas.versions.hint')}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg hover:bg-raised">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          <ul className="sm:w-64 flex-shrink-0 overflow-y-auto border-b sm:border-b-0 sm:border-r border-line-soft max-h-48 sm:max-h-none">
            {isLoading && <li className="px-4 py-3 text-xs text-fg-faint">…</li>}
            {!isLoading && versions.length === 0 && <li className="px-4 py-3 text-xs text-fg-faint">{t('canvas.versions.empty')}</li>}
            {versions.map((v) => {
              const active = current?.id === v.id
              return (
                <li key={v.id}>
                  <button onClick={() => setPicked(v.id)} aria-current={active ? 'true' : undefined}
                    className={`w-full text-left px-4 py-2.5 border-l-2 transition-colors ${active ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-950/30' : 'border-transparent hover:bg-raised'}`}>
                    <p className="text-xs font-medium text-fg" title={exactTime(v.saved_at)}>{displayTime(v.saved_at)}</p>
                    <p className="text-xs text-fg-muted truncate">{v.author?.full_name || v.author?.email || t('page.versions.unknownAuthor')}</p>
                    <p className="text-xs text-fg-faint">{t(`canvas.versions.reason.${v.reason}`)} · {t('canvas.versions.elements', { n: v.elements.length })}</p>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 bg-app m-3 rounded-lg border border-line-soft overflow-hidden flex items-center justify-center">
              {current ? <VersionPreview kind={kind} version={current} /> : null}
            </div>
            {current && canWrite && (
              <div className="flex justify-end px-3 pb-3">
                <button onClick={() => void doRestore(current)} disabled={restore.isPending}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                  {restore.isPending ? t('canvas.versions.restoring') : t('canvas.versions.restore')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A picture of the version, drawn by the same code that draws the canvas (lazy). */
function VersionPreview({ kind, version }: { kind: CanvasKind; version: SceneVersion }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const key = useMemo(() => version.id, [version.id])
  useEffect(() => {
    let cancelled = false
    setSvg(null); setFailed(false)
    const run = async () => {
      try {
        const markup = kind === 'drawing'
          ? await (await import('./drawing/preview')).drawingPreviewSvg(version.elements, version.files, version.settings)
          : await (await import('./whiteboard/preview')).whiteboardPreviewSvg(version.elements, version.settings)
        if (!cancelled) setSvg(markup)
      } catch { if (!cancelled) setFailed(true) }
    }
    void run()
    return () => { cancelled = true }
  }, [key, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return <p className="text-xs text-fg-faint">—</p>
  if (!svg) return <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-600 border-t-transparent" />
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return <img src={url} alt="" className="max-w-full max-h-full object-contain" />
}
