import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'
import { displayUrl } from '../../lib/storage'
import { fileKind, pdfThumb, textSnippet, type FileKind } from '../../lib/thumbs'
import { fileExtension } from '../../lib/files'

/** Colour and glyph per kind for files without a picture of their own. */
const KIND_STYLE: Record<Exclude<FileKind, 'image' | 'video'>, { bg: string; fg: string; icon: IconName }> = {
  pdf: { bg: 'bg-red-500/10', fg: 'text-red-600 dark:text-red-400', icon: 'file' },
  text: { bg: 'bg-slate-500/10', fg: 'text-slate-600 dark:text-slate-300', icon: 'page' },
  doc: { bg: 'bg-blue-500/10', fg: 'text-blue-600 dark:text-blue-400', icon: 'page' },
  sheet: { bg: 'bg-emerald-500/10', fg: 'text-emerald-600 dark:text-emerald-400', icon: 'table' },
  slides: { bg: 'bg-orange-500/10', fg: 'text-orange-600 dark:text-orange-400', icon: 'whiteboard' },
  archive: { bg: 'bg-amber-500/10', fg: 'text-amber-700 dark:text-amber-400', icon: 'archive' },
  audio: { bg: 'bg-violet-500/10', fg: 'text-violet-600 dark:text-violet-400', icon: 'audio' },
  other: { bg: 'bg-raised', fg: 'text-fg-muted', icon: 'file' },
}

/** Render only once the tile is (nearly) on screen: a ticket with forty PDFs must not open forty. */
function useVisible<T extends Element>() {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  return [ref, visible] as const
}

/**
 * A file's thumbnail (#FB541A31): the image itself, a video's first frame, a
 * PDF's first page, a text file's first lines — or a type icon with the
 * extension. `compact` = the 40 px list-row size (no text lines there).
 */
export function FileThumb({ url, name, className, compact = false, fallbackLabel }: { url: string; name: string; className: string; compact?: boolean; fallbackLabel: string }) {
  const kind = fileKind(name, url)
  const [ref, visible] = useVisible<HTMLDivElement>()
  const [pdf, setPdf] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!visible) return
    let alive = true
    if (kind === 'pdf') pdfThumb(url, compact ? 80 : 320).then((d) => alive && setPdf(d), () => alive && setFailed(true))
    if (kind === 'text' && !compact) textSnippet(url, 2048).then((s) => alive && setText(s), () => alive && setFailed(true))
    return () => { alive = false }
  }, [visible, kind, url, compact])

  if (kind === 'image') {
    // Contain (not cover): the whole image, letterboxed against the tile.
    return <img src={displayUrl(url)} alt={name} className={`${className} object-contain`} loading="lazy" draggable={false} />
  }
  if (kind === 'video') {
    return (
      <div className={`${className} relative bg-black`}>
        {/* #t=0.5: the browser shows that frame; nothing plays in the grid. */}
        <video src={`${displayUrl(url)}#t=0.5`} preload="metadata" muted playsInline className="w-full h-full object-contain pointer-events-none" aria-label={name} />
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className={`${compact ? 'w-5 h-5' : 'w-9 h-9'} rounded-full bg-black/55 text-white flex items-center justify-center`}>
            <svg className={compact ? 'w-2.5 h-2.5' : 'w-4 h-4'} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
      </div>
    )
  }
  if (kind === 'pdf' && pdf && !failed) {
    return (
      <div ref={ref} className={`${className} relative bg-white`}>
        <img src={pdf} alt={name} className="w-full h-full object-cover object-top" draggable={false} />
        {!compact && <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-red-600 text-white text-2xs font-bold tracking-wide">PDF</span>}
      </div>
    )
  }
  if (kind === 'text' && text && !failed) {
    return (
      <div ref={ref} className={`${className} relative bg-surface overflow-hidden`}>
        <pre className="p-2 text-2xs leading-[1.35] font-mono text-fg-2 whitespace-pre-wrap break-all">{text}</pre>
        <span className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent" aria-hidden />
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-slate-600 text-white text-2xs font-bold tracking-wide">{fileExtension(name) || 'TXT'}</span>
      </div>
    )
  }
  const s = KIND_STYLE[kind]
  return (
    <div ref={ref} className={`${className} flex flex-col items-center justify-center gap-1 ${s.bg}`}>
      <Icon name={s.icon} size={compact ? 20 : 36} className={s.fg} />
      {!compact && <span className={`text-2xs font-bold tracking-wide ${s.fg}`}>{fileExtension(name) || fallbackLabel}</span>}
    </div>
  )
}
