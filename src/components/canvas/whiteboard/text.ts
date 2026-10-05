import { FONT_STACK, type FontKind, type NoteEl, type ShapeEl, type TextEl } from './model'

/**
 * Text on the board is SVG <text>, not HTML: the same markup is the export, and
 * an SVG with <foreignObject> taints a canvas (PNG export) in some browsers.
 * So lines are broken here, measured with a 2D canvas in the same font.
 */
export const LINE_HEIGHT = 1.25
export const NOTE_PAD = 14
export const NOTE_AUTHOR_H = 20

let ctx: CanvasRenderingContext2D | null | undefined
function measureCtx() {
  if (ctx === undefined) {
    try { ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null } catch { ctx = null }
  }
  return ctx
}

export const fontCss = (size: number, font: FontKind = 'sans', bold?: boolean, italic?: boolean) =>
  `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px ${FONT_STACK[font]}`

export function measureWidth(text: string, size: number, font: FontKind = 'sans', bold?: boolean, italic?: boolean): number {
  const c = measureCtx()
  if (!c) return text.length * size * 0.55
  c.font = fontCss(size, font, bold, italic)
  return c.measureText(text).width
}

const baseCache = new Map<string, number>()
/**
 * Top of a line box → its baseline, the way CSS lays a line out (the editing
 * textarea is HTML): half the leading, then the font's ascent. Measured once per
 * font, so the text does not jump when a note switches between view and edit.
 */
export function baselineOffset(size: number, font: FontKind = 'sans'): number {
  let k = baseCache.get(font)
  if (k === undefined) {
    let asc = 0.9
    let desc = 0.22
    const c = measureCtx()
    if (c) {
      c.font = fontCss(100, font)
      const m = c.measureText('Hg')
      if (m.fontBoundingBoxAscent) { asc = m.fontBoundingBoxAscent / 100; desc = m.fontBoundingBoxDescent / 100 }
    }
    k = (LINE_HEIGHT - (asc + desc)) / 2 + asc
    baseCache.set(font, k)
  }
  return k * size
}

const cache = new Map<string, string[]>()

/** Lines of `text` within `width`: words wrap, a word longer than the line breaks by letters. */
export function wrapText(text: string, width: number, size: number, font: FontKind = 'sans', bold?: boolean, italic?: boolean): string[] {
  const key = `${width}|${size}|${font}|${bold ? 1 : 0}|${italic ? 1 : 0}|${text}`
  const hit = cache.get(key)
  if (hit) return hit
  const out: string[] = []
  const max = Math.max(1, width)
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue }
    const fits = (s: string) => measureWidth(s, size, font, bold, italic) <= max
    let line = ''
    for (const w of para.split(/(\s+)/)) {
      if (!w) continue
      if (fits(line + w)) { line += w; continue }
      // Does not fit: spaces end the line, a word starts the next one.
      if (/^\s+$/.test(w)) { out.push(line.trimEnd()); line = ''; continue }
      if (line.trim()) out.push(line.trimEnd())
      line = ''
      if (fits(w)) { line = w; continue }
      // A single word wider than the line breaks by letters.
      let chunk = ''
      for (const ch of w) {
        if (chunk && !fits(chunk + ch)) { out.push(chunk); chunk = ch } else chunk += ch
      }
      line = chunk
    }
    out.push(line.trimEnd())
  }
  if (cache.size > 3000) cache.clear()
  cache.set(key, out)
  return out
}

export function textBlockSize(el: TextEl): { w: number; h: number; lines: string[] } {
  const lines = wrapText(el.text || ' ', el.w, el.fontSize, el.font, el.bold, el.italic)
  return { w: el.w, h: Math.max(1, lines.length) * el.fontSize * LINE_HEIGHT, lines }
}

/** A note's text: the given size, or the largest that fits (32 → 12; Teams' notes start at 32 px). */
export function noteLayout(el: NoteEl): { size: number; lines: string[] } {
  const bottom = el.author ? NOTE_AUTHOR_H : 0
  const w = el.w - NOTE_PAD * 2
  const h = el.h - NOTE_PAD * 2 - bottom
  if (el.fontSize) return { size: el.fontSize, lines: wrapText(el.text, w, el.fontSize) }
  const text = el.text || ''
  if (!text.trim()) return { size: 24, lines: [''] }
  for (let size = 32; size >= 12; size -= 2) {
    const lines = wrapText(text, w, size)
    if (lines.length * size * LINE_HEIGHT <= h) return { size, lines }
  }
  return { size: 12, lines: wrapText(text, w, 12) }
}

/** Text inside a shape: centred, within the part of the box that is inside most outlines. */
export function shapeTextLayout(el: ShapeEl): { size: number; lines: string[]; width: number } {
  const size = el.fontSize ?? 18
  const inset = el.kind === 'ellipse' || el.kind === 'diamond' || el.kind === 'hexagon' || el.kind === 'star' || el.kind === 'triangle' ? 0.7 : 0.9
  const width = Math.max(10, el.w * inset - 8)
  return { size, lines: wrapText(el.text ?? '', width, size, 'sans', el.bold), width }
}
