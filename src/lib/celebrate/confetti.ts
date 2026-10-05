/**
 * Confetti for a finished task, played **inside** the card (#6228C4EB).
 *
 * The old card celebration drew the status check at 4.5× the dot's size over
 * the middle of the card, which landed on the title and spilled out of the
 * card's border. The user picked two Lottie files instead; both are bundled
 * and one is chosen in Görünüm (settings). Either way the animation is clipped by the
 * card: particles fly past the edges (the canvas is deliberately larger than
 * the card) and are cut off at the rounded border — it looks like it would
 * overflow, and it never does.
 *
 * The player (lottie-web, light SVG build) and the animation JSON are loaded
 * the first time a celebration plays, not with the app.
 */
export type ConfettiKind = 'a' | 'b'

type Anim = { destroy(): void; addEventListener(e: string, cb: () => void): void }
type Player = {
  loadAnimation(opts: {
    container: Element
    renderer: 'svg'
    loop: boolean
    autoplay: boolean
    animationData: unknown
    rendererSettings?: { preserveAspectRatio?: string; progressiveLoad?: boolean }
  }): Anim
}

let player: Promise<Player> | null = null
const data: Partial<Record<ConfettiKind, Promise<unknown>>> = {}

const loadPlayer = () => (player ??= import('lottie-web/build/player/lottie_light').then((m) => (m.default ?? m) as unknown as Player))
const loadData = (kind: ConfettiKind) =>
  (data[kind] ??= kind === 'a'
    ? import('./confetti-a.json').then((m) => m.default)
    : import('./confetti-b.json').then((m) => m.default))

/** How long each file runs, in ms — the overlay is removed a beat after. */
const LENGTH: Record<ConfettiKind, number> = { a: 2500, b: 3000 }

/**
 * How big to draw each animation over a card. Both are drawn whole ("meet",
 * never squashed) and then clipped by the card, but they want different
 * framing: the tall one rains confetti, so it is sized by the card's **width**
 * and its top and bottom are cut off; the square one is a burst, so it is
 * sized by the card's **height** and its sides are cut off. Either way it
 * reaches past the card's edge — which is the look that was asked for.
 */
const STAGE: Record<ConfettiKind, (box: DOMRect) => { w: number; h: number }> = {
  // 1125 × 2436 (portrait)
  a: (box) => { const w = box.width * 1.4; return { w, h: w * (2436 / 1125) } },
  // 1920 × 1920 (square)
  b: (box) => { const h = Math.max(box.height * 1.8, box.width * 0.75); return { w: h, h } },
}

/**
 * Plays the confetti over `card`, clipped to the card's box and rounding.
 *
 * The overlay is a fixed layer over the card, not a child of it: the card is
 * React's, and the re-render that follows "moved to done" replaces its DOM —
 * an appended child vanished with it (the first cut of this did exactly that
 * and nothing was ever seen on the board). A short rAF loop keeps the layer on
 * the card while the list reflows, and `ticketId` lets it find the card again
 * if React swapped the element.
 */
export function confettiInCard(card: HTMLElement, kind: ConfettiKind = 'b', ticketId?: string): void {
  const box = card.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return
  // One at a time per card: finishing two subtasks quickly should not stack.
  document.querySelector(`[data-confetti-for="${ticketId ?? ''}"]`)?.remove()

  const radius = getComputedStyle(card).borderRadius || '12px'
  const clip = document.createElement('div')
  clip.dataset.confetti = kind
  if (ticketId) clip.dataset.confettiFor = ticketId
  clip.setAttribute('aria-hidden', 'true')
  const place = (r: DOMRect) => {
    clip.style.left = `${r.left}px`
    clip.style.top = `${r.top}px`
    clip.style.width = `${r.width}px`
    clip.style.height = `${r.height}px`
  }
  clip.style.cssText = `position:fixed;overflow:hidden;border-radius:${radius};pointer-events:none;z-index:95`
  place(box)

  // Bigger than the card and centred: the burst starts in the middle and its
  // outer particles are cut by the card's edge instead of stopping short of it.
  const { w, h } = STAGE[kind](box)
  const stage = document.createElement('div')
  stage.style.cssText = `position:absolute;left:50%;top:50%;width:${Math.round(w)}px;height:${Math.round(h)}px;transform:translate(-50%,-50%)`
  clip.appendChild(stage)

  document.body.appendChild(clip)

  // Follow the card: the board reflows right after a card lands in a column.
  let raf = 0
  const follow = () => {
    const host = (ticketId ? document.querySelector(`[data-ticket-id="${CSS.escape(ticketId)}"]`) : card) as HTMLElement | null
    const r = host?.getBoundingClientRect()
    if (r && r.width > 0) place(r)
    raf = requestAnimationFrame(follow)
  }
  raf = requestAnimationFrame(follow)

  let anim: Anim | null = null
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    try { anim?.destroy() } catch { /* already gone */ }
    clip.remove()
  }

  void Promise.all([loadPlayer(), loadData(kind)])
    .then(([lottie, animationData]) => {
      if (!clip.isConnected) return
      anim = lottie.loadAnimation({
        container: stage,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        animationData,
        // "meet": the animation keeps its proportions inside the stage; the
        // stage itself is what reaches past the card, and the card clips it.
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true },
      })
      anim.addEventListener('complete', cleanup)
    })
    .catch(cleanup)

  // Safety net: a failed load or a tab that was hidden must not leave the overlay behind.
  window.setTimeout(cleanup, LENGTH[kind] + 600)
}
