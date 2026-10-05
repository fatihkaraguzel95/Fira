import { describe, expect, it } from 'vitest'
import { mergeDescriptionEdits } from './timelineMerge'

const HOUR = 60 * 60 * 1000
const at = (min: number) => new Date(Date.UTC(2026, 8, 29, 12, 0) - min * 60 * 1000).toISOString()
const desc = (id: string, key: string, min: number, from: number, to: number) =>
  ({ id, type: 'activity', key, at: at(min), a: { kind: 'description', meta: { from_len: from, to_len: to } } })
const other = (id: string, key: string, min: number, kind = 'status') => ({ id, type: 'activity', key, at: at(min), a: { kind, meta: {} } })
const comment = (id: string, key: string, min: number) => ({ id, type: 'comment', key, at: at(min) })

describe('mergeDescriptionEdits', () => {
  it('folds adjacent edits by the same person into the newest one with the net change', () => {
    const out = mergeDescriptionEdits([desc('d3', 'u1', 0, 110, 112), desc('d2', 'u1', 10, 100, 110), desc('d1', 'u1', 20, 0, 100)], HOUR)
    expect(out.map((x) => x.id)).toEqual(['d3'])
    expect(out[0].a?.meta).toMatchObject({ from_len: 0, to_len: 112, merged: 3 })
  })

  it('does not merge across another entry, another person or a long gap', () => {
    const list = [desc('d4', 'u1', 0, 5, 6), other('s1', 'u1', 5), desc('d3', 'u1', 10, 4, 5), desc('d2', 'u2', 12, 3, 4), desc('d1', 'u2', 3 * 60, 2, 3)]
    expect(mergeDescriptionEdits(list, HOUR).map((x) => x.id)).toEqual(['d4', 's1', 'd3', 'd2', 'd1'])
  })

  it('chains the window from edit to edit, not from the newest', () => {
    const list = [desc('d3', 'u1', 0, 2, 3), desc('d2', 'u1', 50, 1, 2), desc('d1', 'u1', 100, 0, 1)]
    const out = mergeDescriptionEdits(list, HOUR)
    expect(out.map((x) => x.id)).toEqual(['d3'])
    expect(out[0].a?.meta).toMatchObject({ from_len: 0, merged: 3 })
  })

  it('leaves comments and other kinds alone', () => {
    const list = [comment('c2', 'u1', 0), comment('c1', 'u1', 1), other('t1', 'u1', 2, 'title'), other('t0', 'u1', 3, 'title')]
    expect(mergeDescriptionEdits(list, HOUR).map((x) => x.id)).toEqual(['c2', 'c1', 't1', 't0'])
  })
})
