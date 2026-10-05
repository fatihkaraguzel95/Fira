import type { ChangelogRelease } from '../changelog'
import type { TranslationKey } from '../i18n'

/**
 * The in-app product tour. Two kinds of step:
 *   • onboarding — anchored to a real element (`target`), shown with a spotlight.
 *   • whatsnew   — a centered card, built from the latest changelog release so
 *                  every new feature we ship shows up in the tour automatically
 *                  (no second list to maintain — changelog.ts is the source).
 *
 * A tiny store (like connection.ts) lets the profile menu start the tour without
 * threading callbacks through the header; AppTour subscribes and renders.
 *
 * A step carries translation *keys* rather than sentences. The onboarding list is
 * module-level, so holding the text here would freeze it in whichever language
 * was active at import; AppTour translates at render, and a language switch mid
 * tour repaints the card. Release notes are the exception — they are historical
 * content from changelog.ts and are shown verbatim in `title`/`body`.
 */
export interface TourStep {
  id: string
  titleKey?: TranslationKey
  bodyKey?: TranslationKey
  /** Placeholders for the two keys above. */
  vars?: Record<string, string | number>
  /** Untranslated copy (release notes). Used when the matching key is absent. */
  title?: string
  body?: string
  /** CSS selector of the element to spotlight. Absent (or not on screen) → centered card. */
  target?: string
  /** Hedef ekranda yoksa adım atlanır (ör. takımda AI ajanı yoksa "Claude'a yaptır"). */
  optional?: boolean
  kind: 'onboarding' | 'whatsnew'
}

/**
 * Tur bölümleri (#ab88c8f5). `app`: ana ekran (liste, pano, arama, bildirimler,
 * profil) ve son sürümün yenilikleri. `ticket`: görev penceresi — kullanıcının
 * gözünden kaçabilecek özellikler adım adım. Ana ekran bölümü bitince "Görev
 * penceresine geç" ekrandaki ilk görevi açıp ikinci bölüme geçer; görev açıkken
 * başlatılan tur doğrudan görev bölümüyle başlar.
 */
export type TourChapter = 'app' | 'ticket'

// Anchored to `data-tour="…"` hooks placed on the real elements. If one is not on
// screen (e.g. no list selected, or a mobile drawer is closed) the step falls
// back to a centered card, so the tour never points at nothing.
const ONBOARDING: TourStep[] = [
  {
    id: 'welcome',
    kind: 'onboarding',
    titleKey: 'misc.tour.welcome.title',
    bodyKey: 'misc.tour.welcome.body',
  },
  {
    id: 'sidebar',
    kind: 'onboarding',
    target: '[data-tour="sidebar"]',
    titleKey: 'misc.tour.sidebar.title',
    bodyKey: 'misc.tour.sidebar.body',
  },
  {
    id: 'view',
    kind: 'onboarding',
    target: '[data-tour="view"]',
    titleKey: 'misc.tour.view.title',
    bodyKey: 'misc.tour.view.body',
  },
  {
    id: 'new-ticket',
    kind: 'onboarding',
    // The list header lost its "New ticket" button (#9ab8db99): searching and
    // creating both start at the top bar's palette now.
    target: '[data-tour="palette"]',
    titleKey: 'misc.tour.newTicket.title',
    bodyKey: 'misc.tour.newTicket.body',
  },
  {
    id: 'notifications',
    kind: 'onboarding',
    target: '[data-tour="notifications"]',
    titleKey: 'misc.tour.notifications.title',
    bodyKey: 'misc.tour.notifications.body',
  },
  {
    id: 'profile',
    kind: 'onboarding',
    target: '[data-tour="profile"]',
    titleKey: 'misc.tour.profile.title',
    bodyKey: 'misc.tour.profile.body',
  },
]

/**
 * Görev penceresi bölümü (#ab88c8f5). Hedefler `data-tour` işaretleri; pencere
 * içinde kaydırılarak gösterilir. İsteğe bağlı adım hedefi yoksa atlanır.
 */
const TICKET: TourStep[] = [
  { id: 't-title', kind: 'onboarding', target: '[data-tour="ticket-title"]', titleKey: 'misc.tour.tTitle.title', bodyKey: 'misc.tour.tTitle.body' },
  { id: 't-header', kind: 'onboarding', target: '[data-tour="ticket-header"]', titleKey: 'misc.tour.tHeader.title', bodyKey: 'misc.tour.tHeader.body' },
  { id: 't-props', kind: 'onboarding', target: '[data-tour="ticket-props"]', titleKey: 'misc.tour.tProps.title', bodyKey: 'misc.tour.tProps.body' },
  { id: 't-ai', kind: 'onboarding', target: '[data-tour="ticket-ai"]', optional: true, titleKey: 'misc.tour.tAi.title', bodyKey: 'misc.tour.tAi.body' },
  { id: 't-desc', kind: 'onboarding', target: '[data-tour="ticket-description"]', titleKey: 'misc.tour.tDesc.title', bodyKey: 'misc.tour.tDesc.body' },
  // Kutulardaki "Enter; birden çok satır yapıştırılabilir" ipuçları buraya taşındı (#7c54fb70).
  { id: 't-sections', kind: 'onboarding', target: '[data-tour="ticket-sections"]', optional: true, titleKey: 'misc.tour.ticketActions.title', bodyKey: 'misc.tour.ticketActions.body' },
  { id: 't-activity', kind: 'onboarding', target: '[data-tour="ticket-activity"]', titleKey: 'misc.tour.tActivity.title', bodyKey: 'misc.tour.tActivity.body' },
  { id: 't-keys', kind: 'onboarding', titleKey: 'misc.tour.tKeys.title', bodyKey: 'misc.tour.tKeys.body' },
]

/** Steps built from the newest release's features — added to the tour automatically. */
function whatsNewSteps(release: ChangelogRelease | undefined): TourStep[] {
  if (!release || release.features.length === 0) return []
  const intro: TourStep = {
    id: 'wn-intro',
    kind: 'whatsnew',
    titleKey: 'misc.tour.whatsNew.title',
    vars: { version: release.version },
    ...(release.summary ? { body: release.summary } : { bodyKey: 'misc.tour.whatsNew.body' as TranslationKey }),
  }
  const features = release.features.map((f, i): TourStep => ({
    id: `wn-${i}`,
    kind: 'whatsnew',
    title: f.title,
    body: f.description ?? '',
  }))
  return [intro, ...features]
}

/**
 * A chapter's steps. `app`: onboarding first, then the features of the newest
 * release that has any (a fix-only release would otherwise hide them). The release
 * notes are loaded here, on demand (#74d303e2): they are ~180 KB and the app shell
 * only needs the version number (src/version.ts).
 */
export async function buildTourSteps(chapter: TourChapter = 'app'): Promise<TourStep[]> {
  if (chapter === 'ticket') return TICKET
  const { CHANGELOG } = await import('../changelog')
  return [...ONBOARDING, ...whatsNewSteps(CHANGELOG.find((r) => r.features.length > 0))]
}

/** Görev penceresi açık mı (turun hangi bölümle başlayacağı buna bakar). */
export const ticketWindowOpen = () => !!document.querySelector('[data-ticket-window]')

// ── Store ────────────────────────────────────────────────────────────────────
let open = false
let chapter: TourChapter = 'app'
/** Görev bölümüne ana ekran bölümünden devam edilerek mi gelindi. */
let continued = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function isTourOpen() {
  return open
}
export function tourChapter(): { chapter: TourChapter; continued: boolean } {
  return { chapter, continued }
}
/** Bölüm verilmezse bulunulan ekrandan: görev penceresi açıksa `ticket`. */
export function startTour(ch?: TourChapter) {
  if (open) return
  chapter = ch ?? (ticketWindowOpen() ? 'ticket' : 'app')
  continued = false
  open = true
  emit()
}
/** Açık turu başka bir bölümle sürdür ("Görev penceresine geç"). */
export function continueTour(ch: TourChapter) {
  if (!open) return
  chapter = ch
  continued = true
  emit()
}
export function endTour() {
  if (!open) return
  open = false
  emit()
}
export function subscribeTour(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
