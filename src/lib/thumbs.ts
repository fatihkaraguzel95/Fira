/**
 * Previews for files that are not images (#FB541A31): the first page of a PDF,
 * the first frame of a video (the <video> element does that itself), the first
 * lines of a text file, and an icon by type for the rest.
 *
 * PDF pages are drawn in the browser with pdf.js, loaded only when a PDF is on
 * screen. Rendered thumbnails are kept for the session (by URL + width).
 */
import { VIDEO_URL_RE } from './uploads'

export type FileKind = 'image' | 'video' | 'pdf' | 'text' | 'doc' | 'sheet' | 'slides' | 'archive' | 'audio' | 'other'

const EXT_KIND: Record<string, FileKind> = {
  pdf: 'pdf',
  txt: 'text', csv: 'text', tsv: 'text', md: 'text', json: 'text', xml: 'text', log: 'text', sql: 'text', yml: 'text', yaml: 'text', ini: 'text', abap: 'text', js: 'text', ts: 'text', html: 'text', css: 'text',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio',
}

export function fileKind(name: string, url = ''): FileKind {
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?|$)/i.test(url || name)) return 'image'
  if (VIDEO_URL_RE.test(url) || VIDEO_URL_RE.test(name)) return 'video'
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase() ?? ''
  return EXT_KIND[ext] ?? 'other'
}

// ── PDF ──────────────────────────────────────────────────────────────────────
type PdfJs = typeof import('pdfjs-dist')
let pdfjs: Promise<PdfJs> | null = null
function loadPdfJs(): Promise<PdfJs> {
  // The worker is bundled by Vite (`?worker` → a .js file). Pointing pdf.js at
  // the package's .mjs instead fails in production: nginx serves .mjs as
  // application/octet-stream and `nosniff` makes the browser refuse it.
  pdfjs ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?worker')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerPort = new (worker as { default: new () => Worker }).default()
    return lib
  })
  return pdfjs
}

/** Opens a PDF (no eval: the page's CSP forbids it). The caller destroys it. */
export async function openPdf(url: string) {
  const lib = await loadPdfJs()
  return lib.getDocument({ url, isEvalSupported: false }).promise
}

/** Draws one page into a canvas `width` CSS pixels wide (sharp on high-DPI screens). */
export async function renderPdfPage(doc: Awaited<ReturnType<typeof openPdf>>, pageNo: number, width: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const viewport = page.getViewport({ scale: (width / base.width) * dpr })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
  page.cleanup()
  return canvas
}

const pdfThumbs = new Map<string, Promise<string>>()
/** The first page of a PDF as an image URL, cached for the session. */
export function pdfThumb(url: string, width = 320): Promise<string> {
  const key = `${url}|${width}`
  let p = pdfThumbs.get(key)
  if (!p) {
    p = (async () => {
      const doc = await openPdf(url)
      try {
        const canvas = await renderPdfPage(doc, 1, width)
        return canvas.toDataURL('image/webp', 0.8)
      } finally { void doc.destroy() }
    })()
    p.catch(() => pdfThumbs.delete(key)) // a failed one may try again later
    pdfThumbs.set(key, p)
  }
  return p
}

// ── Text ─────────────────────────────────────────────────────────────────────
/**
 * The first `bytes` of a file. The size comes first (HEAD): Supabase storage
 * answers a range that runs past the end of the file (2 KB of an 800-byte CSV)
 * with a 206 that promises 2 KB and sends less — the browser then waits for
 * the rest until the connection times out.
 */
async function fetchStart(url: string, bytes: number): Promise<ArrayBuffer> {
  const head = await fetch(url, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length') ?? 0)
  if (!head.ok || !size) throw new Error(`HEAD ${head.status}`)
  const r = await fetch(url, { headers: { Range: `bytes=0-${Math.min(size, bytes) - 1}` } })
  if (!r.ok) throw new Error(String(r.status))
  return r.arrayBuffer()
}

const snippets = new Map<string, Promise<string>>()
/** The first ~4 KB of a text file (a Range request, so big logs are not downloaded). */
export function textSnippet(url: string, bytes = 4096): Promise<string> {
  const key = `${url}|${bytes}`
  let p = snippets.get(key)
  if (!p) {
    p = fetchStart(url, bytes)
      .then((buf) => new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, bytes)).replace(/�+$/, ''))
    p.catch(() => snippets.delete(key))
    snippets.set(key, p)
  }
  return p
}
