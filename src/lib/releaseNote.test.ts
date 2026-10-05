import { describe, expect, it } from 'vitest'
import { compareVersions, nextReleaseState, releaseVisible, releasesInRange, type ReleaseState } from './releaseNote'

const NOW = '2026-10-02T10:00:00.000Z'
const state = (p: Partial<ReleaseState>): ReleaseState => ({ version: '0.80.0', from: '0.80.0', at: '2026-10-01T08:00:00.000Z', read: true, ...p })

describe('compareVersions', () => {
  it('compares part by part, numerically', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
    expect(compareVersions('0.81.0', '0.80.12')).toBe(1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('nextReleaseState', () => {
  it('starts a known browser from what the old dialog had shown', () => {
    expect(nextReleaseState(undefined, '0.81.0', '0.80.0', NOW)).toEqual({ version: '0.81.0', from: '0.80.0', at: NOW, read: false })
  })
  it('gives a new account nothing to read', () => {
    const s = nextReleaseState(undefined, '0.81.0', null, NOW)
    expect(s).toEqual({ version: '0.81.0', from: '0.81.0', at: NOW, read: true })
    expect(releaseVisible(s!, '0.81.0')).toBe(false)
  })
  it('does not show a row when the dialog had already shown this version', () => {
    expect(releaseVisible(nextReleaseState(undefined, '0.81.0', '0.81.0', NOW)!, '0.81.0')).toBe(false)
  })
  it('makes a read account unread again on a newer build, from the version it had read', () => {
    expect(nextReleaseState(state({ version: '0.80.0', from: '0.79.0', read: true }), '0.81.0', null, NOW))
      .toEqual({ version: '0.81.0', from: '0.80.0', at: NOW, read: false })
  })
  it('keeps unread notes in range when another version lands', () => {
    expect(nextReleaseState(state({ version: '0.80.0', from: '0.78.0', read: false }), '0.81.0', null, NOW))
      .toEqual({ version: '0.81.0', from: '0.78.0', at: NOW, read: false })
  })
  it('leaves the state alone for the same or an older build', () => {
    expect(nextReleaseState(state({ version: '0.81.0' }), '0.81.0', '0.70.0', NOW)).toBeNull()
    expect(nextReleaseState(state({ version: '0.82.0' }), '0.81.0', null, NOW)).toBeNull()
  })
})

describe('releaseVisible / releasesInRange', () => {
  const log = ['0.82.0', '0.81.0', '0.80.1', '0.80.0', '0.79.0'].map((version) => ({ version }))
  it('shows a row only while there is a range', () => {
    expect(releaseVisible(state({ version: '0.81.0', from: '0.80.0', read: true }), '0.81.0')).toBe(true)
    expect(releaseVisible(state({ version: '0.81.0', from: '0.81.0' }), '0.81.0')).toBe(false)
    expect(releaseVisible(undefined, '0.81.0')).toBe(false)
  })
  it('hides the row in a tab older than the range', () => {
    expect(releaseVisible(state({ version: '0.82.0', from: '0.81.0', read: false }), '0.81.0')).toBe(false)
  })
  it('lists what came after `from`, up to `version`', () => {
    expect(releasesInRange(log, { from: '0.80.0', version: '0.81.0' }).map((r) => r.version)).toEqual(['0.81.0', '0.80.1'])
  })
})
