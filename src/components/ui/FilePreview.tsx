import { useEffect, useRef, useState } from 'react'
import { openPdf, renderPdfPage, textSnippet } from '../../lib/thumbs'
import { useT } from '../../i18n'

/** Pages drawn at most (a 300-page manual should not freeze the tab; the rest is a download away). */
const MAX_PAGES = 50

/**
 * A PDF in the preview window, page by page (pdf.js; the CSP forbids frames,
 * so the browser's own viewer is not an option). Pages are drawn one after
 * another as the reader scrolls towards them.
 */
export function PdfPages({ url, onFail }: { url: string; onFail: () => void }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<{ shown: number; total: number } | null>(null)

  useEffect(() => {
    let alive = true
    let doc: Awaited<ReturnType<typeof openPdf>> | null = null
    const host = box.current
    if (!host) return
    ;(async () => {
      try {
        doc = await openPdf(url)
        const total = doc.numPages
        const width = Math.min(900, host.clientWidth - 48)
        const upto = Math.min(total, MAX_PAGES)
        for (let n = 1; n <= upto && alive; n++) {
          const canvas = await renderPdfPage(doc, n, width)
          if (!alive) return
          canvas.style.width = `${width}px`
          canvas.className = 'block mx-auto mb-4 bg-white shadow-2xl rounded-md'
          canvas.setAttribute('aria-label', t('ticketExtra.preview.pdfPage', { n, total }))
          host.appendChild(canvas)
          setPages({ shown: n, total })
          // Let the first pages paint before drawing the rest.
          await new Promise((r) => setTimeout(r, n < 3 ? 0 : 30))
        }
      } catch { if (alive) onFail() }
    })()
    return () => { alive = false; void doc?.destroy(); if (host) host.innerHTML = '' }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-0 overflow-auto py-6" onClick={(e) => e.stopPropagation()}>
      <div ref={box} />
      {pages ? (
        pages.total > MAX_PAGES && pages.shown === MAX_PAGES && (
          <p className="text-center text-xs text-white/70 pb-4">{t('ticketExtra.preview.pdfMore', { n: MAX_PAGES, total: pages.total })}</p>
        )
      ) : (
        <p className="text-center text-sm text-white/70">{t('common.loading')}</p>
      )}
    </div>
  )
}

/** A text file in the preview window (first 256 KB). */
export function TextPreview({ url, onFail }: { url: string; onFail: () => void }) {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    textSnippet(url, 256 * 1024).then((s) => alive && setText(s), () => alive && onFail())
    return () => { alive = false }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="absolute inset-0 overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
      {text === null
        ? <p className="text-center text-sm text-white/70">{t('common.loading')}</p>
        : <pre className="max-w-4xl mx-auto p-5 rounded-lg bg-surface text-fg text-xs leading-relaxed font-mono whitespace-pre-wrap break-words shadow-2xl">{text}</pre>}
    </div>
  )
}
