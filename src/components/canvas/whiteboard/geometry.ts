import type { InkEl, LineEl, WbElement } from './model'
import { textBlockSize } from './text'

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export const rotate = (p: Pt, c: Pt, a: number): Pt => {
  if (!a) return p
  const s = Math.sin(a), k = Math.cos(a)
  const dx = p.x - c.x, dy = p.y - c.y
  return { x: c.x + dx * k - dy * s, y: c.y + dx * s + dy * k }
}

export const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
  const vx = b.x - a.x, vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  let t = len2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const x = a.x + t * vx, y = a.y + t * vy
  return Math.hypot(p.x - x, p.y - y)
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside
  }
  return inside
}

/** Absolute centre-line points of a stroke. */
export function inkPoints(el: InkEl): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i + 1 < el.pts.length; i += 3) out.push({ x: el.x + el.pts[i], y: el.y + el.pts[i + 1] })
  return out
}

/** The element's own box before rotation (ink and lines: their extent). */
export function localBox(el: WbElement): Box {
  switch (el.type) {
    case 'note': case 'shape': case 'image': return { x: el.x, y: el.y, w: el.w, h: el.h }
    case 'stamp': return { x: el.x, y: el.y, w: el.size, h: el.size }
    case 'text': { const s = textBlockSize(el); return { x: el.x, y: el.y, w: el.w, h: s.h } }
    case 'line': {
      const x2 = el.x + el.dx, y2 = el.y + el.dy
      return { x: Math.min(el.x, x2), y: Math.min(el.y, y2), w: Math.abs(el.dx), h: Math.abs(el.dy) }
    }
    case 'ink': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i + 1 < el.pts.length; i += 3) {
        const x = el.pts[i], y = el.pts[i + 1]
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
      if (minX === Infinity) return { x: el.x, y: el.y, w: 0, h: 0 }
      return { x: el.x + minX, y: el.y + minY, w: maxX - minX, h: maxY - minY }
    }
  }
}

const boundsCache = new WeakMap<WbElement, Box>()

/** Axis-aligned bounds on the canvas, rotation and stroke included. */
export function bounds(el: WbElement): Box {
  const hit = boundsCache.get(el)
  if (hit) return hit
  const b = localBox(el)
  let out: Box
  if (el.type === 'ink' || el.type === 'line') {
    const pad = (el.type === 'ink' ? el.size : el.strokeWidth) / 2 + (el.type === 'line' && (el.arrowEnd || el.arrowStart) ? el.strokeWidth * 3 : 0)
    out = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }
  } else if (el.angle) {
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    const corners = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }].map((p) => rotate(p, c, el.angle!))
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y)
    out = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  } else out = b
  boundsCache.set(el, out)
  return out
}

export function unionBounds(els: Iterable<WbElement>): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of els) {
    if (el.isDeleted) continue
    const b = bounds(el)
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h)
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export const boxContains = (outer: Box, inner: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
export const boxesIntersect = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
export const boxFromPoints = (a: Pt, b: Pt): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
export const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Is `p` on the element? `tol` in canvas units (a few screen pixels / zoom). */
export function hitTest(el: WbElement, p: Pt, tol: number): boolean {
  if (el.isDeleted) return false
  if (el.type === 'ink') {
    const pts = inkPoints(el)
    const r = el.size / 2 + tol
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= r
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= r) return true
    return false
  }
  if (el.type === 'line') return lineHit(el, p, tol)
  const b = localBox(el)
  const c = center(b)
  const q = rotate(p, c, -(el.angle ?? 0))
  const inside = q.x >= b.x - tol && q.x <= b.x + b.w + tol && q.y >= b.y - tol && q.y <= b.y + b.h + tol
  if (!inside) return false
  // An outline without fill is picked by its edge (or its text), like Excalidraw.
  if (el.type === 'shape' && !el.fill && !el.text) {
    const band = tol + el.strokeWidth + 2
    if (el.kind === 'ellipse') {
      const rx = b.w / 2, ry = b.h / 2
      const r = Math.hypot((q.x - c.x) / (rx || 1), (q.y - c.y) / (ry || 1))
      return Math.abs(r - 1) * Math.min(rx, ry) <= band
    }
    return Math.min(q.x - b.x, b.x + b.w - q.x, q.y - b.y, b.y + b.h - q.y) <= band
  }
  return true
}

function lineHit(el: LineEl, p: Pt, tol: number) {
  return distToSegment(p, { x: el.x, y: el.y }, { x: el.x + el.dx, y: el.y + el.dy }) <= el.strokeWidth / 2 + tol
}

/** Does the eraser path segment a→b (radius r) touch this stroke? */
export function inkTouchesSegment(el: InkEl, a: Pt, b: Pt, r: number): boolean {
  const bb = bounds(el)
  const seg = boxFromPoints(a, b)
  if (!boxesIntersect({ x: bb.x - r, y: bb.y - r, w: bb.w + 2 * r, h: bb.h + 2 * r }, seg)) return false
  const pts = inkPoints(el)
  const reach = r + el.size / 2
  if (pts.length === 1) return distToSegment(pts[0], a, b) <= reach
  for (let i = 1; i < pts.length; i++) {
    if (segmentDistance(pts[i - 1], pts[i], a, b) <= reach) return true
  }
  return false
}

/** Shortest distance between two segments. */
export function segmentDistance(p1: Pt, p2: Pt, q1: Pt, q2: Pt): number {
  if (segmentsCross(p1, p2, q1, q2)) return 0
  return Math.min(distToSegment(p1, q1, q2), distToSegment(p2, q1, q2), distToSegment(q1, p1, p2), distToSegment(q2, p1, p2))
}
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

/** Lasso: most of a stroke, or the middle of anything else, inside the loop. */
export function inLasso(el: WbElement, poly: Pt[]): boolean {
  if (el.type === 'ink') {
    const pts = inkPoints(el)
    if (!pts.length) return false
    const n = pts.filter((q) => pointInPolygon(q, poly)).length
    return n / pts.length >= 0.6
  }
  if (el.type === 'line') {
    return pointInPolygon({ x: el.x, y: el.y }, poly) && pointInPolygon({ x: el.x + el.dx, y: el.y + el.dy }, poly)
  }
  return pointInPolygon(center(bounds(el)), poly)
}
