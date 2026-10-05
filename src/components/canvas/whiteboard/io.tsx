import type { TranslationKey } from '../../../i18n'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import JSZip from 'jszip'
import { dataUrlToBlob, fetchAsDataUrl, safeFileName, saveBlob } from '../../../lib/canvas/files'
import { fetchScene } from '../../../lib/canvas/session'
import { make, ordered, sanitize, type ImageEl, type InkEl, type LineEl, type ShapeEl, type TextEl, type WbElement, type WbSettings } from './model'
import { unionBounds, type Box } from './geometry'
import { ElementView, WbDefs } from './render'
import { parseMicrosoftWhiteboard } from './msImport'

/**
 * Getting a whiteboard out and in (#8641c207, the nice-to-have of #cf0c7678).
 *
 * Out: PNG and SVG pictures, and a `.fira-whiteboard.json` file that holds the
 * elements with their pictures inlined — self-contained, so it opens on another
 * Fira (another server) as well.
 *
 * In: that file, a Microsoft Whiteboard export (.zip — Microsoft retires its
 * Whiteboard app on 16 October 2026 and the export is the only way out), an
 * Excalidraw file, or a picture; or straight from another whiteboard in Fira.
 * Imports are added below what is on the board, as one undo step.
 */

export interface ImportBundle {
  /** In their own coordinates; placed by `placeBundle`. */
  elements: WbElement[]
  /** Pictures still to upload: placeholder `src` → bytes. */
  images: Map<string, Blob>
  /** What could not be carried over, by the name people know it by. */
  skipped: Record<string, number>
  name?: string
}

export const FILE_TYPE = 'fira-whiteboard'

// ── Export ───────────────────────────────────────────────────────────────────

/** The board (or a part of it) as a standalone SVG, pictures inlined when asked. */
export async function renderBoardSvg(items: WbElement[], settings: WbSettings, opts: { padding?: number; inline?: boolean } = {}) {
  const box: Box = unionBounds(items) ?? { x: 0, y: 0, w: 480, h: 320 }
  const pad = opts.padding ?? 32
  const vb = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
  let srcMap: Record<string, string> | undefined
  if (opts.inline) {
    srcMap = {}
    for (const el of items) {
      if (el.type !== 'image' || srcMap[el.src]) continue
      try { srcMap[el.src] = await fetchAsDataUrl(el.src) } catch { /* a missing picture stays empty */ }
    }
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() => root.render(
    <svg xmlns="http://www.w3.org/2000/svg" width={Math.ceil(vb.w)} height={Math.ceil(vb.h)} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
      <WbDefs idPrefix="wbx" />
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={settings.bg} />
      {ordered(items).map((el) => <ElementView key={el.id} el={el} idPrefix="wbx" srcMap={srcMap} />)}
    </svg>,
  ))
  const svg = host.innerHTML
  root.unmount()
  return { svg, width: vb.w, height: vb.h }
}

async function svgToPng(svg: string, w: number, h: number): Promise<Blob> {
  // Twice the resolution for sharp text, within what a canvas can hold.
  const scale = Math.max(0.1, Math.min(2, 16000 / Math.max(w, h), Math.sqrt(120e6 / Math.max(1, w * h))))
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('svg')); img.src = url })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(w * scale)
    canvas.height = Math.ceil(h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function exportBoard(kind: 'png' | 'svg' | 'file', items: WbElement[], settings: WbSettings, title: string) {
  const base = safeFileName(title, 'whiteboard')
  if (kind === 'file') {
    const images: Record<string, string> = {}
    for (const el of items) {
      if (el.type === 'image' && !images[el.src]) {
        try { images[el.src] = await fetchAsDataUrl(el.src) } catch { /* left out */ }
      }
    }
    const data = { type: FILE_TYPE, version: 1, title, exportedAt: new Date().toISOString(), settings, elements: items.filter((e) => !e.isDeleted), images }
    saveBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${base}.fira-whiteboard.json`)
    return
  }
  const { svg, width, height } = await renderBoardSvg(items, settings, { inline: true })
  if (kind === 'svg') { saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${base}.svg`); return }
  saveBlob(await svgToPng(svg, width, height), `${base}.png`)
}

// ── Import ───────────────────────────────────────────────────────────────────

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string

export async function readImportFile(file: File, t: T): Promise<ImportBundle> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip') || file.type.includes('zip')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const htmls = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith('.html'))
    if (htmls.length !== 1) throw new Error(t('wb.import.unknown'))
    const stem = htmls[0].name.replace(/\.html$/i, '')
    const comments = Object.values(zip.files).find((f) => f.name.toLowerCase() === `${stem}-comments.json`.toLowerCase())
    const html = await htmls[0].async('string')
    const json = comments ? await comments.async('string') : null
    return parseMicrosoftWhiteboard(html, json, { comment: t('wb.import.comment'), link: t('wb.import.link') })
  }
  let data: unknown
  try { data = JSON.parse(await file.text()) } catch { throw new Error(t('wb.import.unknown')) }
  const kind = (data as { type?: string })?.type
  if (kind === FILE_TYPE) return fromFiraFile(data as FiraFile)
  if (kind === 'excalidraw') return fromExcalidraw(data as ExcalidrawFile)
  throw new Error(t('wb.import.unknown'))
}

interface FiraFile { elements?: unknown[]; images?: Record<string, string>; title?: string }

function fromFiraFile(data: FiraFile): ImportBundle {
  const images = new Map<string, Blob>()
  const keyOf = new Map<string, string>()
  const elements: WbElement[] = []
  for (const raw of data.elements ?? []) {
    const el = sanitize(raw)
    if (!el || el.isDeleted) continue
    if (el.type === 'image') {
      const inline = data.images?.[el.src]
      if (inline) {
        let key = keyOf.get(el.src)
        if (!key) { key = `import:${keyOf.size}`; keyOf.set(el.src, key); images.set(key, dataUrlToBlob(inline)) }
        elements.push({ ...el, src: key })
        continue
      }
    }
    elements.push(el)
  }
  return { elements, images, skipped: {}, name: data.title }
}

/** Another whiteboard in Fira: its pictures are already in storage, so they are shared, not copied. */
export async function boardAsBundle(pageId: string): Promise<ImportBundle> {
  const scene = await fetchScene(pageId)
  const elements = (scene.elements as unknown[]).map(sanitize).filter((e): e is WbElement => !!e && !e.isDeleted)
  return { elements, images: new Map(), skipped: {} }
}

/**
 * Put imported elements on this board: fresh ids and versions, stacked on top
 * in their own order, and — when the board already has something — moved below
 * it, left edges aligned (the way a slide deck adds pages).
 */
export function placeBundle(bundle: ImportBundle, existing: Box | null, zStart: number, urls: Map<string, string>, by: string): WbElement[] {
  const items = ordered(bundle.elements)
  const box = unionBounds(items)
  if (!box) return []
  const dx = existing ? existing.x - box.x : 0
  const dy = existing ? existing.y + existing.h + 192 - box.y : 0
  const out: WbElement[] = []
  let z = zStart
  for (const el of items) {
    let next = { ...el, x: el.x + dx, y: el.y + dy, locked: undefined, by } as WbElement
    if (next.type === 'image' && bundle.images.has(next.src)) {
      const url = urls.get(next.src)
      if (!url) continue
      next = { ...next, src: url }
    }
    out.push(make({ ...next, id: undefined } as never, z++) as WbElement)
  }
  return out
}

// ── Excalidraw → whiteboard ──────────────────────────────────────────────────

interface ExElement {
  id: string; type: string; x: number; y: number; width: number; height: number; angle?: number
  strokeColor?: string; backgroundColor?: string; strokeWidth?: number; isDeleted?: boolean
  text?: string; fontSize?: number; textAlign?: string; containerId?: string | null
  points?: [number, number][]; pressures?: number[]; simulatePressure?: boolean
  startArrowhead?: string | null; endArrowhead?: string | null; fileId?: string
}
interface ExcalidrawFile { elements?: ExElement[]; files?: Record<string, { dataURL?: string; mimeType?: string }>; appState?: { viewBackgroundColor?: string } }

const exColor = (c: string | undefined, fallback: string) => (!c || c === 'transparent' ? fallback : c)

/** The shapes the two boards share. Excalidraw's hand-drawn look becomes clean lines here. */
function fromExcalidraw(data: ExcalidrawFile): ImportBundle {
  const skipped: Record<string, number> = {}
  const images = new Map<string, Blob>()
  const out: WbElement[] = []
  const live = (data.elements ?? []).filter((e) => !e.isDeleted)
  const shapeById = new Map<string, ShapeEl>()
  const skip = (what: string) => { skipped[what] = (skipped[what] ?? 0) + 1 }
  for (const e of live) {
    const angle = e.angle || undefined
    switch (e.type) {
      case 'rectangle': case 'ellipse': case 'diamond': {
        const s = make<ShapeEl>({ type: 'shape', kind: e.type === 'rectangle' ? 'rect' : e.type, x: e.x, y: e.y, w: e.width, h: e.height, angle,
          stroke: exColor(e.strokeColor, 'transparent'), fill: e.backgroundColor && e.backgroundColor !== 'transparent' ? e.backgroundColor : null, strokeWidth: Math.max(1, (e.strokeWidth ?? 2) * 1.2) }, 0)
        shapeById.set(e.id, s)
        out.push(s)
        break
      }
      case 'text': {
        const container = e.containerId ? shapeById.get(e.containerId) : undefined
        if (container) { container.text = e.text ?? ''; container.fontSize = e.fontSize ?? 20; container.textColor = e.strokeColor; break }
        out.push(make<TextEl>({ type: 'text', x: e.x, y: e.y, w: Math.max(40, e.width + 8), text: e.text ?? '', color: exColor(e.strokeColor, '#1f1f1f'), fontSize: e.fontSize ?? 20,
          align: e.textAlign === 'center' ? 'center' : e.textAlign === 'right' ? 'right' : 'left', font: 'hand', angle }, 0))
        break
      }
      case 'freedraw': {
        const pts: number[] = []
        ;(e.points ?? []).forEach(([px, py], i) => pts.push(px, py, e.pressures?.[i] ?? 0.5))
        if (!pts.length) break
        out.push(make<InkEl>({ type: 'ink', x: e.x, y: e.y, pts, color: exColor(e.strokeColor, '#1f1f1f'), size: Math.max(1.5, (e.strokeWidth ?? 2) * 2.2), pen: 'plain', pressure: !e.simulatePressure }, 0))
        break
      }
      case 'line': case 'arrow': {
        const pts = e.points ?? []
        if (pts.length < 2) break
        const [a, b] = [pts[0], pts[pts.length - 1]]
        if (pts.length > 2) skip('arrow bends')
        out.push(make<LineEl>({ type: 'line', x: e.x + a[0], y: e.y + a[1], dx: b[0] - a[0], dy: b[1] - a[1], color: exColor(e.strokeColor, '#1f1f1f'), strokeWidth: Math.max(1, (e.strokeWidth ?? 2) * 1.2),
          arrowEnd: !!e.endArrowhead || undefined, arrowStart: !!e.startArrowhead || undefined }, 0))
        break
      }
      case 'image': {
        const f = e.fileId ? data.files?.[e.fileId] : undefined
        if (!f?.dataURL) { skip('image'); break }
        const key = `import:${images.size}`
        images.set(key, dataUrlToBlob(f.dataURL))
        out.push(make<ImageEl>({ type: 'image', x: e.x, y: e.y, w: e.width, h: e.height, src: key, mime: f.mimeType, angle }, 0))
        break
      }
      default: skip(e.type)
    }
  }
  out.forEach((el, i) => { el.z = i + 1 })
  return { elements: out, images, skipped }
}
