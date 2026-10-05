/**
 * Gezinme: uygulamadaki tek yöntem (#a7d43aaf).
 *
 * **Yön kullanıcının geçtiği yola değil, nesnelerin ilişkisine bağlıdır.** Genelden
 * özele gitmek ileridir (liste → görev → alt görev → alt sayfa), özelden genele
 * gitmek geridir. Tarayıcının geri tuşu her zaman daha genel olana ya da bu ekrana
 * gelmeden önceki ekrana götürür; hiçbir zaman daha özel olana götürmez.
 *
 * Üç kural (`decide`):
 *  1. Hedef geçmişte zaten varsa oraya **geri dönülür** (yeni kayıt açılmaz). A → B →
 *     "üst görev" A: geçmiş [pano, A] olur; B ileride kalır, geride değil.
 *  2. Hedef şimdiki ekrandan daha genelse ve geçmişte yoksa şimdiki kaydın **yerine
 *     geçer**; geçmişin tepesinde ondan daha özel başka kayıtlar varsa onlar da
 *     düşer. Bildirimden açılan D sayfasından üst görev C'ye çıkınca geri tuşu D'ye
 *     değil, D'yi açmadan önceki ekrana götürür.
 *  3. Bunların dışındaki her gezinme (daha özele, yana, ilgisiz bir ekrana)
 *     geçmişe **yeni kayıt** ekler.
 *
 * Geçmişin kendisi tarayıcınınkidir; bu modül yalnız onun aynasını tutar (hangi
 * kayıtta ne var) ki "kaç adım geri" hesaplanabilsin. Ayna `NavTracker` ile her
 * konum değişikliğinde güncellenir ve sekme yenilenince kaybolmasın diye
 * sessionStorage'a yazılır.
 *
 * "Daha genel" bilgisi (`noteParent`) ekranlar verilerini yükledikçe gelir: görev
 * penceresi görevin üst görevini ya da listesini, sayfa ekranı sayfanın üstünü
 * bildirir. Liste adreste yaşamaz (pano `/`'tır, hangi listeyi gösterdiği durumdur),
 * bu yüzden bir listedeki her şeyin en genel atası `/`'tır.
 *
 * Yeni bir "şunu aç" yolu `navigate(...)` yazmaz; `go` (ya da görev için `openTicket`,
 * liste için `goList`) çağırır.
 */
import type { NavigateFunction } from 'react-router-dom'

export const BOARD = '/'
export const ticketPath = (id: string) => `/ticket/${id}`
export const pagePath = (id: string) => `/page/${id}`
/** The path without its query and hash: what identifies a screen. */
export const screenOf = (to: string) => to.replace(/[?#].*$/, '') || '/'

/**
 * Görev penceresi açık ekranın **üstünde** durur; adresi bir ekran değildir.
 * "Bırakılan ekrana dön" diye bir yol saklayan her yer bunu atlamalı, yoksa
 * dönülecek yer pencerenin kendisi olur (yönetim ↔ görev döngüsü, #7ab2d9f3).
 */
export const isOverlayPath = (path: string) => path.startsWith('/ticket/')

// ── what is more general than what ──────────────────────────────────────────
const parentOf = new Map<string, string>()

/** `child` sits under `parent` (paths). A null parent means "directly in its list": the board. */
export function noteParent(child: string, parent: string | null) {
  const p = parent ?? BOARD
  if (child === p) return
  parentOf.set(child, p)
}

/** Is `general` above `specific` in what the screens have reported so far? */
export function isAncestor(general: string, specific: string): boolean {
  // The board is above every task and page, whether or not a screen has reported the chain yet.
  if (general === BOARD) return specific.startsWith('/ticket/') || specific.startsWith('/page/')
  let cur = parentOf.get(specific)
  for (let hops = 0; cur !== undefined && hops < 40; hops++) {
    if (cur === general) return true
    cur = parentOf.get(cur)
  }
  return false
}

// ── the decision (pure) ─────────────────────────────────────────────────────
export type Move =
  | { kind: 'stay' }
  /** The target is already in the history: go back to it. */
  | { kind: 'back'; steps: number }
  /** The target is more general: it takes the place of the current entry, after dropping `back` more specific ones above it. */
  | { kind: 'replace'; back: number }
  | { kind: 'push' }

/**
 * `stack` is the history up to and including the current screen (paths, oldest first).
 * `above(general, specific)` answers whether one screen is more general than another.
 */
export function decide(stack: string[], target: string, above: (general: string, specific: string) => boolean): Move {
  const top = stack.length - 1
  if (top < 0) return { kind: 'push' }
  if (stack[top] === target) return { kind: 'stay' }
  const at = stack.lastIndexOf(target, top - 1)
  if (at >= 0) return { kind: 'back', steps: top - at }
  if (above(target, stack[top])) {
    let drop = 1
    while (top - drop >= 0 && above(target, stack[top - drop])) drop++
    return { kind: 'replace', back: drop - 1 }
  }
  return { kind: 'push' }
}

// ── the mirror of the browser's history ─────────────────────────────────────
interface Entry { key: string; path: string }
const STORE = 'fira:nav'
let entries: Entry[] = []
let index = -1
/** What to put in place of the entry a pending step back lands on. */
let afterBack: { to: string; state?: unknown } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function subscribeNav(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function persist() {
  try { sessionStorage.setItem(STORE, JSON.stringify({ entries: entries.slice(-60), index: index - Math.max(0, entries.length - 60) })) } catch { /* private window */ }
}

function restore(key: string): boolean {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as { entries: Entry[]; index: number } | null
    const at = saved?.entries?.findIndex((e) => e.key === key) ?? -1
    if (!saved || at < 0) return false
    entries = saved.entries
    index = at
    return true
  } catch { return false }
}

/**
 * Called by `NavTracker` on every location change. `type` is react-router's
 * navigation type. Returns a replacement to carry out once a step back has landed.
 */
export function track(type: 'PUSH' | 'REPLACE' | 'POP', key: string, path: string): { to: string; state?: unknown } | null {
  const entry = { key, path: screenOf(path) }
  if (index < 0 && restore(key)) {
    entries[index] = entry
  } else if (index >= 0 && entries[index].key === key) {
    entries[index] = entry // the same entry again (a re-render, StrictMode)
  } else if (type === 'PUSH') {
    entries = [...entries.slice(0, index + 1), entry]
    index = entries.length - 1
  } else if (type === 'REPLACE' && index >= 0) {
    entries[index] = entry
  } else {
    const at = entries.findIndex((e) => e.key === key)
    if (at >= 0) index = at
    else { entries = [entry]; index = 0 } // an entry from before this tab was tracked
  }
  persist()
  emit()
  if (type === 'POP' && afterBack) {
    const next = afterBack
    afterBack = null
    return next
  }
  if (type !== 'POP') afterBack = null
  return null
}

/** Is there an entry of this tab's Fira history behind / ahead of the current one? */
export const canGoBack = () => index > 0
export const canGoForward = () => index >= 0 && index < entries.length - 1

/** The screen one step back, when the mirror knows it. */
export const previousPath = () => (index > 0 ? entries[index - 1].path : null)

const stackPaths = () => entries.slice(0, index + 1).map((e) => e.path)

/** For tests: forget everything. */
export function resetNav() {
  entries = []; index = -1; afterBack = null; parentOf.clear()
  try { sessionStorage.removeItem(STORE) } catch { /* nothing to clear */ }
}

// ── the one way to move ─────────────────────────────────────────────────────
export interface GoOptions {
  state?: unknown
  /** The caller knows the target is more general than this screen (a breadcrumb, "back to the list"). */
  up?: boolean
}

export function go(navigate: NavigateFunction, to: string, opts: GoOptions = {}) {
  const here = window.location.pathname
  const target = screenOf(to)
  const stack = stackPaths()
  // The mirror follows the location one render later; if it has not caught up, move plainly.
  if (!stack.length || stack[stack.length - 1] !== here) { navigate(to, { state: opts.state }); return }
  const move = decide(stack, target, (general, specific) => (opts.up && general === target && specific === here) || isAncestor(general, specific))
  const exact = to === here + window.location.search + window.location.hash
  if (move.kind === 'stay') {
    if (!exact || opts.state !== undefined) navigate(to, { replace: true, state: opts.state })
  } else if (move.kind === 'back') {
    // The entry may hold the same screen with other parameters (?team=…): put the asked address there.
    if (to !== target || opts.state !== undefined) afterBack = { to, state: opts.state }
    navigate(-move.steps)
  } else if (move.kind === 'replace') {
    if (move.back > 0) { afterBack = { to, state: opts.state }; navigate(-move.back) }
    else navigate(to, { replace: true, state: opts.state })
  } else {
    navigate(to, { state: opts.state })
  }
}

/** "Bu görevi aç": görev açan her yol buradan geçer. */
export const openTicket = (navigate: NavigateFunction, id: string) => go(navigate, ticketPath(id))

/**
 * Görev penceresini kapat (✕, Esc, dışarı tıklama): pencerenin altındaki ekrana,
 * yani geçmişte görev olmayan en yakın kayda dönülür. Geri tuşu ise adım adım
 * gider (alt görevden üst göreve, oradan panoya).
 */
export function closeOverlay(navigate: NavigateFunction) {
  for (let i = index - 1; i >= 0; i--) {
    if (!isOverlayPath(entries[i].path)) { navigate(-(index - i)); return }
  }
  navigate(BOARD, { replace: true })
}

// ── lists: the board is `/`, which list it shows is state ───────────────────
const LIST_EVENT = 'fira:open-list'

/** "Bu listeyi aç": pano ekranına dönülür ve liste seçilir. */
export function goList(navigate: NavigateFunction, listId: string) {
  const handled = !window.dispatchEvent(new CustomEvent(LIST_EVENT, { detail: listId, cancelable: true }))
  if (!handled) navigate(`/list/${listId}`)
}

/** The board listens: it selects the list and moves to `/` itself. */
export function onOpenList(handler: (listId: string) => void) {
  const h = (e: Event) => { e.preventDefault(); handler((e as CustomEvent<string>).detail) }
  window.addEventListener(LIST_EVENT, h)
  return () => window.removeEventListener(LIST_EVENT, h)
}
