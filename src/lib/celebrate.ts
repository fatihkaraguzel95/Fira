import { confettiInCard, type ConfettiKind } from './celebrate/confetti'

/**
 * A small moment when a task is finished: a short two-note chime the instant
 * it happens, and a "checked" animation drawn exactly over the status dot the
 * user acted on — the tick lands on the indicator's own tick, the rings grow
 * out of it. When there is no dot (the board card: its column is the status)
 * the check plays over the card.
 * No assets: the sound is synthesised, the check is an inline SVG animated
 * with the Web Animations API.
 *
 * The user's switch (settings → Appearance) turns the whole thing off. The
 * animation is feedback on an action, not decoration, so it does not follow
 * the OS "reduce motion" hint.
 */

const KEY = 'fira.celebrate'
const KIND_KEY = 'fira.celebrate.confetti'
let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } })()
let kind: ConfettiKind = (() => { try { return localStorage.getItem(KIND_KEY) === 'a' ? 'a' : 'b' } catch { return 'b' } })()

export const isCelebrationEnabled = () => enabled
export function setCelebrationEnabled(on: boolean) {
  enabled = on
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
}

/**
 * Cards that are celebrating right now. A board that hides completed tasks
 * dropped the card the instant the server answered, cutting the confetti off
 * mid-air (#6228C4EB): the board keeps such a card for as long as it is in
 * here, then fades it out.
 */
const celebrating = new Map<string, number>()
const leaving = new Set<string>()
const watchers = new Set<() => void>()
const CELEBRATION_MS = 2600
/** How long the card then takes to fade out, in step with `animate-fade-out`. */
const LEAVE_MS = 340

const ping = () => watchers.forEach((w) => w())

export function subscribeCelebrating(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn) } }
/** True while the card should stay on the board: the confetti, then the fade. */
export const isCelebrating = (id: string) => celebrating.has(id) || leaving.has(id)
/** True for the short fade at the end — the card is on its way out. */
export const isLeavingAfterCelebration = (id: string) => leaving.has(id)

const markCelebrating = (id: string) => {
  window.clearTimeout(celebrating.get(id))
  leaving.delete(id)
  celebrating.set(id, window.setTimeout(() => {
    celebrating.delete(id)
    leaving.add(id)
    ping()
    window.setTimeout(() => { leaving.delete(id); ping() }, LEAVE_MS)
  }, CELEBRATION_MS))
  ping()
}

/** Which confetti plays on a card; the two files the user picked between (#6228C4EB). */
export const celebrationKind = () => kind
export function setCelebrationKind(next: ConfettiKind) {
  kind = next
  try { localStorage.setItem(KIND_KEY, next) } catch { /* ignore */ }
}

// ─── Sound ───────────────────────────────────────────────────────────────────
// Browsers only let audio start inside a user gesture, and creating the
// context on the very first celebration adds a noticeable delay. So the
// context is created (and resumed) on the first gesture anywhere in the app,
// long before it is needed; the chime itself then schedules at `currentTime`.
let audio: AudioContext | null = null
function ensureAudio() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    audio ??= new Ctx()
    if (audio.state === 'suspended') void audio.resume()
    return audio
  } catch { return null }
}
if (typeof window !== 'undefined') {
  const warm = () => { ensureAudio(); window.removeEventListener('pointerdown', warm, true); window.removeEventListener('keydown', warm, true) }
  window.addEventListener('pointerdown', warm, true)
  window.addEventListener('keydown', warm, true)
}

/** Tick starts drawing this many ms after the disc pops (see checkOver). */
const TICK_AT_MS = 160

/**
 * Two-note "ding". Returns how many ms the picture should wait so that the
 * high (peak) note reaches the ear exactly when the tick starts to draw.
 *
 * Notes are scheduled a little ahead of `currentTime`: a note placed at (or
 * before) the current time starts late and loses its attack, which is what
 * made the chime sound clipped. The picture waits for the sound, never the
 * other way round — a delayed picture is invisible, a clipped sound is not.
 */
function chime(): number {
  const ctx = ensureAudio()
  if (!ctx) return 0
  let wait = 0
  const tone = (freq: number, at: number, level: number, length: number, type: OscillatorType = 'sine') => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.linearRampToValueAtTime(level, at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + length + 0.05)
  }
  const play = () => {
    const latency = (ctx.baseLatency ?? 0) + ((ctx as unknown as { outputLatency?: number }).outputLatency ?? 0)
    const base = ctx.currentTime + 0.03
    const peak = base + 0.09
    tone(880, base, 0.12, 0.3)
    tone(1318.5, peak, 0.18, 0.6)
    tone(2637, peak, 0.035, 0.35, 'triangle')   // faint octave: presence on laptop speakers
    wait = Math.max(0, Math.round((peak - ctx.currentTime + latency) * 1000 - TICK_AT_MS))
  }
  // A suspended context (autoplay policy) starts only after resume(); scheduling
  // before that made the notes play whenever the context woke up — late.
  if (ctx.state === 'running') play()
  else void ctx.resume().then(play, () => undefined)
  return wait
}

// ─── Check animation ─────────────────────────────────────────────────────────
const SVG_NS = 'http://www.w3.org/2000/svg'
const el = (tag: string, attrs: Record<string, string>) => {
  const n = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  return n
}

/**
 * Draws the check over `target`. The disc has exactly the target's diameter
 * and the tick uses the same proportions as StatusIndicator's done state
 * (0.30/0.52 → 0.45/0.66 → 0.71/0.36 of the box), so once the animation
 * settles it sits pixel for pixel on the indicator underneath. Two rings
 * expand out of the disc to make the moment visible from across the screen.
 */
function checkOver(target: Element, color: string, dotOverride?: number) {
  const r = target.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return
  const d = dotOverride ?? Math.min(r.width, r.height)   // dot diameter in px
  const size = Math.max(d * 4.5, 64)                      // overlay edge in px
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2

  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }) as SVGSVGElement
  svg.style.cssText = `position:fixed;left:${cx - size / 2}px;top:${cy - size / 2}px;width:${size}px;height:${size}px;pointer-events:none;z-index:95;overflow:visible`

  const c = size / 2
  const rad = d / 2 - 1.5                                  // StatusIndicator: r = s/2 - 1.5
  const ring = el('circle', { cx: `${c}`, cy: `${c}`, r: `${rad}`, fill: 'none', stroke: color, 'stroke-width': '2.5' })
  const ring2 = el('circle', { cx: `${c}`, cy: `${c}`, r: `${rad}`, fill: 'none', stroke: color, 'stroke-width': '1.75' })
  const disc = el('circle', { cx: `${c}`, cy: `${c}`, r: `${rad}`, fill: color })
  // Same points as StatusIndicator's done tick, relative to a box of the dot's size.
  const p = (fx: number, fy: number) => `${c + (fx - 0.5) * d} ${c + (fy - 0.5) * d}`
  const check = el('path', {
    d: `M${p(0.30, 0.52)} L${p(0.45, 0.66)} L${p(0.71, 0.36)}`,
    fill: 'none', stroke: '#fff', 'stroke-width': `${Math.max(2, d * 0.13)}`, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  })
  const len = d * 0.75
  check.style.strokeDasharray = `${len}`
  check.style.strokeDashoffset = `${len}`

  svg.append(ring, ring2, disc, check)
  document.body.appendChild(svg)

  const pop = 'cubic-bezier(.2,.9,.3,1.3)'
  const origin = { transformOrigin: `${c}px ${c}px` }
  disc.animate(
    [{ transform: 'scale(0)', ...origin }, { transform: 'scale(1.25)', ...origin, offset: 0.55 }, { transform: 'scale(1)', ...origin }],
    { duration: 480, easing: pop, fill: 'forwards' },
  )
  check.animate(
    [{ strokeDashoffset: len, opacity: 0 }, { strokeDashoffset: len, opacity: 1, offset: 0.2 }, { strokeDashoffset: 0, opacity: 1 }],
    { duration: 520, delay: TICK_AT_MS, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
  )
  ring.animate(
    [{ transform: 'scale(1)', ...origin, opacity: 0.9 }, { transform: 'scale(3.2)', ...origin, opacity: 0 }],
    { duration: 850, delay: 40, easing: 'ease-out', fill: 'forwards' },
  )
  ring2.animate(
    [{ transform: 'scale(1)', ...origin, opacity: 0.7 }, { transform: 'scale(2.3)', ...origin, opacity: 0 }],
    { duration: 850, delay: 260, easing: 'ease-out', fill: 'forwards' },
  )
  svg.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1400, fill: 'forwards' })
  window.setTimeout(() => svg.remove(), 1450)
}

/**
 * Celebrate a ticket reaching a done state.
 * - `color`: the new status colour.
 * - `origin`: the element the user acted on. When given, the animation plays
 *   there and nowhere else — a card behind an open modal stays quiet.
 * - Without an origin (a drag on the board) every element tagged
 *   data-ticket-id="<id>" plays: over its status dot if it has one, over the
 *   element itself (the card) if it does not.
 */
export function celebrateTicket(ticketId: string, color = '#22c55e', origin?: Element | null) {
  if (!enabled) return
  markCelebrating(ticketId)
  const wait = chime() // first: the sound must land on the click, not after the DOM work

  const dotOf = (host: Element) => (host.matches('[data-status-dot]') ? host : host.querySelector('[data-status-dot]'))
  // A status dot gets the tick drawn exactly over it; anything else (a board
  // card, whose column *is* the status) gets confetti inside its own border —
  // the old oversized check sat on the card's title and spilled out (#6228C4EB).
  const play = (host: Element) => {
    const dot = dotOf(host)
    if (dot) checkOver(dot, color)
    else if (host instanceof HTMLElement) confettiInCard(host, kind, host.dataset.ticketId)
  }
  // A board drop re-renders the column the instant the card lands, and the
  // card can be missing from the DOM for a frame or two — the celebration then
  // found nothing and silently did nothing. So look again on the next frames.
  const draw = (tries = 6) => {
    if (origin) { play(origin); return }
    const hosts = document.querySelectorAll(`[data-ticket-id="${CSS.escape(ticketId)}"]`)
    if (hosts.length === 0) {
      if (tries > 0) requestAnimationFrame(() => draw(tries - 1))
      return
    }
    // One card can be on screen twice (board + open window); each plays once.
    const seen = new Set<Element>()
    for (const host of hosts) {
      if (seen.has(host)) continue
      seen.add(host)
      play(host)
    }
  }
  if (wait > 0) window.setTimeout(() => draw(), wait)
  else draw()
}

// Exposed for browser QA (like __firaBackup): plays the real celebration for a
// card id, so the board path can be checked without a drag.
;(window as unknown as { __firaCelebrate?: unknown }).__firaCelebrate = celebrateTicket
