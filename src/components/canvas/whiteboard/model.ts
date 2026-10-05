import { readTimer, type WbTimer } from './timer'
import type { SyncElement } from '../../../lib/canvas/session'
import { randomNonce } from '../../../lib/canvas/session'

/**
 * The whiteboard's document (096, beta). A flat set of elements, each synced on
 * its own (version / versionNonce, see lib/canvas/session). Order on the board
 * is `z`, not array position: two people adding at once must not fight over
 * indices. Coordinates are canvas pixels; `angle` is radians around the centre.
 */

export type PenKind = 'plain' | 'rainbow' | 'galaxy' | 'arrow'

interface Base extends SyncElement {
  x: number
  y: number
  z: number
  angle?: number
  locked?: boolean
  /** Creator (user id) — notes show their author's name. */
  by?: string
}

export interface InkEl extends Base {
  type: 'ink'
  /** Flat [dx, dy, pressure] triplets relative to (x, y). */
  pts: number[]
  color: string
  size: number
  pen: PenKind | 'highlighter'
  /** Points came with real pen pressure (else it is simulated from speed). */
  pressure?: boolean
  /** Outline taken over as drawn (Microsoft Whiteboard import): path + matrix relative to (x, y). */
  outline?: { d: string; m: [number, number, number, number, number, number] }
  opacity?: number
}

export interface NoteEl extends Base {
  type: 'note'
  w: number
  h: number
  color: string
  text: string
  /** Absent = the largest size that fits (like sticky notes everywhere). */
  fontSize?: number
  author?: string
}

export type FontKind = 'sans' | 'serif' | 'hand' | 'mono'

export interface TextEl extends Base {
  type: 'text'
  /** Wrap width. */
  w: number
  text: string
  color: string
  fontSize: number
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  font?: FontKind
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star' | 'arrow' | 'path'

export interface ShapeEl extends Base {
  type: 'shape'
  kind: ShapeKind
  w: number
  h: number
  stroke: string
  fill: string | null
  strokeWidth: number
  text?: string
  fontSize?: number
  textColor?: string
  bold?: boolean
  /** Text turned against the shape (imported quarter-turned shapes), radians. */
  textAngle?: number
  /** kind 'path': the outline in its own box `vb` [x, y, w, h], stretched to w × h. */
  d?: string
  vb?: [number, number, number, number]
}

export interface LineEl extends Base {
  type: 'line'
  /** End point relative to (x, y). */
  dx: number
  dy: number
  color: string
  strokeWidth: number
  arrowEnd?: boolean
  arrowStart?: boolean
}

export interface ImageEl extends Base {
  type: 'image'
  w: number
  h: number
  src: string
  mime?: string
}

export interface StampEl extends Base {
  type: 'stamp'
  emoji: string
  size: number
}

export type WbElement = InkEl | NoteEl | TextEl | ShapeEl | LineEl | ImageEl | StampEl
export type WbType = WbElement['type']

export type GridKind = 'dots' | 'grid' | 'none'
export interface WbSettings {
  bg: string
  grid: GridKind
  /** The shared countdown (timer.ts); null when there is none. */
  timer: WbTimer | null
}
export const DEFAULT_SETTINGS: WbSettings = { bg: '#f6f7f9', grid: 'dots', timer: null }

export function readSettings(raw: Record<string, unknown> | null | undefined): WbSettings {
  const bg = typeof raw?.bg === 'string' && /^#[0-9a-f]{6}$/i.test(raw.bg) ? raw.bg : DEFAULT_SETTINGS.bg
  const grid = raw?.grid === 'grid' || raw?.grid === 'none' || raw?.grid === 'dots' ? raw.grid : DEFAULT_SETTINGS.grid
  return { bg, grid, timer: readTimer(raw?.timer) }
}

// ── Palettes ─────────────────────────────────────────────────────────────────

/** Ink colours of the pen tray (Teams Whiteboard's defaults, then more). */
export const INK_COLORS = ['#1f1f1f', '#e81224', '#0063b1', '#16c60c', '#f7630c', '#886ce4', '#ffb900', '#ffffff', '#8e562e', '#e3008c', '#00b7c3', '#767676']
export const HIGHLIGHTER_COLORS = ['#ffe600', '#7cf249', '#3ee3ff', '#ff66d0', '#ffa136']
/** Sticky-note colours — the twelve Microsoft Whiteboard offers. */
export const NOTE_COLORS = ['#fee15a', '#fccd7a', '#ffab7c', '#f18992', '#ea99c7', '#cbe59c', '#b4e8ca', '#99c9ef', '#b7c3fc', '#dc9bff', '#e6e6e6', '#c6c6c6']
export const SHAPE_COLORS = ['#1f1f1f', '#e81224', '#0063b1', '#16c60c', '#f7630c', '#886ce4', '#ffb900', '#767676']
export const FILL_COLORS = ['#ffffff', '#fde2e4', '#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe', '#fee15a', '#99c9ef', '#cbe59c', '#e6e6e6']
export const BG_COLORS = ['#ffffff', '#f6f7f9', '#fdf8ee', '#eef6f1', '#edf2fb', '#f7eff8', '#2b2b2b', '#1d2733']
export const STAMPS = ['👍', '❤️', '😄', '🎉', '⭐', '✅', '❌', '❓', '❗', '💡', '🔥', '👏', '🙌', '🤔', '😮', '🚀']

export const SHAPE_KINDS: Exclude<ShapeKind, 'path'>[] = ['rect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'arrow']

/** System fonts only: exported SVG/PNG must look like the screen without web fonts. */
export const FONT_STACK: Record<FontKind, string> = {
  sans: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, Cambria, 'Times New Roman', serif",
  hand: "'Segoe Print', 'Ink Free', 'Comic Sans MS', 'Bradley Hand', cursive",
  mono: "Consolas, 'Cascadia Mono', Menlo, monospace",
}

// ── Construction ─────────────────────────────────────────────────────────────

export function newId(): string {
  const a = new Uint8Array(12)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)
}

/** A new element: version 1, fresh nonce, on top of everything. */
export function make<T extends WbElement>(el: Omit<T, 'id' | 'version' | 'versionNonce' | 'updated' | 'z'> & { id?: string; z?: number }, z: number): T {
  return { ...el, id: el.id ?? newId(), version: 1, versionNonce: randomNonce(), updated: Date.now(), z: el.z ?? z } as T
}

/** Live elements, bottom first. */
export function ordered(els: Iterable<WbElement>): WbElement[] {
  return [...els].filter((e) => !e.isDeleted).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function topZ(els: Iterable<WbElement>): number {
  let z = 0
  for (const e of els) if (!e.isDeleted && e.z > z) z = e.z
  return z
}
export function bottomZ(els: Iterable<WbElement>): number {
  let z = 0
  let any = false
  for (const e of els) if (!e.isDeleted) { z = any ? Math.min(z, e.z) : e.z; any = true }
  return z
}

/** A stored element may come from an older build or another tool: keep only what renders. */
export function sanitize(raw: unknown): WbElement | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Partial<WbElement> & Record<string, unknown>
  if (typeof e.id !== 'string' || typeof e.type !== 'string') return null
  if (!['ink', 'note', 'text', 'shape', 'line', 'image', 'stamp'].includes(e.type)) return null
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const base = {
    ...e,
    x: num(e.x), y: num(e.y), z: num(e.z),
    version: num(e.version, 1), versionNonce: num(e.versionNonce), updated: num(e.updated),
  } as WbElement
  if (base.type === 'ink' && !Array.isArray((base as InkEl).pts)) return null
  return base
}
