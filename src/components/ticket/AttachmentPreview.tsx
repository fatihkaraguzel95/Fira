import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { displayUrl } from '../../lib/storage'
import { createPortal } from 'react-dom'
import type { TicketAttachment } from '../../types'
import { markHandled } from '../../lib/keys'
import { isImageUrl, fileExtension, downloadFile, copyText, formatFileDate } from '../../lib/files'
import { fileKind } from '../../lib/thumbs'
import { PdfPages, TextPreview } from '../ui/FilePreview'
import { useT } from '../../i18n'
import { useFileText } from '../../hooks/usePassive'

interface Props {
  items: TicketAttachment[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  canDelete: (att: TicketAttachment) => boolean
  onDelete: (att: TicketAttachment) => void
}

const ZOOM_MIN = 0.1
const ZOOM_MAX = 8
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
/** The "text in the picture" panel stays as it was left while the app is open (not a saved preference). */
let textPanelOpen = false

/** Full-screen attachment viewer (ClickUp-like): zoom, fit, download, open, copy link, delete, ←/→. */
export function AttachmentPreview({ items, index, onIndexChange, onClose, canDelete, onDelete }: Props) {
  const t = useT()
  const att = items[index]
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  /** The picture's own size, so zoom is a real factor of it (1 = actual pixels). */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fitImgRef = useRef<HTMLImageElement>(null)
  const zoomImgRef = useRef<HTMLImageElement>(null)
  /** The point of the picture under the cursor at the last zoom step, as fractions, plus where it must stay in the box. */
  const anchorRef = useRef<{ fx: number; fy: number; ax: number; ay: number } | null>(null)
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)
  /** A pan just ended: the click that follows the pointer-up must not close the viewer. */
  const panned = useRef(false)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  /** Files whose rich preview failed to draw: they fall back to the download panel. */
  const [failed, setFailed] = useState<Set<string>>(new Set())
  /** What was read from the picture (110): there when its team turned the job on and a runner got to it. */
  const { data: read } = useFileText(att && isImageUrl(att.file_url) ? att.file_url : null)
  const hasRead = !!read && !!(read.text?.trim() || read.description?.trim())
  const [textOpen, setTextOpen] = useState(textPanelOpen)
  const [textCopied, setTextCopied] = useState(false)
  const toggleText = () => { textPanelOpen = !textOpen; setTextOpen(!textOpen) }

  // Reset per file
  useEffect(() => { setZoom(1); setFit(true); setConfirming(false); setNatural(null) }, [att?.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        markHandled(e); e.preventDefault(); e.stopPropagation()
        if (confirming) setConfirming(false); else onClose()
      } else if (e.key === 'ArrowRight' && index < items.length - 1) { markHandled(e); onIndexChange(index + 1) }
      else if (e.key === 'ArrowLeft' && index > 0) { markHandled(e); onIndexChange(index - 1) }
      else if ((e.key === '+' || e.key === '=') ) { zoomBy(1) }
      else if (e.key === '-') { zoomBy(-1) }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  })

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  if (!att) return null
  const image = isImageUrl(att.file_url)
  // Videos play, PDFs show their pages, text files their text (#FB541A31); if
  // drawing fails, the download panel below is still there.
  const kind = fileKind(att.file_name, att.file_url)
  const rich = !failed.has(att.id) && (kind === 'video' || kind === 'pdf' || kind === 'text')

  /** The zoom the "fit" view is showing right now — where a wheel or a button starts from. */
  const fitZoom = () => {
    const img = fitImgRef.current
    return img && natural ? img.getBoundingClientRect().width / natural.w : 1
  }
  /**
   * Smooth zoom (#661C0929): a continuous factor rather than fixed steps, kept
   * around a point of the picture. The picture is laid out at its zoomed size
   * (not transformed), so the scroll box grows on every side and the scroll
   * position can keep the chosen point still.
   */
  const zoomTo = (next: number, anchor?: { x: number; y: number }) => {
    const box = scrollRef.current
    const img = fit ? fitImgRef.current : zoomImgRef.current
    const z = clampZoom(next)
    if (box && img) {
      // Remember which point of the PICTURE is under the cursor and where it sits
      // in the box; the layout effect below puts it back there once the picture
      // has its new size — same frame, no intermediate paint (kırpışma, 2. tur).
      const r = img.getBoundingClientRect(), b = box.getBoundingClientRect()
      const x = anchor ? anchor.x : b.left + b.width / 2
      const y = anchor ? anchor.y : b.top + b.height / 2
      anchorRef.current = { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, ax: x - b.left, ay: y - b.top }
    }
    if (fit) setFit(false)
    setZoom(z)
  }
  useLayoutEffect(() => {
    const a = anchorRef.current, box = scrollRef.current, img = zoomImgRef.current
    if (!a || !box || !img || fit) return
    anchorRef.current = null
    // offsetLeft/Top are relative to the scroll box (it is positioned), so the
    // centring padding of the wrapper is already included.
    box.scrollLeft = img.offsetLeft + a.fx * img.offsetWidth - a.ax
    box.scrollTop = img.offsetTop + a.fy * img.offsetHeight - a.ay
  }, [zoom, fit])
  const zoomBy = (dir: 1 | -1) => zoomTo((fit ? fitZoom() : zoom) * (dir > 0 ? 1.25 : 0.8))
  /**
   * Wheel = zoom, never scroll (#661C0929 follow-up): React registers `wheel`
   * passively, so `preventDefault` there did nothing and the box scrolled while
   * the picture grew — a visible stutter. A native, non-passive listener stops
   * the scroll. Touchpad pinch arrives as a wheel event with `ctrlKey` and small
   * deltas, so it gets its own, steeper curve.
   */
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelRef.current = (e: WheelEvent) => {
    if (!image) return
    e.preventDefault()
    const pinch = e.ctrlKey || e.metaKey
    const step = e.deltaMode === 1 ? 0.05 : pinch ? 0.01 : 0.0018
    const factor = Math.exp(-e.deltaY * step)
    zoomTo((fit ? fitZoom() : zoom) * factor, { x: e.clientX, y: e.clientY })
  }
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    const h = (e: WheelEvent) => wheelRef.current(e)
    box.addEventListener('wheel', h, { passive: false })
    return () => box.removeEventListener('wheel', h)
  }, [att?.id, image])

  // Touch: one finger pans, two fingers pinch (distance ratio → zoom around the midpoint).
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]
        pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: fit ? fitZoom() : zoom }
        drag.current = null
        return
      }
    }
    if (fit || e.button !== 0 || !scrollRef.current) return
    drag.current = { x: e.clientX, y: e.clientY, sl: scrollRef.current.scrollLeft, st: scrollRef.current.scrollTop }
    if (e.pointerType !== 'touch') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2 && pinchStart.current) {
        const [a, b] = [...touches.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        if (dist > 0) zoomTo(pinchStart.current.zoom * (dist / pinchStart.current.dist), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
        panned.current = true
        return
      }
    }
    const d = drag.current, box = scrollRef.current
    if (!d || !box) return
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) panned.current = true
    box.scrollLeft = d.sl - (e.clientX - d.x)
    box.scrollTop = d.st - (e.clientY - d.y)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinchStart.current = null
    drag.current = null
  }
  const closeIfBackdrop = (e: React.MouseEvent) => {
    if (panned.current) { panned.current = false; return }
    // The second click of a double-click lands on the backdrop once the picture shrank to fit.
    if (e.detail > 1) return
    if (e.target === e.currentTarget) onClose()
  }

  const copyLink = async () => {
    await copyText(att.file_url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const iconBtn = 'p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={att.file_name}
      // Above a full-screen editor (9000): the viewer also opens from a text (#0E2B2AB8).
      className="fixed inset-0 z-[9999] bg-black/90 flex flex-col animate-fade-in select-none"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Header */}
      <div data-wco-bar className="flex items-center gap-3 px-4 h-14 flex-shrink-0 bg-black/40 text-white">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate" title={att.file_name}>{att.file_name}</p>
          <p className="text-xs text-white/60 truncate">
            {/* A file shown in a text but not in Files has no record: no uploader/date. */}
            {att.created_at ? <>{att.uploader?.full_name || att.uploader?.email || '—'} · {formatFileDate(att.created_at)}</> : null}
            {items.length > 1 && <>{att.created_at ? ' · ' : ''}{index + 1}/{items.length}</>}
          </p>
        </div>

        {image && (
          <div className="hidden sm:flex items-center gap-1 bg-white/10 rounded-lg p-1">
            <button className={`${iconBtn} ${fit ? 'bg-white/15 text-white' : ''}`} onClick={() => { setFit(true); setZoom(1) }} title={t('ticketExtra.preview.fit')}>
              <Icon name="maximize" />
            </button>
            <button className={iconBtn} onClick={() => zoomBy(-1)} title={t('ticketExtra.preview.zoomOut')}>
              <Icon name="minus" />
            </button>
            <button className="px-2 text-xs tabular-nums w-14 text-center text-white/90" onClick={() => { setFit(false); setZoom(1) }} title={t('ticketExtra.preview.actualSize')}>
              {fit ? t('ticketExtra.preview.fit') : `${Math.round(zoom * 100)}%`}
            </button>
            <button className={iconBtn} onClick={() => zoomBy(1)} title={t('ticketExtra.preview.zoomIn')}>
              <Icon name="plus" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-0.5">
          {hasRead && (
            <button className={`${iconBtn} flex items-center gap-1.5 text-sm ${textOpen ? 'bg-white/15 text-white' : ''}`} onClick={toggleText} aria-pressed={textOpen} title={t('ticketExtra.imageText.title')} data-image-text-toggle>
              <Icon name="type" />
              <span className="hidden sm:inline">{t('ticketExtra.imageText.toggle')}</span>
            </button>
          )}
          <button className={`${iconBtn} flex items-center gap-1.5 text-sm`} onClick={() => downloadFile(att.file_url, att.file_name)} title={t('common.download')}>
            <Icon name="download" />
            <span className="hidden sm:inline">{t('common.download')}</span>
          </button>
          <a className={iconBtn} href={att.file_url} target="_blank" rel="noopener noreferrer" title={t('ticketExtra.openInNewTab')}>
            <Icon name="open" />
          </a>
          <button className={`${iconBtn} relative`} onClick={copyLink} title={t('ticketExtra.copyLink')}>
            <Icon name="link" />
            {copied && <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-2xs bg-white text-black px-1.5 py-0.5 rounded-md whitespace-nowrap">{t('common.copied')}</span>}
          </button>
          {canDelete(att) && (
            confirming ? (
              <span className="flex items-center gap-1 ml-1 text-xs">
                <button className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold" onClick={() => { onDelete(att); setConfirming(false) }}>{t('ticketExtra.confirmDelete')}</button>
                <button className="px-2 py-1.5 rounded-lg text-white/80 hover:bg-white/10" onClick={() => setConfirming(false)}>{t('common.giveUp')}</button>
              </span>
            ) : (
              <button className={`${iconBtn} hover:text-red-300`} onClick={() => setConfirming(true)} title={t('common.delete')}>
                <Icon name="trash" />
              </button>
            )
          )}
          <button className={`${iconBtn} ml-2`} onClick={onClose} title={t('ticketExtra.closeEsc')} aria-label={t('common.close')}>
            <Icon name="close" size={20} />
          </button>
        </div>
      </div>

      {/* Body, and beside it what was read from the picture */}
      <div className="flex-1 min-h-0 flex relative">
      <div
        ref={scrollRef}
        className={`flex-1 min-w-0 min-h-0 relative ${fit ? 'flex items-center justify-center p-6' : 'overflow-auto'}`}
        onClick={closeIfBackdrop}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => { if (image) { e.preventDefault(); if (fit) zoomTo(Math.max(1, fitZoom() * 2), { x: e.clientX, y: e.clientY }); else { setFit(true); setZoom(1) } } }}
        style={!fit && image ? { cursor: drag.current ? 'grabbing' : 'move', touchAction: 'none' } : image ? { touchAction: 'none' } : undefined}
      >
        {image ? (
          fit ? (
            <img ref={fitImgRef} src={displayUrl(att.file_url)} alt={att.file_name} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="max-w-full max-h-full object-contain rounded-md shadow-2xl select-none" draggable={false} />
          ) : (
            <div className="min-w-full min-h-full w-max flex items-center justify-center p-6" onClick={closeIfBackdrop}>
              <img
                ref={zoomImgRef}
                src={displayUrl(att.file_url)}
                alt={att.file_name}
                onLoad={(e) => { if (!natural) setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }) }}
                style={natural ? { width: natural.w * zoom, maxWidth: 'none', height: 'auto' } : undefined}
                className="rounded-md shadow-2xl flex-shrink-0 select-none"
                draggable={false}
              />
            </div>
          )
        ) : rich && kind === 'video' ? (
          <video key={att.id} src={displayUrl(att.file_url)} controls autoPlay playsInline className="max-w-full max-h-full rounded-md shadow-2xl bg-black" onClick={(e) => e.stopPropagation()} />
        ) : rich && kind === 'pdf' ? (
          <PdfPages key={att.id} url={att.file_url} onFail={() => setFailed((f) => new Set(f).add(att.id))} />
        ) : rich && kind === 'text' ? (
          <TextPreview key={att.id} url={att.file_url} onFail={() => setFailed((f) => new Set(f).add(att.id))} />
        ) : (
          <div className="flex flex-col items-center gap-4 text-white">
            <div className="w-24 h-28 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
              <span className="text-lg font-bold tracking-wide">{fileExtension(att.file_name) || t('ticketExtra.attachment.fileTypeFallback')}</span>
            </div>
            <p className="text-sm text-white/70">{t('ticketExtra.preview.noPreview')}</p>
            <button
              onClick={() => downloadFile(att.file_url, att.file_name)}
              className="px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-white/90"
            >
              {t('common.download')}
            </button>
          </div>
        )}

        {/* Prev / next */}
        {index > 0 && (
          <button onClick={() => onIndexChange(index - 1)} aria-label={t('ticketExtra.prev')} className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-black/50 text-white hover:bg-black/70">
            <Icon name="chevronLeft" size={20} />
          </button>
        )}
        {index < items.length - 1 && (
          <button onClick={() => onIndexChange(index + 1)} aria-label={t('ticketExtra.next')} className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-black/50 text-white hover:bg-black/70">
            <Icon name="chevronRight" size={20} />
          </button>
        )}
      </div>
      {hasRead && textOpen && read && (
        <aside
          aria-label={t('ticketExtra.imageText.title')}
          data-image-text
          className="w-80 flex-shrink-0 bg-surface text-fg border-l border-line overflow-y-auto select-text max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:w-auto max-sm:max-h-[55%] max-sm:border-l-0 max-sm:border-t max-sm:rounded-t-xl max-sm:shadow-2xl"
        >
          <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-fg">{t('ticketExtra.imageText.title')}</h2>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted"><Icon name="sparkle" className="flex-shrink-0" />{t('ticketExtra.imageText.byAi')}</p>
            </div>
            <button type="button" onClick={toggleText} aria-label={t('common.close')} className="tap relative p-1 rounded-lg text-fg-muted hover:bg-raised hover:text-fg flex-shrink-0">
              <Icon name="close" />
            </button>
          </div>
          {read.description?.trim() && (
            <div className="px-4 py-2 border-t border-line-soft">
              <p className="text-xs font-semibold text-fg-muted mb-1">{t('ticketExtra.imageText.shows')}</p>
              <p className="text-sm text-fg-2 leading-relaxed">{read.description}</p>
            </div>
          )}
          <div className="px-4 py-2 border-t border-line-soft">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-xs font-semibold text-fg-muted">{t('ticketExtra.imageText.text')}</p>
              {read.text?.trim() && (
                <button
                  type="button"
                  onClick={() => { void copyText(read.text ?? '').then(() => { setTextCopied(true); window.setTimeout(() => setTextCopied(false), 1500) }) }}
                  className="text-xs px-2 py-1 rounded-lg border border-line text-fg-2 hover:bg-raised"
                >
                  {t(textCopied ? 'common.copied' : 'common.copy')}
                </button>
              )}
            </div>
            {read.text?.trim()
              ? <p className="text-sm text-fg whitespace-pre-wrap break-words leading-relaxed" lang={read.lang ?? undefined}>{read.text}</p>
              : <p className="text-sm text-fg-faint">{t('ticketExtra.imageText.none')}</p>}
          </div>
        </aside>
      )}
      </div>
    </div>,
    document.body,
  )
}
