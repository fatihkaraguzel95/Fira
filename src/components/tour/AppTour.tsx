import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildTourSteps, continueTour, endTour, isTourOpen, startTour, subscribeTour, ticketWindowOpen, tourChapter, type TourStep } from '../../lib/tour'
import { openTicket } from '../../lib/nav'
import { isEditableTarget } from '../../lib/keys'
import { usePrefs } from '../../hooks/usePrefs'
import { useT } from '../../i18n'

/**
 * The product tour overlay. When open it dims the app, spotlights the element a
 * step points at (via a big box-shadow "hole"), and floats a card next to it;
 * steps with no on-screen target show a centered card instead. A transparent
 * full-screen catcher swallows clicks so the tour drives the flow — next / back
 * / skip, plus arrow keys and Esc.
 *
 * The step list comes from buildTourSteps(): fixed onboarding steps followed by
 * the latest release's features, so shipping a feature adds it to the tour.
 *
 * Bölümler (#ab88c8f5): ana ekran bölümünün son adımında "Görev penceresine geç"
 * ekrandaki ilk görevi (pano kartı ya da liste satırı) açar ve görev penceresi
 * bölümüyle sürer. Görev açıkken başlatılan tur o bölümle başlar; görev bölümü
 * kişinin ilk görev açışında bir kez kendiliğinden de gelir (`tourTicketDoneV1`).
 */
const CARD_W = 340
const PAD = 8 // spotlight padding around the target
const GAP = 12 // gap between target and card

interface Rect { top: number; left: number; width: number; height: number }

/** Görev bölümüne geçerken açılacak görev: ekrandaki ilk pano kartı ya da liste satırı. */
const firstTicketOnScreen = () =>
  document.querySelector<HTMLElement>('[data-board-card][data-ticket-id], [data-list-view] tr[data-ticket-id]')?.dataset.ticketId ?? null

const ticketWindowReady = () => !!document.querySelector('[data-ticket-window] [data-tour="ticket-props"]')

/**
 * Pencere içeriği (özellikler) gelene kadar bekle; gelmezse false. Geldikten sonra
 * kısa bir süre daha: "Claude'a yaptır" gibi ayrı sorguyla gelen parçalar da
 * yerleşsin, isteğe bağlı adımlar ona göre süzülsün.
 */
async function waitForTicketWindow(ms = 8000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 150) {
    if (ticketWindowReady()) { await new Promise((r) => setTimeout(r, 800)); return true }
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

function readTarget(selector?: string): Rect | null {
  if (!selector) return null
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return null
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
  const r = el.getBoundingClientRect()
  // Off-screen or collapsed (mobile drawer closed, hidden element) → treat as centered.
  if (r.width < 4 || r.height < 4) return null
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function AppTour() {
  // `t` is already taken below (the re-measure timeout), so the hook is `tr`.
  const tr = useT()
  const [open, setOpen] = useState(isTourOpen())
  const [steps, setSteps] = useState<TourStep[]>([])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardH, setCardH] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const prefs = usePrefs('global')
  const prefsRef = useRef(prefs); prefsRef.current = prefs
  const [chapter, setChapter] = useState(tourChapter())

  useEffect(() => subscribeTour(() => {
    const nowOpen = isTourOpen()
    const ch = tourChapter()
    setOpen(nowOpen)
    setChapter(ch)
    setIndex(0)
    setSteps([])
    if (!nowOpen) return
    // Adımlar sürüm notlarıyla birlikte tembel iner; gelene kadar tur hiçbir şey çizmez.
    if (ch.chapter === 'app') {
      void buildTourSteps('app').then((next) => { if (isTourOpen() && tourChapter().chapter === 'app') setSteps(next) })
      return
    }
    // Görev bölümü: pencere dolunca, hedefi olmayan isteğe bağlı adımlar düşer.
    const p = prefsRef.current
    if ((p.prefs as { tourTicketDoneV1?: boolean }).tourTicketDoneV1 !== true) p.patch({ v: 1, tourTicketDoneV1: true })
    void Promise.all([buildTourSteps('ticket'), waitForTicketWindow()]).then(([next, ready]) => {
      if (!isTourOpen() || tourChapter().chapter !== 'ticket') return
      if (!ready) { endTour(); return }
      setSteps(next.filter((st) => !st.optional || !st.target || document.querySelector(st.target)))
    })
  }), [])

  // Görev bölümü ilk görev açışında bir kez kendiliğinden (#ab88c8f5): pencere
  // dolmuş, başka tur yok ve kişi bir alana yazmıyorsa.
  const ticketTourSeen = (prefs.prefs as { tourTicketDoneV1?: boolean }).tourTicketDoneV1 === true
  const onTicket = location.pathname.startsWith('/ticket/')
  useEffect(() => {
    if (!onTicket || !prefs.loaded || ticketTourSeen) return
    // İçerik gelene kadar yokla (yavaş ağda saniyeler sürebilir), geldikten sonra
    // bir buçuk saniye bekle: kişi pencereye bir göz atsın.
    let readyAt = 0
    const h = window.setInterval(() => {
      if (isTourOpen()) { window.clearInterval(h); return }
      if (!ticketWindowOpen() || !ticketWindowReady()) { readyAt = 0; return }
      if (!readyAt) { readyAt = Date.now(); return }
      if (Date.now() - readyAt < 1500 || isEditableTarget(document.activeElement)) return
      window.clearInterval(h)
      startTour('ticket')
    }, 300)
    const stop = window.setTimeout(() => window.clearInterval(h), 20000)
    return () => { window.clearInterval(h); window.clearTimeout(stop) }
  }, [onTicket, prefs.loaded, ticketTourSeen, location.pathname])

  const step: TourStep | undefined = steps[index]
  const total = steps.length
  const close = useCallback(() => { endTour() }, [])
  const next = useCallback(() => setIndex((i) => (i + 1 < total ? i + 1 : i)), [total])
  const prev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : i)), [])
  const isLast = index >= total - 1
  // Ana ekran bölümünün sonu: ekranda açılacak bir görev varsa görev penceresine geçilebilir.
  const forkTo = open && chapter.chapter === 'app' && isLast && total > 0 ? firstTicketOnScreen() : null
  const toTicketChapter = useCallback(() => {
    const id = firstTicketOnScreen()
    if (!id) { endTour(); return }
    openTicket(navigate, id)
    continueTour('ticket')
  }, [navigate])

  // Re-measure the spotlight target on step change, and while the layout moves.
  useLayoutEffect(() => {
    if (!open || !step) return
    const measure = () => setRect(readTarget(step.target))
    measure()
    // A second pass after scrollIntoView settles.
    const t = window.setTimeout(measure, 220)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [open, step, index])

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight)
  }, [index, rect, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (isLast) { if (forkTo) toTicketChapter(); else close() } else next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, isLast, next, prev, close, forkTo, toTicketChapter])

  if (!open || !step) return null

  // Onboarding copy comes from the dictionary; release notes come through as they
  // were written and are not translated.
  const stepTitle = step.titleKey ? tr(step.titleKey, step.vars) : step.title ?? ''
  const stepBody = step.bodyKey ? tr(step.bodyKey, step.vars) : step.body ?? ''

  const vw = window.innerWidth
  const vh = window.innerHeight
  const cardW = Math.min(CARD_W, vw - 2 * PAD)

  // Card position: next to the target if there's room, otherwise centered.
  let cardStyle: React.CSSProperties
  if (rect) {
    const spaceBelow = vh - (rect.top + rect.height)
    const below = spaceBelow > cardH + GAP + PAD || spaceBelow > rect.top
    const top = below ? rect.top + rect.height + GAP : Math.max(PAD, rect.top - cardH - GAP)
    const left = Math.min(Math.max(PAD, rect.left), vw - cardW - PAD)
    cardStyle = { top, left, width: cardW }
  } else {
    cardStyle = { top: '50%', left: '50%', width: cardW, transform: 'translate(-50%, -50%)' }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9990]" role="dialog" aria-modal="true" aria-label={tr('misc.tour.label')}>
      {/* Click catcher — transparent, swallows interaction with the app behind. */}
      <div className="absolute inset-0" onClick={close} />

      {/* Spotlight. The dim used to be one box-shadow spread, but a box-shadow
          cannot be blurred — and in dark mode dimming alone barely separated the
          target from the app. So the surround is painted by four panels around
          the hole, each blurring what is behind it; the target stays sharp. */}
      {rect ? (
        (() => {
          const hx = rect.left - PAD, hy = rect.top - PAD
          const hw = rect.width + PAD * 2, hh = rect.height + PAD * 2
          const scrim = 'absolute pointer-events-none bg-[rgba(15,23,42,0.55)] backdrop-blur-[3px] transition-all duration-200'
          return (
            <>
              <div className={scrim} style={{ left: 0, right: 0, top: 0, height: Math.max(0, hy) }} />
              <div className={scrim} style={{ left: 0, right: 0, top: hy + hh, bottom: 0 }} />
              <div className={scrim} style={{ left: 0, top: hy, width: Math.max(0, hx), height: hh }} />
              <div className={scrim} style={{ left: hx + hw, right: 0, top: hy, height: hh }} />
              {/* Ring + soft halo so the sharp area reads as "focus", not as a gap */}
              <div
                className="absolute rounded-xl ring-2 ring-primary-400 transition-all duration-200 pointer-events-none"
                style={{ top: hy, left: hx, width: hw, height: hh, boxShadow: '0 0 0 4px rgba(129,140,248,0.25)' }}
              />
            </>
          )
        })()
      ) : (
        <div className="absolute inset-0 bg-[rgba(15,23,42,0.55)] backdrop-blur-[3px] pointer-events-none" />
      )}

      {/* Step card */}
      <div
        ref={cardRef}
        className="absolute bg-surface border border-line rounded-xl shadow-2xl p-4 animate-fade-in"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {step.kind === 'whatsnew' && (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400 mb-1.5">
            <Icon name="sparkle" />
            {tr('misc.tour.new')}
          </span>
        )}
        <h2 className="text-sm font-semibold text-fg mb-1">{stepTitle}</h2>
        {stepBody && <p className="text-sm text-fg-muted leading-relaxed break-words">{stepBody}</p>}

        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3 mt-4">
          <div className="flex items-center gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-primary-500' : 'w-1.5 bg-line'}`} />
            ))}
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={close} data-tour-close className="text-xs text-fg-muted hover:text-fg-2 px-2 py-1.5 rounded-lg hover:bg-raised transition-colors">
              {forkTo ? tr('misc.tour.finish') : isLast ? tr('common.close') : tr('misc.tour.skip')}
            </button>
            {index > 0 && (
              <button onClick={prev} className="text-xs font-medium text-fg-2 px-2.5 py-1.5 rounded-lg hover:bg-raised transition-colors">{tr('common.back')}</button>
            )}
            <button
              onClick={() => (forkTo ? toTicketChapter() : isLast ? close() : next())}
              data-tour-next
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors whitespace-nowrap"
            >
              {forkTo ? tr('misc.tour.toTicket') : isLast ? tr('misc.tour.finish') : tr('common.next')}
            </button>
          </div>
        </div>
        {forkTo && <p className="text-xs text-fg-muted mt-3">{tr('misc.tour.toTicketHint')}</p>}
        <p className="text-2xs text-fg-faint mt-2 tabular-nums text-right" data-tour-progress>
          {chapter.chapter === 'ticket' && <span className="mr-1.5">{tr('misc.tour.ticketChapter')}{' ·'}</span>}
          {index + 1} / {total}
        </p>
      </div>
    </div>,
    document.body,
  )
}
