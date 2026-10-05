import { make, type FontKind, type ImageEl, type InkEl, type LineEl, type NoteEl, type ShapeEl, type TextEl, type WbElement } from './model'
import { sniffImageType } from '../../../lib/canvas/files'
import type { ImportBundle } from './io'

/**
 * Microsoft Whiteboard export (Settings → Export → Zip): one HTML page as
 * Microsoft's web client drew the board, plus `<name>-comments.json`. The format
 * is undocumented; this reader follows what SQLBI Whiteboard (MIT) established
 * from real exports (docs/microsoft-whiteboard-import.md in that project):
 *
 * - `#canvasContent` holds one `div.anchor[data-whiteboard-type]` per object, in
 *   drawing order. An anchor is a zero-size box at `left`/`top`; its inline
 *   `transform: matrix(a, b, c, d, e, f)` scales, turns and moves the object
 *   around that point. Ink, text, notes, grids and connectors start at the point;
 *   shapes and pictures are centred on it.
 * - Ink: `svg.inkGroup` (viewBox) → `g.inkStroke` (matrix, 1/128 px) → a filled
 *   outline `path` and a centre line `polyline.inkHitTestOverlay`. The outline is
 *   kept as drawn — pressure and the highlighter's tip survive unchanged.
 * - Text is a Draft.js editor: `div[data-block]` per line, characters in
 *   `span[data-text]`.
 * - Pictures are base64 data URIs labelled text/plain; the bytes tell the type.
 */

const NOTE_COLORS: Record<string, string> = {
  paleYellowGradient: '#fee15a', softOrangeGradient: '#fccd7a', paleOrangeGradient: '#ffab7c', softRedGradient: '#f18992',
  lightPinkGradient: '#ea99c7', paleGreenGradient: '#cbe59c', softCyanGradient: '#b4e8ca', softBlueGradient: '#99c9ef',
  paleBlueGradient: '#b7c3fc', paleVioletGradient: '#dc9bff', lightGrayGradient: '#e6e6e6', grayGradient: '#c6c6c6',
}
const TEXT_PAD = 16
const NOTE_BAR = 40
const GRID_PITCH = 320, GRID_LEFT = 17, GRID_TOP = 81, GRID_NOTE_W = 304, GRID_NOTE_H = 305

type M = [number, number, number, number, number, number]
const IDENTITY: M = [1, 0, 0, 1, 0, 0]
/** P ∘ Q: apply Q, then P. */
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
]
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
const angleOf = (m: M) => Math.atan2(m[1], m[0])

export const numbers = (s: string | null | undefined): number[] => (s?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number)

function styleValue(el: Element | null | undefined, prop: string): string | null {
  const style = el?.getAttribute('style')
  if (!style) return null
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i > 0 && decl.slice(0, i).trim().toLowerCase() === prop) return decl.slice(i + 1).trim()
  }
  return null
}
const styleNum = (el: Element | null | undefined, prop: string): number | null => {
  const v = numbers(styleValue(el, prop))
  return v.length ? v[0] : null
}
function matrixOf(value: string | null): M {
  if (!value || !value.includes('matrix(')) return IDENTITY
  const n = numbers(value.slice(value.indexOf('matrix(')))
  return n.length >= 6 ? (n.slice(0, 6) as M) : IDENTITY
}

/** rgba()/#hex → hex colour and alpha; null for none/transparent. */
export function parseColor(v: string | null | undefined): { hex: string; alpha: number } | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (s === 'none' || s === 'transparent') return null
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return /^[0-9a-f]{6}$/.test(h) ? { hex: `#${h}`, alpha: 1 } : null
  }
  if (s.startsWith('rgb')) {
    const n = numbers(s)
    if (n.length < 3) return null
    const alpha = n.length >= 4 ? Math.max(0, Math.min(1, n[3])) : 1
    if (alpha === 0) return null
    const hex = '#' + n.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')
    return { hex, alpha }
  }
  return null
}

/** Draft.js text: one line per block. */
function readText(root: Element | null | undefined): string {
  if (!root) return ''
  const blocks = [...root.querySelectorAll('[data-block="true"]')]
  return blocks.map((b) => [...b.querySelectorAll('span[data-text="true"]')].map((s) => s.textContent ?? '').join('')).join('\n').replace(/\s+$/, '')
}

function fontOf(families: string | null): FontKind {
  const f = (families ?? '').toLowerCase()
  if (f.includes('print') || f.includes('ink free')) return 'hand'
  if (/serif|georgia|cambria|times/.test(f) && !f.includes('sans')) return 'serif'
  if (/mono|consolas|courier/.test(f)) return 'mono'
  return 'sans'
}

function decodeDataUri(src: string | null): Blob | null {
  if (!src?.startsWith('data:')) return null
  const at = src.indexOf(';base64,')
  if (at < 0) return null
  try {
    const bin = atob(src.slice(at + 8))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const type = sniffImageType(bytes)
    return type ? new Blob([bytes], { type }) : null
  } catch { return null }
}

interface Anchor { el: HTMLElement; type: string; m: M }

export function parseMicrosoftWhiteboard(html: string, commentsJson: string | null, words: { comment: string; link: string }): ImportBundle {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const canvas = doc.getElementById('canvasContent')
  if (!canvas) throw new Error('Microsoft Whiteboard: #canvasContent yok')
  const threads = readThreads(commentsJson)
  const out: WbElement[] = []
  const images = new Map<string, Blob>()
  const skipped: Record<string, number> = {}
  const skip = (what: string, n = 1) => { if (n > 0) skipped[what] = (skipped[what] ?? 0) + n }
  const add = (el: WbElement) => { el.z = out.length + 1; out.push(el) }

  for (const el of canvas.querySelectorAll<HTMLElement>('.anchor[data-whiteboard-type]')) {
    const left = styleNum(el, 'left') ?? 0
    const top = styleNum(el, 'top') ?? 0
    const a = mul([1, 0, 0, 1, left, top], matrixOf(styleValue(el, 'transform')))
    const anchor: Anchor = { el, type: el.getAttribute('data-whiteboard-type') ?? '', m: a }
    skip('Reactions on notes', el.querySelectorAll('button.ReactionPill').length)
    switch (anchor.type) {
      case 'InkGroup': readInk(anchor).forEach(add); break
      case 'FluidImage': case 'DocumentPage': case 'ReactionStickers': {
        const img = readImage(anchor, images)
        if (img) add(img); else skip(anchor.type)
        break
      }
      case 'Shape': { const s = readShape(anchor); if (s) add(s); else skip('Shape'); break }
      case 'Note': add(readNote(anchor.el, anchor.m, { x: 0, y: 0 })); break
      case 'GridList': readGrid(anchor).forEach(add); break
      case 'PlainText': { const tx = readPlainText(anchor); if (tx) add(tx); break }
      case 'Connector': { const c = readConnector(anchor); if (c) add(c); else skip('Connector'); break }
      case 'Hyperlink': { const l = readLink(anchor, words.link); if (l) add(l); break }
      case 'CommentThread': { const c = readComment(anchor, threads, words.comment); if (c) add(c); break }
      default: skip(anchor.type || 'unknown')
    }
  }
  const name = doc.querySelector('title')?.textContent?.trim() || undefined
  return { elements: out, images, skipped, name }
}

function readInk(a: Anchor): InkEl[] {
  const svg = a.el.querySelector('svg.inkGroup')
  if (!svg) return []
  const cls = svg.getAttribute('class') ?? ''
  const kind = /\bHighlighter\b/.test(cls) ? 'Highlighter' : /\bPenStroke\b/.test(cls) ? 'PenStroke' : 'Mixed'
  const vb = numbers(svg.getAttribute('viewBox'))
  const w = numbers(svg.getAttribute('width'))[0] ?? 0
  const h = numbers(svg.getAttribute('height'))[0] ?? 0
  const sx = vb.length >= 4 && vb[2] > 0 && w > 0 ? w / vb[2] : 1
  const sy = vb.length >= 4 && vb[3] > 0 && h > 0 ? h / vb[3] : 1
  const group: M = [sx, 0, 0, sy, -(vb[0] ?? 0) * sx, -(vb[1] ?? 0) * sy]
  // Rainbow / Galaxy fill with a picture from Microsoft's servers: take the pen kind instead.
  const patterns = new Map<string, 'rainbow' | 'galaxy'>()
  for (const pat of svg.querySelectorAll('pattern')) {
    const href = pat.querySelector('use')?.getAttribute('href') ?? pat.querySelector('use')?.getAttribute('xlink:href') ?? ''
    patterns.set(pat.id, href.toLowerCase().includes('galaxy') ? 'galaxy' : 'rainbow')
  }
  const out: InkEl[] = []
  for (const g of svg.querySelectorAll('g.inkStroke')) {
    const path = g.querySelector('path')
    const line = g.querySelector('polyline.inkHitTestOverlay')
    const d = path?.getAttribute('d')
    if (!path || !line || !d) continue
    const stroke = matrixOf(g.getAttribute('transform') ?? 'matrix(0.0078125, 0, 0, 0.0078125, 0, 0)')
    const m = mul(a.m, mul(group, stroke))
    const raw = numbers(line.getAttribute('points'))
    const centre: { x: number; y: number }[] = []
    for (let i = 0; i + 1 < raw.length; i += 2) centre.push(apply(m, raw[i], raw[i + 1]))
    if (!centre.length) continue
    const fill = path.getAttribute('fill') ?? ''
    let pen: InkEl['pen'] = 'plain'
    let color = '#1f1f1f'
    let opacity: number | undefined
    const url = /url\(\s*#?['"]?([^'")]+)/i.exec(fill)
    if (url) pen = patterns.get(url[1]) ?? 'rainbow'
    else {
      const c = parseColor(fill)
      if (!c) continue
      color = c.hex
      if (kind === 'Highlighter' || (kind === 'Mixed' && c.alpha < 1)) { pen = 'highlighter'; opacity = c.alpha < 1 ? c.alpha : 0.45 }
      else if (c.alpha < 1) opacity = c.alpha
    }
    // Width: the arcs of the outline are drawn around centre-line points with half the width as radius.
    const radii = [...d.matchAll(/A\s*([-\d.e]+)[ ,]+([-\d.e]+)/gi)].map((x) => Number(x[1])).filter((r) => r > 0).sort((p, q) => p - q)
    const unitScale = scaleOf(m)
    const size = radii.length ? radii[Math.floor(radii.length / 2)] * 2 * unitScale : 4
    const x = centre[0].x, y = centre[0].y
    const pts: number[] = []
    for (const q of centre) pts.push(Math.round((q.x - x) * 10) / 10, Math.round((q.y - y) * 10) / 10, 0.5)
    out.push(make<InkEl>({
      type: 'ink', x, y, pts, color, size: Math.max(0.5, size), pen, opacity,
      outline: { d, m: [m[0], m[1], m[2], m[3], m[4] - x, m[5] - y] },
    }, 0))
  }
  return out
}

/** Same picture, same upload: a board repeats its reaction stickers dozens of times. */
const seen = new WeakMap<Map<string, Blob>, Map<string, string>>()

function readImage(a: Anchor, images: Map<string, Blob>): ImageEl | null {
  const box = a.el.querySelector('.imageComponent')
  const img = a.el.querySelector('img')
  const w = styleNum(box, 'width') ?? 0
  const h = styleNum(box, 'height') ?? 0
  const src = img?.getAttribute('src') ?? null
  if (!src || w <= 0 || h <= 0) return null
  let byData = seen.get(images)
  if (!byData) { byData = new Map(); seen.set(images, byData) }
  let key = byData.get(src)
  let blob = key ? images.get(key) : undefined
  if (!key || !blob) {
    blob = decodeDataUri(src) ?? undefined
    if (!blob) return null
    key = `import:${images.size}`
    images.set(key, blob)
    byData.set(src, key)
  }
  const s = scaleOf(a.m)
  const c = apply(a.m, 0, 0)
  return make<ImageEl>({ type: 'image', x: c.x - (w * s) / 2, y: c.y - (h * s) / 2, w: w * s, h: h * s, src: key, mime: blob.type, angle: angleOf(a.m) || undefined }, 0)
}

function readShape(a: Anchor): ShapeEl | null {
  const svg = a.el.querySelector('svg.shape')
  const g = [...a.el.querySelectorAll('g')].find((x) => x.hasAttribute('fill'))
  const path = a.el.querySelector('svg.shape path')
  const d = path?.getAttribute('d')
  const w = numbers(svg?.getAttribute('width'))[0] ?? 0
  const h = numbers(svg?.getAttribute('height'))[0] ?? 0
  if (!svg || !g || !d || w <= 0 || h <= 0) return null
  const s = scaleOf(a.m)
  const c = apply(a.m, 0, 0)
  const sw = g.getAttribute('stroke-width') ?? '2'
  const width = (numbers(sw)[0] ?? 2) * (sw.includes('pt') ? 4 / 3 : 1)
  const turn = numbers(styleValue(a.el.querySelector('.textBoxContainer'), 'transform'))[0] ?? 0
  const core = a.el.querySelector('.textBoxCore')
  const text = readText(a.el.querySelector('.textBoxContainer') ?? a.el)
  const size = styleNum(a.el.querySelector('.shapeText'), 'font-size') ?? 20
  const weight = styleValue(core, 'font-weight')
  return make<ShapeEl>({
    type: 'shape', kind: 'path', d, vb: [-w / 2, -h / 2, w, h],
    x: c.x - (w * s) / 2, y: c.y - (h * s) / 2, w: w * s, h: h * s, angle: angleOf(a.m) || undefined,
    fill: parseColor(g.getAttribute('fill'))?.hex ?? null,
    stroke: parseColor(g.getAttribute('stroke'))?.hex ?? 'transparent',
    strokeWidth: width * s,
    text: text || undefined, fontSize: text ? size * s : undefined,
    textColor: parseColor(styleValue(core, 'color'))?.hex,
    bold: weight ? (weight === 'bold' || Number(weight) >= 600) : true,
    textAngle: turn ? (turn * Math.PI) / 180 : undefined,
  }, 0)
}

/** A sticky note: text area plus the 40 px author bar. `off` places it inside a grid. */
function readNote(root: Element, m: M, off: { x: number; y: number }): NoteEl {
  const bg = root.querySelector('.textBoxBackground')
  const colorClass = (bg?.getAttribute('class') ?? '').split(/\s+/).find((c) => c in NOTE_COLORS)
  const sticky = root.querySelector('.stickyNote')
  const w = styleNum(sticky, 'width') ?? GRID_NOTE_W
  const h = (styleNum(sticky, 'height') ?? GRID_NOTE_H - NOTE_BAR) + NOTE_BAR
  const s = scaleOf(m)
  const c = apply(m, off.x + w / 2, off.y + h / 2)
  return make<NoteEl>({ type: 'note', x: c.x - (w * s) / 2, y: c.y - (h * s) / 2, w: w * s, h: h * s, color: colorClass ? NOTE_COLORS[colorClass] : NOTE_COLORS.paleYellowGradient, text: readText(sticky ?? root), angle: angleOf(m) || undefined }, 0)
}

function readGrid(a: Anchor): WbElement[] {
  const kids = [...a.el.querySelectorAll('.listChild')]
  const declared = numbers(styleValue(a.el.querySelector('.listChildren'), 'grid-template-columns'))[0]
  const cols = declared && declared >= 1 ? Math.floor(declared) : 3
  const rows = Math.max(1, Math.ceil(kids.length / cols))
  const w = 2 * GRID_LEFT + (cols - 1) * GRID_PITCH + GRID_NOTE_W
  const h = GRID_TOP + (rows - 1) * GRID_PITCH + GRID_NOTE_H + GRID_LEFT - 1
  const s = scaleOf(a.m)
  const angle = angleOf(a.m) || undefined
  const c = apply(a.m, w / 2, h / 2)
  const out: WbElement[] = [make<ShapeEl>({ type: 'shape', kind: 'rect', x: c.x - (w * s) / 2, y: c.y - (h * s) / 2, w: w * s, h: h * s, angle, stroke: '#d1d1d1', fill: '#ffffff', strokeWidth: s }, 0)]
  const title = readText(a.el.querySelector('.listTitleContainer') ?? a.el.querySelector('.listTitle'))
  if (title) {
    const p = apply(a.m, GRID_LEFT, 20)
    out.push(make<TextEl>({ type: 'text', x: p.x, y: p.y, w: (w - 150) * s, text: title, color: '#1f1f1f', fontSize: 30 * s, bold: true, angle }, 0))
  }
  kids.forEach((kid, i) => out.push(readNote(kid, a.m, { x: GRID_LEFT + (i % cols) * GRID_PITCH, y: GRID_TOP + Math.floor(i / cols) * GRID_PITCH })))
  return out
}

function readPlainText(a: Anchor): TextEl | null {
  const box = a.el.querySelector('.plainText')
  if (!box) return null
  const text = readText(box)
  if (!text) return null
  const core = box.querySelector('.textBoxCore')
  const wrapper = [...a.el.querySelectorAll('div')].find((d) => styleValue(d, 'justify-content') !== null && d.contains(box))
  const centred = styleValue(wrapper, 'justify-content') === 'center'
  const size = styleNum(box, 'font-size') ?? 34
  const max = styleNum(box, 'max-width') ?? 400
  const wrapW = centred ? styleNum(wrapper, 'width') : null
  const s = scaleOf(a.m)
  const p = apply(a.m, TEXT_PAD, TEXT_PAD)
  const weight = styleValue(core, 'font-weight')
  return make<TextEl>({
    type: 'text', x: p.x, y: p.y, w: Math.max(20, ((wrapW ?? max) - TEXT_PAD * 2) * s), text,
    color: parseColor(styleValue(core, 'color'))?.hex ?? '#1f1f1f', fontSize: size * s,
    bold: weight ? (weight === 'bold' || Number(weight) >= 600) || undefined : undefined,
    italic: styleValue(core, 'font-style') === 'italic' || undefined,
    align: centred ? 'center' : undefined, font: fontOf(styleValue(core, 'font-family')), angle: angleOf(a.m) || undefined,
  }, 0)
}

function readConnector(a: Anchor): LineEl | null {
  const g = [...a.el.querySelectorAll('g')].find((x) => x.hasAttribute('stroke'))
  const paths = [...a.el.querySelectorAll('path')]
  const route = paths.find((x) => !x.hasAttribute('transform'))
  const n = numbers(route?.getAttribute('d'))
  if (!g || n.length < 4) return null
  let start = { x: n[0], y: n[1] }
  let end = { x: n[n.length - 2], y: n[n.length - 1] }
  const headAt = paths.map((x) => x.getAttribute('transform') ?? '').filter((tr) => tr.includes('translate')).map(numbers).find((v) => v.length >= 2)
  if (headAt && Math.hypot(headAt[0] - start.x, headAt[1] - start.y) < Math.hypot(headAt[0] - end.x, headAt[1] - end.y)) [start, end] = [end, start]
  const s = scaleOf(a.m)
  const p = apply(a.m, start.x, start.y)
  const q = apply(a.m, end.x, end.y)
  const sw = g.getAttribute('stroke-width') ?? '2.5'
  return make<LineEl>({ type: 'line', x: p.x, y: p.y, dx: q.x - p.x, dy: q.y - p.y, color: parseColor(g.getAttribute('stroke'))?.hex ?? '#1f1f1f', strokeWidth: (numbers(sw)[0] ?? 2.5) * (sw.includes('pt') ? 4 / 3 : 1) * s, arrowEnd: headAt ? true : undefined }, 0)
}

function readLink(a: Anchor, label: string): TextEl | null {
  const link = a.el.querySelector('a[href]')
  const href = link?.getAttribute('href')
  if (!href) return null
  const title = link?.textContent?.trim() || href
  const desc = a.el.querySelector('.previewCardDescription')?.textContent?.trim()
  const width = (styleNum(a.el.querySelector('.previewCardTitleContainer'), 'width') ?? 320) + 22
  const s = scaleOf(a.m)
  const p = apply(a.m, 0, 0)
  return make<TextEl>({ type: 'text', x: p.x, y: p.y, w: width * s, text: `${label}: ${title}\n${href}${desc ? `\n${desc}` : ''}`, color: '#0063b1', fontSize: 18 * s }, 0)
}

type Thread = { author: string; date: string; body: string }[]
function readThreads(json: string | null): Map<string, Thread> {
  const out = new Map<string, Thread>()
  if (!json) return out
  try {
    const data = JSON.parse(json) as { commentThreads?: { id?: string | number; comments?: { author?: { name?: string }; displayDate?: string; body?: string }[] }[] }
    for (const th of data.commentThreads ?? []) {
      if (th.id === undefined || !Array.isArray(th.comments)) continue
      // Names only: the export carries e-mail addresses too, and they stay out.
      out.set(String(th.id), th.comments.map((c) => ({ author: c.author?.name ?? '', date: c.displayDate ?? '', body: (c.body ?? '').trim() })))
    }
  } catch { /* a broken comments file costs the comments, not the board */ }
  return out
}

function readComment(a: Anchor, threads: Map<string, Thread>, label: string): NoteEl | null {
  const hint = [...a.el.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label') ?? '').find((l) => l.startsWith('Comment hint:'))
  const thread = hint ? threads.get(hint.slice('Comment hint:'.length).trim()) : undefined
  if (!thread?.length) return null
  const p = apply(a.m, 44, 0)
  const text = `${label}\n\n` + thread.map((c) => `${c.author}${c.date ? ` · ${c.date}` : ''}\n${c.body}`).join('\n\n')
  return make<NoteEl>({ type: 'note', x: p.x, y: p.y, w: 280, h: 280, color: '#e6e6e6', text }, 0)
}
