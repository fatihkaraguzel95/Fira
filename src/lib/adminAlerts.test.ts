import { describe, expect, it } from 'vitest'
import { ADMIN_ALERT_SNOOZE_MS, isSnoozed, snoozeFrom, snoozeLeft } from './adminAlerts'

const T0 = Date.UTC(2026, 8, 29, 9, 0)
const MIN = 60 * 1000

describe('admin alert snooze', () => {
  it('hides a dismissed warning for one hour, then shows it again', () => {
    const s = snoozeFrom(T0, 'warn')
    expect(isSnoozed(s, 'warn', T0 + 1)).toBe(true)
    expect(isSnoozed(s, 'warn', T0 + 59 * MIN)).toBe(true)
    expect(isSnoozed(s, 'warn', T0 + ADMIN_ALERT_SNOOZE_MS)).toBe(false)
    expect(isSnoozed(s, 'warn', T0 + 2 * ADMIN_ALERT_SNOOZE_MS)).toBe(false)
  })

  it('comes back at once when a warning turns into danger', () => {
    const s = snoozeFrom(T0, 'warn')
    expect(isSnoozed(s, 'danger', T0 + 10 * MIN)).toBe(false)
  })

  it('a dismissed danger stays hidden for the hour, and so does a later warning', () => {
    const s = snoozeFrom(T0, 'danger')
    expect(isSnoozed(s, 'danger', T0 + 10 * MIN)).toBe(true)
    expect(isSnoozed(s, 'warn', T0 + 10 * MIN)).toBe(true)
  })

  it('treats a missing or broken record as not snoozed', () => {
    expect(isSnoozed(null, 'warn', T0)).toBe(false)
    expect(isSnoozed(undefined, 'danger', T0)).toBe(false)
    expect(isSnoozed({ until: 'x', level: 'warn' }, 'warn', T0)).toBe(false)
  })

  it('reports the time left', () => {
    const s = snoozeFrom(T0, 'warn')
    expect(snoozeLeft(s, T0 + 15 * MIN)).toBe(45 * MIN)
    expect(snoozeLeft(s, T0 + 2 * ADMIN_ALERT_SNOOZE_MS)).toBe(0)
    expect(snoozeLeft(null, T0)).toBe(0)
  })
})
