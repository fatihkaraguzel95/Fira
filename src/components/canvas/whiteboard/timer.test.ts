import { describe, expect, it } from 'vitest'
import { DONE_SHOW_MS, MAX_TIMER_MIN, PAUSED_KEEP_MS, addTime, clampMinutes, formatLeft, pauseTimer, readTimer, resumeTimer, startTimer, timerView } from './timer'
import { readSettings } from './model'

const T0 = 1_760_000_000_000
const MIN = 60_000

describe('the board timer', () => {
  it('starts as "ends at", and every screen counts down to that moment', () => {
    const t = startTimer(5, T0, 'Elif')
    expect(t).toEqual({ state: 'running', endsAt: T0 + 5 * MIN, leftMs: 5 * MIN, totalMs: 5 * MIN, by: 'Elif', at: T0 })
    expect(timerView(t, T0 + 2 * MIN)).toEqual({ phase: 'running', leftMs: 3 * MIN, used: 0.4 })
  })

  it('is "time is up" when it ends, for five minutes, and then gone', () => {
    const t = startTimer(1, T0, 'Elif')
    expect(timerView(t, T0 + MIN).phase).toBe('done')
    expect(timerView(t, T0 + MIN + DONE_SHOW_MS).phase).toBe('done')
    expect(timerView(t, T0 + MIN + DONE_SHOW_MS + 1).phase).toBe('gone')
    expect(timerView(null, T0).phase).toBe('gone')
  })

  it('pausing keeps what is left; resuming counts that much from then', () => {
    const paused = pauseTimer(startTimer(5, T0, 'Elif'), T0 + 2 * MIN, 'Can')
    expect(paused).toMatchObject({ state: 'paused', leftMs: 3 * MIN, endsAt: 0, totalMs: 5 * MIN, by: 'Can' })
    expect(timerView(paused, T0 + 60 * MIN)).toEqual({ phase: 'paused', leftMs: 3 * MIN, used: 0.4 })
    const again = resumeTimer(paused, T0 + 60 * MIN, 'Elif')
    expect(again).toMatchObject({ state: 'running', endsAt: T0 + 63 * MIN })
    expect(timerView(again, T0 + 61 * MIN).leftMs).toBe(2 * MIN)
  })

  it('a pause left for half a day is forgotten', () => {
    const paused = pauseTimer(startTimer(5, T0, 'Elif'), T0 + MIN, 'Elif')
    expect(timerView(paused, T0 + MIN + PAUSED_KEEP_MS).phase).toBe('paused')
    expect(timerView(paused, T0 + MIN + PAUSED_KEEP_MS + 1).phase).toBe('gone')
  })

  it('pausing or resuming in the wrong state changes nothing', () => {
    const run = startTimer(1, T0, 'Elif')
    expect(resumeTimer(run, T0, 'Can')).toBe(run)
    expect(pauseTimer(run, T0 + 2 * MIN, 'Can')).toBe(run)   // already over
    const paused = pauseTimer(run, T0 + 1000, 'Can')
    expect(pauseTimer(paused, T0 + 2000, 'Elif')).toBe(paused)
  })

  it('adds time to a running, a paused and a finished timer', () => {
    const run = startTimer(5, T0, 'Elif')
    const more = addTime(run, 1, T0 + 2 * MIN, 'Can')
    expect(more).toMatchObject({ state: 'running', endsAt: T0 + 6 * MIN, totalMs: 6 * MIN, by: 'Can' })
    const paused = addTime(pauseTimer(run, T0 + 4 * MIN, 'Elif'), 1, T0 + 9 * MIN, 'Can')
    expect(paused).toMatchObject({ state: 'paused', leftMs: 2 * MIN, totalMs: 6 * MIN })
    const over = addTime(run, 1, T0 + 7 * MIN, 'Can')
    expect(over).toEqual({ state: 'running', endsAt: T0 + 8 * MIN, leftMs: MIN, totalMs: MIN, by: 'Can', at: T0 + 7 * MIN })
  })

  it('stays within three hours', () => {
    expect(clampMinutes(0)).toBe(1)
    expect(clampMinutes(999)).toBe(MAX_TIMER_MIN)
    expect(clampMinutes(Number.NaN)).toBe(1)
    const long = addTime(startTimer(MAX_TIMER_MIN, T0, 'Elif'), 10, T0, 'Elif')
    expect(long.endsAt).toBe(T0 + MAX_TIMER_MIN * MIN)
    expect(long.totalMs).toBe(MAX_TIMER_MIN * MIN)
  })

  it('shows the time rounded up, so 0:00 means over', () => {
    expect(formatLeft(5 * MIN)).toBe('5:00')
    expect(formatLeft(4 * MIN + 4_200)).toBe('4:05')
    expect(formatLeft(900)).toBe('0:01')
    expect(formatLeft(0)).toBe('0:00')
    expect(formatLeft(-50)).toBe('0:00')
    expect(formatLeft(62 * MIN + 3000)).toBe('1:02:03')
  })
})

describe('the timer as stored in the scene settings', () => {
  it('survives the round trip', () => {
    const t = startTimer(3, T0, 'Elif')
    expect(readTimer(JSON.parse(JSON.stringify(t)))).toEqual(t)
    expect(readSettings({ bg: '#ffffff', grid: 'none', timer: t }).timer).toEqual(t)
  })
  it('anything that is not a timer is no timer', () => {
    for (const raw of [undefined, null, 'x', 5, [], {}, { state: 'running' }, { state: 'on', endsAt: 1, leftMs: 1, totalMs: 1, at: 1 }, { state: 'running', endsAt: 0, leftMs: 1, totalMs: 1, at: 1 },
      { state: 'paused', endsAt: 0, leftMs: -1, totalMs: 1, at: 1 }, { state: 'paused', endsAt: 0, leftMs: 1, totalMs: 0, at: 1 }, { state: 'paused', endsAt: 0, leftMs: '60000', totalMs: 60000, at: 1 }]) {
      expect(readTimer(raw)).toBeNull()
    }
    expect(readSettings({ timer: null }).timer).toBeNull()
    expect(readSettings(null).timer).toBeNull()
  })
  it('a patch from an older build (no timer in it) leaves the timer alone; a null clears it', () => {
    const t = startTimer(3, T0, 'Elif')
    const cur = readSettings({ timer: t })
    expect(readSettings({ ...cur, ...{ bg: '#000000' } }).timer).toEqual(t)
    expect(readSettings({ ...cur, ...{ timer: null } }).timer).toBeNull()
  })
})
