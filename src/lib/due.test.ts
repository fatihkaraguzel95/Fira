import { describe, expect, it } from 'vitest'
import { isOverdue } from './due'

describe('isOverdue', () => {
  const now = new Date(2026, 8, 28, 15, 30) // 28 Eyl 2026, 15:30 yerel

  it('dünden önceki bitiş gecikmiştir', () => {
    expect(isOverdue('2026-09-27', now)).toBe(true)
  })

  it('bugün biten görev gün boyunca gecikmiş değildir', () => {
    expect(isOverdue('2026-09-28', now)).toBe(false)
  })

  it('bitmiş görev tarihi geçse de gecikmiş sayılmaz', () => {
    expect(isOverdue('2026-09-01', now, true)).toBe(false)
  })

  it('tarihsiz görev gecikmiş değildir', () => {
    expect(isOverdue(null, now)).toBe(false)
    expect(isOverdue(undefined, now)).toBe(false)
  })
})
