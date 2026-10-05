/**
 * The board's shared timer (#68c7c4d5): one countdown everybody on the whiteboard sees, as in a
 * retro ("five minutes to write your notes").
 *
 * It lives in the scene's settings (`page_scenes.settings.timer`), the same road the background
 * takes: a change is broadcast to whoever is on the board and saved, so somebody who opens the
 * board later sees the same countdown. Nothing ticks on the server and nothing is sent while it
 * runs: a running timer is "ends at this moment", and every screen counts down to it by itself.
 *
 * Moments are in the server's clock (`lib/serverClock.ts`), not the computer's: two laptops whose
 * clocks differ by a minute would otherwise show different times left.
 *
 * Every field is always a number or a string: the server strips nulls out of settings, and a
 * timer with a hole in it would be read as broken.
 */
export interface WbTimer {
  state: 'running' | 'paused'
  /** running: the moment it ends; paused: 0 */
  endsAt: number
  /** what was left when `at` was written (paused: what is left) */
  leftMs: number
  /** the whole length, for the progress line; grows when time is added */
  totalMs: number
  /** who set it last */
  by: string
  /** when it was set */
  at: number
}

export const TIMER_PRESETS_MIN = [1, 2, 3, 5, 10, 15]
export const MAX_TIMER_MIN = 180
const MAX_MS = MAX_TIMER_MIN * 60_000
/** A finished timer stays on screen this long ("time is up"), then it is gone for everybody. */
export const DONE_SHOW_MS = 5 * 60_000
/** A timer left paused is forgotten after this long: nobody wants last week's pause on the board. */
export const PAUSED_KEEP_MS = 12 * 3_600_000

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** What is stored, made safe; null when there is no timer or it is not one. */
export function readTimer(raw: unknown): WbTimer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const state = r.state === 'running' || r.state === 'paused' ? r.state : null
  const endsAt = num(r.endsAt), leftMs = num(r.leftMs), totalMs = num(r.totalMs), at = num(r.at)
  if (!state || endsAt === null || leftMs === null || totalMs === null || at === null) return null
  if (totalMs <= 0 || leftMs < 0 || (state === 'running' && endsAt <= 0)) return null
  return { state, endsAt, leftMs: Math.min(leftMs, MAX_MS), totalMs: Math.min(totalMs, MAX_MS), by: typeof r.by === 'string' ? r.by.slice(0, 80) : '', at }
}

export const clampMinutes = (m: number) => Math.min(MAX_TIMER_MIN, Math.max(1, Math.round(Number.isFinite(m) ? m : 1)))

export function startTimer(minutes: number, now: number, by: string): WbTimer {
  const ms = clampMinutes(minutes) * 60_000
  return { state: 'running', endsAt: now + ms, leftMs: ms, totalMs: ms, by, at: now }
}

export type TimerPhase = 'running' | 'paused' | 'done' | 'gone'
/** What a screen shows at `now`: the phase, the time left and how much of the whole is used (0…1). */
export function timerView(t: WbTimer | null, now: number): { phase: TimerPhase; leftMs: number; used: number } {
  if (!t) return { phase: 'gone', leftMs: 0, used: 0 }
  if (t.state === 'paused') {
    if (now - t.at > PAUSED_KEEP_MS) return { phase: 'gone', leftMs: 0, used: 0 }
    return { phase: 'paused', leftMs: t.leftMs, used: used(t.totalMs, t.leftMs) }
  }
  const left = t.endsAt - now
  if (left > 0) return { phase: 'running', leftMs: Math.min(left, MAX_MS), used: used(t.totalMs, left) }
  return { phase: -left > DONE_SHOW_MS ? 'gone' : 'done', leftMs: 0, used: 1 }
}
const used = (total: number, left: number) => Math.min(1, Math.max(0, 1 - left / total))

/** Pausing keeps what is left; a timer that is not running (or is already over) stays as it is. */
export function pauseTimer(t: WbTimer, now: number, by: string): WbTimer {
  if (t.state !== 'running' || t.endsAt <= now) return t
  return { ...t, state: 'paused', leftMs: t.endsAt - now, endsAt: 0, by, at: now }
}

export function resumeTimer(t: WbTimer, now: number, by: string): WbTimer {
  if (t.state !== 'paused') return t
  return { ...t, state: 'running', endsAt: now + t.leftMs, by, at: now }
}

/** More time: on a running or paused timer it is added; on one that is over, it starts again with just that much. */
export function addTime(t: WbTimer, minutes: number, now: number, by: string): WbTimer {
  const ms = clampMinutes(minutes) * 60_000
  if (t.state === 'paused') {
    const leftMs = Math.min(MAX_MS, t.leftMs + ms)
    return { ...t, leftMs, totalMs: Math.min(MAX_MS, t.totalMs + (leftMs - t.leftMs)), by, at: now }
  }
  const left = t.endsAt - now
  if (left <= 0) return { state: 'running', endsAt: now + ms, leftMs: ms, totalMs: ms, by, at: now }
  const next = Math.min(MAX_MS, left + ms)
  return { ...t, endsAt: now + next, leftMs: next, totalMs: Math.min(MAX_MS, t.totalMs + (next - left)), by, at: now }
}

/** "4:05", "12:00", "1:02:03". Rounded up: a timer shows 0:01 until it is really over. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}
