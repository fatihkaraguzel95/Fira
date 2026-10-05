import { memo } from 'react'
import { displayUrl } from '../../../lib/storage'
import { FONT_STACK, type GridKind, type ImageEl, type InkEl, type LineEl, type NoteEl, type ShapeEl, type StampEl, type TextEl, type WbElement } from './model'
import { arrowHead, inkPath, rainbowAxis } from './ink'
import { LINE_HEIGHT, NOTE_PAD, baselineOffset, noteLayout, shapeTextLayout, textBlockSize } from './text'
import { localBox } from './geometry'

/**
 * One renderer for the live board, the export (SVG/PNG) and the version
 * preview: plain SVG, no HTML inside, system fonts. `srcMap` swaps image
 * addresses for data URLs when the markup has to stand on its own (export).
 */

const deg = (rad: number) => (rad * 180) / Math.PI
const rot = (el: WbElement) => {
  if (!el.angle) return undefined
  const b = localBox(el)
  return `rotate(${deg(el.angle)} ${b.x + b.w / 2} ${b.y + b.h / 2})`
}

/** Shared <defs>: rainbow and galaxy paints. Rendered once per SVG. */
export function WbDefs({ idPrefix = 'wb' }: { idPrefix?: string }) {
  return (
    <defs>
      <pattern id={`${idPrefix}-galaxy`} patternUnits="userSpaceOnUse" width="48" height="48">
        <rect width="48" height="48" fill="#241b5e" />
        <rect width="48" height="48" fill={`url(#${idPrefix}-galaxy-glow)`} />
        <circle cx="6" cy="9" r="1.1" fill="#fff" />
        <circle cx="30" cy="5" r="0.7" fill="#e0d7ff" />
        <circle cx="40" cy="22" r="1.3" fill="#fff" />
        <circle cx="18" cy="28" r="0.8" fill="#b7f0ff" />
        <circle cx="9" cy="42" r="1" fill="#ffe8fb" />
        <circle cx="33" cy="39" r="0.6" fill="#fff" />
        <circle cx="24" cy="15" r="0.5" fill="#fff" />
      </pattern>
      <radialGradient id={`${idPrefix}-galaxy-glow`} cx="0.35" cy="0.4" r="0.7">
        <stop offset="0" stopColor="#8f5cff" stopOpacity="0.85" />
        <stop offset="0.6" stopColor="#3b2a9e" stopOpacity="0.5" />
        <stop offset="1" stopColor="#140f3a" stopOpacity="0" />
      </radialGradient>
    </defs>
  )
}

export function GridPattern({ kind, zoom, pan, bg }: { kind: GridKind; zoom: number; pan: { x: number; y: number }; bg: string }) {
  if (kind === 'none') return null
  // Dots/lines on a light board are dark, on a dark board light.
  const dark = isDarkColor(bg)
  const ink = dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)'
  let step = 24 * zoom
  while (step < 12) step *= 2
  const ox = ((pan.x % step) + step) % step
  const oy = ((pan.y % step) + step) % step
  return (
    <>
      <defs>
        <pattern id="wb-grid" patternUnits="userSpaceOnUse" width={step} height={step} x={ox} y={oy}>
          {kind === 'dots'
            ? <circle cx={step / 2} cy={step / 2} r={Math.max(0.8, Math.min(1.5, zoom * 1.2))} fill={ink} />
            : <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke={ink} strokeWidth={1} />}
        </pattern>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="url(#wb-grid)" pointerEvents="none" />
    </>
  )
}

export function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
}

interface ViewProps {
  el: WbElement
  /** Hidden while its text is being edited in the overlay. */
  editing?: boolean
  idPrefix?: string
  srcMap?: Record<string, string>
}

export const ElementView = memo(function ElementView({ el, editing, idPrefix = 'wb', srcMap }: ViewProps) {
  switch (el.type) {
    case 'ink': return <InkView el={el} idPrefix={idPrefix} />
    case 'note': return <NoteView el={el} editing={editing} />
    case 'text': return editing ? null : <TextView el={el} />
    case 'shape': return <ShapeView el={el} editing={editing} />
    case 'line': return <LineView el={el} />
    case 'image': return <ImageView el={el} srcMap={srcMap} />
    case 'stamp': return <StampView el={el} />
  }
})

export function InkView({ el, idPrefix = 'wb', live }: { el: InkEl; idPrefix?: string; live?: boolean }) {
  const hl = el.pen === 'highlighter'
  const gradId = `${idPrefix}-rb-${el.id}`
  let fill: string = el.color
  let defs: JSX.Element | null = null
  if (el.pen === 'rainbow') {
    const a = rainbowAxis(el)
    defs = (
      <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}>
        {['#ff3b3b', '#ff9f1c', '#ffe13b', '#3bd16f', '#2f9bff', '#7a5cff', '#e04fd6'].map((c, i, all) => <stop key={c} offset={i / (all.length - 1)} stopColor={c} />)}
      </linearGradient>
    )
    fill = `url(#${gradId})`
  } else if (el.pen === 'galaxy') fill = `url(#${idPrefix}-galaxy)`
  const d = el.outline ? el.outline.d : inkPath(el, !live)
  const head = el.pen === 'arrow' ? arrowHead(el) : null
  return (
    <g transform={`translate(${el.x} ${el.y})`} opacity={el.opacity ?? (hl ? 0.45 : 1)} style={hl ? { mixBlendMode: 'multiply' } : undefined}>
      {defs && <defs>{defs}</defs>}
      {el.outline
        ? <path d={d} fill={fill} transform={`matrix(${el.outline.m.join(' ')})`} />
        : <path d={d} fill={fill} />}
      {head && <path d={head} fill="none" stroke={fill} strokeWidth={Math.max(2, el.size * 0.9)} strokeLinecap="round" strokeLinejoin="round" />}
    </g>
  )
}

function NoteView({ el, editing }: { el: NoteEl; editing?: boolean }) {
  const { size, lines } = noteLayout(el)
  const dark = isDarkColor(el.color)
  const fg = dark ? '#ffffff' : '#1f1f1f'
  return (
    <g transform={rot(el)}>
      {/* Soft shadow like a paper note lifted off the board. */}
      <rect x={el.x + 1} y={el.y + 3} width={el.w} height={el.h} rx={4} fill="rgba(0,0,0,0.12)" />
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={4} fill={el.color} />
      {!editing && lines.map((line, i) => (
        <text key={i} x={el.x + NOTE_PAD} y={el.y + NOTE_PAD + i * size * LINE_HEIGHT + baselineOffset(size)} fontSize={size} fontFamily={FONT_STACK.sans} fill={fg} xmlSpace="preserve">{line}</text>
      ))}
      {el.author && (
        <text x={el.x + el.w - 10} y={el.y + el.h - 8} fontSize={11} fontFamily={FONT_STACK.sans} fill={fg} opacity={0.55} textAnchor="end">{el.author}</text>
      )}
    </g>
  )
}

function TextView({ el }: { el: TextEl }) {
  const { lines } = textBlockSize(el)
  const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start'
  const x = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x
  return (
    <g transform={rot(el)}>
      {lines.map((line, i) => (
        <text key={i} x={x} y={el.y + i * el.fontSize * LINE_HEIGHT + baselineOffset(el.fontSize, el.font)} fontSize={el.fontSize}
          fontFamily={FONT_STACK[el.font ?? 'sans']} fontWeight={el.bold ? 700 : 400} fontStyle={el.italic ? 'italic' : undefined}
          fill={el.color} textAnchor={anchor} xmlSpace="preserve">{line}</text>
      ))}
    </g>
  )
}

/** Outline of a shape kind inside the box (x, y, w, h). */
export function shapePath(kind: ShapeEl['kind'], x: number, y: number, w: number, h: number): string {
  const r = (n: number) => Math.round(n * 100) / 100
  switch (kind) {
    case 'triangle': return `M${r(x + w / 2)},${r(y)} L${r(x + w)},${r(y + h)} L${r(x)},${r(y + h)} Z`
    case 'diamond': return `M${r(x + w / 2)},${r(y)} L${r(x + w)},${r(y + h / 2)} L${r(x + w / 2)},${r(y + h)} L${r(x)},${r(y + h / 2)} Z`
    case 'hexagon': return `M${r(x + w * 0.25)},${r(y)} L${r(x + w * 0.75)},${r(y)} L${r(x + w)},${r(y + h / 2)} L${r(x + w * 0.75)},${r(y + h)} L${r(x + w * 0.25)},${r(y + h)} L${r(x)},${r(y + h / 2)} Z`
    case 'arrow': return `M${r(x)},${r(y + h * 0.3)} L${r(x + w * 0.62)},${r(y + h * 0.3)} L${r(x + w * 0.62)},${r(y)} L${r(x + w)},${r(y + h / 2)} L${r(x + w * 0.62)},${r(y + h)} L${r(x + w * 0.62)},${r(y + h * 0.7)} L${r(x)},${r(y + h * 0.7)} Z`
    case 'star': {
      const cx = x + w / 2, cy = y + h / 2
      let d = ''
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const k = i % 2 === 0 ? 1 : 0.42
        d += `${i ? 'L' : 'M'}${r(cx + Math.cos(a) * (w / 2) * k)},${r(cy + Math.sin(a) * (h / 2) * k)} `
      }
      return d + 'Z'
    }
    default: return ''
  }
}

function ShapeView({ el, editing }: { el: ShapeEl; editing?: boolean }) {
  const fill = el.fill ?? 'none'
  const stroke = el.stroke === 'transparent' ? 'none' : el.stroke
  let body: JSX.Element
  if (el.kind === 'rect') body = <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={Math.min(8, el.w / 8, el.h / 8)} fill={fill} stroke={stroke} strokeWidth={el.strokeWidth} />
  else if (el.kind === 'ellipse') body = <ellipse cx={el.x + el.w / 2} cy={el.y + el.h / 2} rx={el.w / 2} ry={el.h / 2} fill={fill} stroke={stroke} strokeWidth={el.strokeWidth} />
  else if (el.kind === 'path' && el.d && el.vb) {
    body = (
      <svg x={el.x} y={el.y} width={el.w} height={el.h} viewBox={el.vb.join(' ')} preserveAspectRatio="none" overflow="visible">
        <path d={el.d} fill={fill} stroke={stroke} strokeWidth={el.strokeWidth} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    )
  } else body = <path d={shapePath(el.kind, el.x, el.y, el.w, el.h)} fill={fill} stroke={stroke} strokeWidth={el.strokeWidth} strokeLinejoin="round" />
  const text = !editing && el.text ? shapeTextLayout(el) : null
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2
  return (
    <g transform={rot(el)}>
      {body}
      {text && (
        <g transform={el.textAngle ? `rotate(${deg(el.textAngle)} ${cx} ${cy})` : undefined}>
          {text.lines.map((line, i) => {
            const top = cy - (text.lines.length * text.size * LINE_HEIGHT) / 2
            return (
              <text key={i} x={cx} y={top + i * text.size * LINE_HEIGHT + baselineOffset(text.size)} fontSize={text.size} fontFamily={FONT_STACK.sans}
                fontWeight={el.bold ? 700 : 400} fill={el.textColor ?? (el.fill && isDarkColor(el.fill) ? '#ffffff' : '#1f1f1f')} textAnchor="middle" xmlSpace="preserve">{line}</text>
            )
          })}
        </g>
      )}
    </g>
  )
}

function LineView({ el }: { el: LineEl }) {
  const x2 = el.x + el.dx, y2 = el.y + el.dy
  const ang = Math.atan2(el.dy, el.dx)
  const len = Math.max(10, el.strokeWidth * 4)
  const head = (x: number, y: number, a: number) =>
    `M${x - len * Math.cos(a - 0.45)},${y - len * Math.sin(a - 0.45)} L${x},${y} L${x - len * Math.cos(a + 0.45)},${y - len * Math.sin(a + 0.45)}`
  return (
    <g stroke={el.color} strokeWidth={el.strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <line x1={el.x} y1={el.y} x2={x2} y2={y2} />
      {el.arrowEnd && <path d={head(x2, y2, ang)} />}
      {el.arrowStart && <path d={head(el.x, el.y, ang + Math.PI)} />}
    </g>
  )
}

function ImageView({ el, srcMap }: { el: ImageEl; srcMap?: Record<string, string> }) {
  const href = srcMap?.[el.src] ?? displayUrl(el.src)
  return (
    <g transform={rot(el)}>
      <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="rgba(0,0,0,0.04)" />
      <image x={el.x} y={el.y} width={el.w} height={el.h} href={href} preserveAspectRatio="none" />
    </g>
  )
}

function StampView({ el }: { el: StampEl }) {
  return (
    <g transform={rot(el)}>
      <text x={el.x + el.size / 2} y={el.y + el.size * 0.84} fontSize={el.size * 0.86} textAnchor="middle"
        fontFamily="'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif">{el.emoji}</text>
    </g>
  )
}
