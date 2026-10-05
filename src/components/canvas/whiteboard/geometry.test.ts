import { describe, expect, it } from 'vitest'
import { bounds, hitTest, inLasso, inkTouchesSegment, unionBounds } from './geometry'
import { make, ordered, sanitize, type InkEl, type LineEl, type NoteEl, type ShapeEl } from './model'
import { preferRemote } from '../../../lib/canvas/session'
import { wrapText } from './text'

const ink = (pts: number[], size = 4): InkEl => make<InkEl>({ type: 'ink', x: 100, y: 100, pts, color: '#000', size, pen: 'plain' }, 1)

describe('whiteboard geometry', () => {
  it('hits a stroke near its centre line, not beside it', () => {
    const el = ink([0, 0, 0.5, 100, 0, 0.5])
    expect(hitTest(el, { x: 150, y: 101 }, 2)).toBe(true)
    expect(hitTest(el, { x: 150, y: 110 }, 2)).toBe(false)
  })

  it('an unfilled shape is picked by its edge, a filled one anywhere inside', () => {
    const open = make<ShapeEl>({ type: 'shape', kind: 'rect', x: 0, y: 0, w: 100, h: 100, stroke: '#000', fill: null, strokeWidth: 2 }, 1)
    const filled = { ...open, fill: '#fff' }
    expect(hitTest(open, { x: 50, y: 50 }, 3)).toBe(false)
    expect(hitTest(open, { x: 1, y: 50 }, 3)).toBe(true)
    expect(hitTest(filled, { x: 50, y: 50 }, 3)).toBe(true)
  })

  it('a rotated note is hit in its own frame and its bounds grow', () => {
    const note = make<NoteEl>({ type: 'note', x: 0, y: 0, w: 100, h: 100, color: '#fee15a', text: '', angle: Math.PI / 4 }, 1)
    // (50, -15) is outside the unrotated square but inside the diamond it turned into.
    expect(hitTest(note, { x: 50, y: -15 }, 0)).toBe(true)
    // A corner of the unrotated square is now outside.
    expect(hitTest(note, { x: 2, y: 2 }, 0)).toBe(false)
    const b = bounds(note)
    expect(b.w).toBeCloseTo(100 * Math.SQRT2, 3)
  })

  it('the eraser takes a stroke it crosses', () => {
    const el = ink([0, 0, 0.5, 100, 0, 0.5])
    expect(inkTouchesSegment(el, { x: 150, y: 50 }, { x: 150, y: 150 }, 2)).toBe(true)
    expect(inkTouchesSegment(el, { x: 250, y: 50 }, { x: 250, y: 150 }, 2)).toBe(false)
  })

  it('lasso: most of a stroke inside selects it', () => {
    const el = ink([0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5, 30, 0, 0.5, 200, 0, 0.5])
    const loop = [{ x: 90, y: 90 }, { x: 140, y: 90 }, { x: 140, y: 110 }, { x: 90, y: 110 }]
    expect(inLasso(el, loop)).toBe(true)
    const line = make<LineEl>({ type: 'line', x: 95, y: 100, dx: 200, dy: 0, color: '#000', strokeWidth: 2 }, 1)
    expect(inLasso(line, loop)).toBe(false)
  })

  it('union bounds skip deleted elements', () => {
    const a = make<NoteEl>({ type: 'note', x: 0, y: 0, w: 10, h: 10, color: '#fff', text: '' }, 1)
    const b = { ...make<NoteEl>({ type: 'note', x: 1000, y: 1000, w: 10, h: 10, color: '#fff', text: '' }, 2), isDeleted: true }
    expect(unionBounds([a, b])).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

describe('sync rule (same as save_page_scene)', () => {
  it('higher version wins; on a tie the lower nonce', () => {
    expect(preferRemote({ id: 'a', version: 2, versionNonce: 5 }, { id: 'a', version: 3, versionNonce: 9 })).toBe(true)
    expect(preferRemote({ id: 'a', version: 3, versionNonce: 5 }, { id: 'a', version: 2, versionNonce: 1 })).toBe(false)
    expect(preferRemote({ id: 'a', version: 3, versionNonce: 5 }, { id: 'a', version: 3, versionNonce: 4 })).toBe(true)
    expect(preferRemote({ id: 'a', version: 3, versionNonce: 5 }, { id: 'a', version: 3, versionNonce: 6 })).toBe(false)
    expect(preferRemote(undefined, { id: 'a', version: 1, versionNonce: 1 })).toBe(true)
  })

  it('order is z, then id; deleted elements are not drawn', () => {
    const els = [
      { ...make<NoteEl>({ type: 'note', x: 0, y: 0, w: 1, h: 1, color: '', text: '' }, 2), id: 'b' },
      { ...make<NoteEl>({ type: 'note', x: 0, y: 0, w: 1, h: 1, color: '', text: '' }, 1), id: 'c' },
      { ...make<NoteEl>({ type: 'note', x: 0, y: 0, w: 1, h: 1, color: '', text: '' }, 2), id: 'a' },
      { ...make<NoteEl>({ type: 'note', x: 0, y: 0, w: 1, h: 1, color: '', text: '' }, 0), id: 'd', isDeleted: true },
    ]
    expect(ordered(els).map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('sanitize drops what cannot be drawn and fills numbers', () => {
    expect(sanitize({ id: 'x', type: 'video' })).toBeNull()
    expect(sanitize({ id: 'x', type: 'ink' })).toBeNull()
    const n = sanitize({ id: 'x', type: 'note', w: 10, h: 10, color: '#fff', text: 'a' })!
    expect(n.version).toBe(1)
    expect(n.x).toBe(0)
  })
})

describe('text wrapping', () => {
  it('breaks on spaces and splits a word longer than the line', () => {
    // No canvas in tests: every character is 0.55 × size wide (10 px at 18 px).
    const lines = wrapText('aaaa bbbb cccccccccccccccccccc', 100, 18)
    expect(lines[0]).toBe('aaaa bbbb')
    expect(lines.slice(1).join('')).toBe('cccccccccccccccccccc')
    expect(lines.every((l) => l.length * 0.55 * 18 <= 100 || l.length === 1)).toBe(true)
  })

  it('keeps empty lines', () => {
    expect(wrapText('a\n\nb', 200, 16)).toEqual(['a', '', 'b'])
  })
})
