import { getStroke } from 'perfect-freehand'
import type { InkEl } from './model'

/**
 * Ink as Teams draws it: a filled outline whose width follows pen pressure
 * (perfect-freehand, MIT). Mouse and touch have no pressure, so it is simulated
 * from speed. The highlighter is a flat, even ribbon drawn translucent.
 */
export function strokeOptions(el: Pick<InkEl, 'size' | 'pen' | 'pressure'>, last = true) {
  const hl = el.pen === 'highlighter'
  return {
    size: el.size,
    thinning: hl ? 0 : el.pressure ? 0.62 : 0.5,
    smoothing: hl ? 0.6 : 0.5,
    streamline: hl ? 0.55 : 0.42,
    simulatePressure: !el.pressure && !hl,
    start: { cap: !hl, taper: 0 },
    end: { cap: !hl, taper: 0 },
    last,
  }
}

const avg = (a: number, b: number) => (a + b) / 2
const f = (n: number) => (Math.round(n * 100) / 100).toString()

/** perfect-freehand's outline → a smooth closed SVG path. */
export function outlineToPath(points: number[][]): string {
  const len = points.length
  if (!len) return ''
  if (len < 4) {
    const [x, y] = points[0]
    return `M${f(x)},${f(y)}Z`
  }
  let a = points[0]
  let b = points[1]
  const c = points[2]
  let d = `M${f(a[0])},${f(a[1])} Q${f(b[0])},${f(b[1])} ${f(avg(b[0], c[0]))},${f(avg(b[1], c[1]))} T`
  for (let i = 2; i < len - 1; i++) {
    a = points[i]; b = points[i + 1]
    d += `${f(avg(a[0], b[0]))},${f(avg(a[1], b[1]))} `
  }
  return d + 'Z'
}

const pathCache = new WeakMap<object, string>()

/** Outline path of a stroke in its own coordinates (relative to x, y). */
export function inkPath(el: Pick<InkEl, 'pts' | 'size' | 'pen' | 'pressure'>, last = true): string {
  const hit = pathCache.get(el)
  if (hit !== undefined) return hit
  const input: number[][] = []
  for (let i = 0; i + 1 < el.pts.length; i += 3) input.push([el.pts[i], el.pts[i + 1], el.pts[i + 2] ?? 0.5])
  const d = input.length ? outlineToPath(getStroke(input, strokeOptions(el, last))) : ''
  pathCache.set(el, d)
  return d
}

/** Arrow pen: the head at the end of the stroke, as a stroked open path. */
export function arrowHead(el: Pick<InkEl, 'pts' | 'size'>): string | null {
  const n = Math.floor(el.pts.length / 3)
  if (n < 2) return null
  const ex = el.pts[(n - 1) * 3], ey = el.pts[(n - 1) * 3 + 1]
  // Direction from a point a little way back, not the last jittery pixel.
  const want = Math.max(12, el.size * 4)
  let bx = el.pts[0], by = el.pts[1]
  for (let i = n - 2; i >= 0; i--) {
    const x = el.pts[i * 3], y = el.pts[i * 3 + 1]
    bx = x; by = y
    if (Math.hypot(ex - x, ey - y) >= want) break
  }
  const ang = Math.atan2(ey - by, ex - bx)
  if (!Number.isFinite(ang) || (ex === bx && ey === by)) return null
  const len = Math.max(12, el.size * 3.2)
  const spread = 0.5
  const p1 = { x: ex - len * Math.cos(ang - spread), y: ey - len * Math.sin(ang - spread) }
  const p2 = { x: ex - len * Math.cos(ang + spread), y: ey - len * Math.sin(ang + spread) }
  return `M${f(p1.x)},${f(p1.y)} L${f(ex)},${f(ey)} L${f(p2.x)},${f(p2.y)}`
}

/** Rainbow pen: a gradient from the first to the last point (or across the stroke's box for a loop). */
export function rainbowAxis(el: Pick<InkEl, 'pts'>): { x1: number; y1: number; x2: number; y2: number } {
  const n = Math.floor(el.pts.length / 3)
  if (n < 1) return { x1: 0, y1: 0, x2: 1, y2: 0 }
  const x1 = el.pts[0], y1 = el.pts[1]
  const x2 = el.pts[(n - 1) * 3], y2 = el.pts[(n - 1) * 3 + 1]
  if (Math.hypot(x2 - x1, y2 - y1) > 24) return { x1, y1, x2, y2 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const x = el.pts[i * 3], y = el.pts[i * 3 + 1]
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  return { x1: minX, y1: minY, x2: maxX + 1, y2: maxY + 1 }
}

/** Keep a stroke light: drop points closer than `min` to the last kept one (the tail is always kept). */
export function thinPoints(pts: number[], min = 0.6): number[] {
  if (pts.length <= 6) return pts
  const out = [pts[0], pts[1], pts[2]]
  for (let i = 3; i < pts.length; i += 3) {
    const lx = out[out.length - 3], ly = out[out.length - 2]
    const last = i + 3 >= pts.length
    if (last || Math.hypot(pts[i] - lx, pts[i + 1] - ly) >= min) out.push(pts[i], pts[i + 1], pts[i + 2])
  }
  return out
}

/** Round to 0.1 px (and pressure to 0.01): a stroke is stored and broadcast as numbers. */
export const roundPts = (pts: number[]) => pts.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10))
