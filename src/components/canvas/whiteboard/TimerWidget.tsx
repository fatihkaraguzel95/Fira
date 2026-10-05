import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { Icon, SectionLabel } from './ui'
import { MAX_TIMER_MIN, TIMER_PRESETS_MIN, addTime, clampMinutes, formatLeft, pauseTimer, resumeTimer, timerView, type WbTimer } from './timer'

/**
 * The board timer on screen (#68c7c4d5): the countdown everybody sees, and what starts it.
 *
 * The countdown keeps its own clock tick: the board around it holds every element of the scene and
 * must not be drawn again four times a second because a number changed.
 */

/** Three soft notes when the time is up. Silent when the browser has not let the page make sound yet. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const note = (at: number, freq: number) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.4)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + 0.45)
    }
    note(0, 784); note(0.5, 784); note(1, 1047)
    window.setTimeout(() => { void ctx.close().catch(() => {}) }, 2200)
  } catch { /* no sound, the screen still says it */ }
}

export function TimerPill({ timer, now, canWrite, muted, onMute, onChange, me }: {
  timer: WbTimer
  now: () => number
  canWrite: boolean
  muted: boolean
  onMute: (muted: boolean) => void
  onChange: (next: WbTimer | null) => void
  me: string
}) {
  const t = useT()
  const [, setTick] = useState(0)
  const view = timerView(timer, now())
  // Only a running timer needs the clock; a finished one is looked at again when its five minutes are over.
  useEffect(() => {
    if (view.phase !== 'running' && view.phase !== 'done') return
    const id = window.setInterval(() => setTick((n) => n + 1), view.phase === 'running' ? 250 : 5000)
    return () => window.clearInterval(id)
  }, [view.phase])
  // The sound belongs to the moment it ends on this screen, not to opening a board whose timer is already over.
  const before = useRef(view.phase)
  const mutedRef = useRef(muted); mutedRef.current = muted
  useEffect(() => {
    if (before.current === 'running' && view.phase === 'done' && !mutedRef.current) chime()
    before.current = view.phase
  }, [view.phase])

  if (view.phase === 'gone') return null
  const done = view.phase === 'done', paused = view.phase === 'paused'
  const btn = 'w-9 h-9 flex items-center justify-center rounded-lg text-fg-2 hover:text-fg hover:bg-raised focus-visible:ring-2 focus-visible:ring-primary-500 outline-none cursor-pointer'
  return (
    <div
      data-wb-chrome
      data-wb-timer={view.phase}
      className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 overflow-hidden rounded-xl border px-2 py-1 shadow-lg backdrop-blur ${done ? 'border-danger/50 bg-surface' : 'border-line bg-surface/95'}`}
      // The board takes Space for panning and single letters for tools: keys pressed on these buttons stay here.
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Icon name="timer" className={`w-5 h-5 flex-shrink-0 ${done ? 'text-danger' : 'text-fg-muted'}`} />
      <div className="px-1 leading-tight">
        <p role="timer" aria-label={t('wb.timer.left', { time: formatLeft(view.leftMs) })} data-wb-timer-left
          className={`text-xl font-semibold tabular-nums ${done ? 'text-danger motion-safe:animate-pulse' : paused ? 'text-fg-muted' : 'text-fg'}`}>
          {formatLeft(view.leftMs)}
        </p>
        {(done || paused) && <p className={`text-xs ${done ? 'text-danger' : 'text-fg-muted'}`} role={done ? 'status' : undefined}>{done ? t('wb.timer.done') : t('wb.timer.paused')}</p>}
      </div>
      {canWrite && (
        <>
          {!done && (
            <button type="button" className={btn} data-wb-timer-toggle
              title={paused ? t('wb.timer.resume') : t('wb.timer.pause')} aria-label={paused ? t('wb.timer.resume') : t('wb.timer.pause')}
              onClick={() => onChange(paused ? resumeTimer(timer, now(), me) : pauseTimer(timer, now(), me))}>
              <Icon name={paused ? 'play' : 'pause'} className="w-4 h-4" />
            </button>
          )}
          <button type="button" className={`${btn} w-auto px-2 text-sm font-medium tabular-nums`} data-wb-timer-add
            title={t('wb.timer.addMinute')} aria-label={t('wb.timer.addMinute')}
            onClick={() => onChange(addTime(timer, 1, now(), me))}>
            +1
          </button>
        </>
      )}
      <button type="button" className={btn} data-wb-timer-mute aria-pressed={muted}
        title={muted ? t('wb.timer.unmute') : t('wb.timer.mute')} aria-label={muted ? t('wb.timer.unmute') : t('wb.timer.mute')}
        onClick={() => onMute(!muted)}>
        <Icon name={muted ? 'soundOff' : 'sound'} className="w-4 h-4" />
      </button>
      {canWrite && (
        <button type="button" className={btn} data-wb-timer-stop title={t('wb.timer.stop')} aria-label={t('wb.timer.stop')} onClick={() => onChange(null)}>
          <Icon name="close" className="w-4 h-4" />
        </button>
      )}
      {/* How much of the time is used: a line along the bottom edge. */}
      {!done && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-line-soft" aria-hidden>
          <span className={`block h-full ${paused ? 'bg-fg-faint' : 'bg-primary-500'}`} style={{ width: `${Math.round(view.used * 1000) / 10}%` }} />
        </span>
      )}
    </div>
  )
}

/** What starts a timer: the usual lengths one click away, any other length with the two steppers. */
export function TimerStart({ onStart }: { onStart: (minutes: number) => void }) {
  const t = useT()
  const [minutes, setMinutes] = useState(5)
  const step = 'w-9 h-9 flex items-center justify-center rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-40 cursor-pointer'
  return (
    <div data-wb-timer-start onKeyDown={(e) => e.stopPropagation()}>
      <SectionLabel>{t('wb.timer.title')}</SectionLabel>
      <p className="text-xs text-fg-muted px-0.5 pb-2">{t('wb.timer.hint')}</p>
      <div className="grid grid-cols-3 gap-1">
        {TIMER_PRESETS_MIN.map((m) => (
          <button key={m} type="button" onClick={() => onStart(m)} data-wb-timer-preset={m}
            className="h-9 rounded-lg border border-line-soft text-sm text-fg-2 hover:bg-raised hover:text-fg tabular-nums cursor-pointer">
            {t('wb.timer.minutes', { n: m })}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 border-t border-line-soft pt-2">
        <button type="button" className={step} disabled={minutes <= 1} onClick={() => setMinutes((m) => clampMinutes(m - 1))} aria-label={t('wb.timer.less')} title={t('wb.timer.less')} data-wb-timer-less>
          <Icon name="zoomOut" className="w-4 h-4" />
        </button>
        <span className="min-w-[4rem] text-center text-sm font-medium tabular-nums text-fg" data-wb-timer-minutes>{t('wb.timer.minutes', { n: minutes })}</span>
        <button type="button" className={step} disabled={minutes >= MAX_TIMER_MIN} onClick={() => setMinutes((m) => clampMinutes(m + 1))} aria-label={t('wb.timer.more')} title={t('wb.timer.more')} data-wb-timer-more>
          <Icon name="zoomIn" className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => onStart(minutes)} data-wb-timer-go
          className="ml-auto h-9 px-3 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 cursor-pointer">
          {t('wb.timer.start')}
        </button>
      </div>
    </div>
  )
}
