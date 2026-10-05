import { describe, expect, it } from 'vitest'
import { offsetFrom } from './serverClock'

describe('offsetFrom', () => {
  const header = 'Fri, 02 Oct 2026 19:00:00 GMT'
  const stamped = Date.parse(header)
  it('is zero when the clocks agree (the header is the second that is half over)', () => {
    expect(offsetFrom(header, stamped + 400, stamped + 600)).toBe(0)
  })
  it('says how far the server is ahead of a computer that runs late, and behind one that runs early', () => {
    expect(offsetFrom(header, stamped - 60_000 + 450, stamped - 60_000 + 550)).toBe(60_000)
    expect(offsetFrom(header, stamped + 90_000 + 500, stamped + 90_000 + 500)).toBe(-90_000)
  })
  it('takes the middle of a slow round trip', () => {
    expect(offsetFrom(header, stamped - 1500, stamped + 2500)).toBe(0)
  })
  it('is unknown without a readable header, or when the answer is a day off (a cache answering)', () => {
    expect(offsetFrom(null, 0, 1)).toBeNull()
    expect(offsetFrom('yesterday-ish', 0, 1)).toBeNull()
    expect(offsetFrom(header, stamped + 2 * 86_400_000, stamped + 2 * 86_400_000 + 10)).toBeNull()
    expect(offsetFrom(header, stamped + 10, stamped)).toBeNull()
  })
})
