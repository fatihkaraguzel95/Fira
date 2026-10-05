/**
 * Keyboard shortcuts: one registry of actions with default keys, a matcher,
 * and a tiny event bus so the component that owns a piece of UI (the search
 * box, the filter menu, the view switch) reacts to an action without the
 * shortcut layer knowing anything about it.
 *
 * Two ways an action runs (#75dc7a96):
 * - a handler subscribed with `onShortcut` (navigation, new task, …);
 * - or, when nobody handles it, a click on the visible element marked
 *   `data-shortcut="<id>"` (the ticket window's minimize, next status, the
 *   favourite star …). The same mark tells the F1 layer where to draw the key,
 *   so the key shown and the button pressed can never disagree.
 *
 * User overrides live in user_preferences (`shortcuts`, see useShortcuts), so
 * a remapped key follows the person between browsers.
 *
 * The registry is evaluated once, at import — so it stores translation *keys*,
 * never translated text. Anything the user reads is resolved at the render site.
 *
 * Choosing keys (0.69.0): a bare letter only for harmless actions ("/" search);
 * anything that creates or changes something needs a modifier (a stray "n"
 * once opened 83 empty tasks). No Ctrl+Alt (that is AltGr on Windows: @, €, {
 * on a Turkish keyboard) and no Shift+symbol (the symbol changes with the
 * layout). Digits are read from the physical key, so Ctrl+Shift+1 works on
 * every layout. Avoid Chrome's own Alt+Shift+I/T/A/B.
 */
import { t, type TranslationKey } from '../i18n'

export type ShortcutAction =
  // general
  | 'shortcuts' | 'palette' | 'palette-commands' | 'settings' | 'theme-toggle' | 'notifications' | 'theme' | 'whats-new'
  // navigation
  | 'nav-back' | 'nav-forward' | 'inbox' | 'home' | 'teams' | 'admin' | 'my-tasks' | 'recents'
  // create
  | 'new-ticket' | 'new-page'
  // board and list
  | 'search' | 'filter' | 'toggle-view' | 'board' | 'list' | 'list-settings'
  // the open task or page
  | 'favorite' | 'copy-link'
  // ticket window
  | 'ticket-minimize' | 'ticket-back' | 'ticket-next' | 'ticket-done' | 'ticket-comment' | 'ticket-panel'

export type ShortcutGroup = 'general' | 'navigation' | 'create' | 'board' | 'item' | 'ticket'

export interface ShortcutDef {
  id: ShortcutAction
  labelKey: TranslationKey
  hintKey?: TranslationKey
  group: ShortcutGroup
  /** Canonical combo, e.g. "/", "alt+shift+n", "ctrl+k"; "" = no default key. */
  keys: string
  /** Fires inside text fields too (modifier combos only — a bare key there must stay a character). */
  anywhere?: boolean
}

// Cmd on a Mac, Ctrl elsewhere — but not for Ctrl+Shift+digit: Cmd+Shift+3/4 are macOS screenshots.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = MAC ? 'meta' : 'ctrl'

export const SHORTCUTS: ShortcutDef[] = [
  // Genel
  { id: 'shortcuts', labelKey: 'settings.shortcut.shortcuts', hintKey: 'settings.shortcut.shortcutsHint', group: 'general', keys: `${MOD}+.`, anywhere: true },
  // Top bar command palette (#43a865fb): search everything, or '>' for commands only (VS Code's Ctrl+Shift+P).
  { id: 'palette', labelKey: 'settings.shortcut.palette', hintKey: 'settings.shortcut.paletteHint', group: 'general', keys: `${MOD}+k`, anywhere: true },
  { id: 'palette-commands', labelKey: 'settings.shortcut.paletteCommands', hintKey: 'settings.shortcut.paletteCommandsHint', group: 'general', keys: `${MOD}+shift+p`, anywhere: true },
  { id: 'settings', labelKey: 'settings.shortcut.settings', group: 'general', keys: `${MOD}+,`, anywhere: true },
  { id: 'theme-toggle', labelKey: 'settings.shortcut.themeToggle', group: 'general', keys: 'alt+shift+d' },
  { id: 'notifications', labelKey: 'settings.shortcut.notifications', group: 'general', keys: '' },
  { id: 'theme', labelKey: 'settings.shortcut.theme', group: 'general', keys: '' },
  { id: 'whats-new', labelKey: 'settings.shortcut.whatsNew', group: 'general', keys: '' },
  // Geri / ileri (#f1254345): the browser's own keys, so the key and the top bar's buttons are one thing.
  // Alt+← in a text field is "back" on Windows too; on a Mac ⌘← there is "start of line", so not in fields.
  { id: 'nav-back', labelKey: 'settings.shortcut.navBack', hintKey: 'settings.shortcut.navBackHint', group: 'navigation', keys: MAC ? 'meta+arrowleft' : 'alt+arrowleft', anywhere: !MAC },
  { id: 'nav-forward', labelKey: 'settings.shortcut.navForward', hintKey: 'settings.shortcut.navForwardHint', group: 'navigation', keys: MAC ? 'meta+arrowright' : 'alt+arrowright', anywhere: !MAC },
  // Gezinti — the rail, top to bottom (Teams: Ctrl+Shift+1…).
  { id: 'inbox', labelKey: 'settings.shortcut.inbox', group: 'navigation', keys: 'ctrl+shift+1', anywhere: true },
  { id: 'home', labelKey: 'settings.shortcut.home', group: 'navigation', keys: 'ctrl+shift+2', anywhere: true },
  { id: 'teams', labelKey: 'settings.shortcut.teams', group: 'navigation', keys: 'ctrl+shift+3', anywhere: true },
  { id: 'admin', labelKey: 'settings.shortcut.admin', hintKey: 'settings.shortcut.adminHint', group: 'navigation', keys: 'ctrl+shift+4', anywhere: true },
  { id: 'my-tasks', labelKey: 'settings.shortcut.myTasks', group: 'navigation', keys: 'alt+shift+m' },
  { id: 'recents', labelKey: 'settings.shortcut.recents', group: 'navigation', keys: 'alt+shift+h' },
  // Oluştur
  { id: 'new-ticket', labelKey: 'settings.shortcut.newTicket', hintKey: 'settings.shortcut.newTicketHint', group: 'create', keys: 'alt+shift+n' },
  { id: 'new-page', labelKey: 'settings.shortcut.newPage', hintKey: 'settings.shortcut.newPageHint', group: 'create', keys: 'alt+shift+p' },
  // Pano ve liste
  { id: 'search', labelKey: 'settings.shortcut.search', hintKey: 'settings.shortcut.searchHint', group: 'board', keys: '/' },
  { id: 'filter', labelKey: 'settings.shortcut.filter', group: 'board', keys: `${MOD}+shift+f` },
  { id: 'toggle-view', labelKey: 'settings.shortcut.toggleView', group: 'board', keys: 'alt+shift+v' },
  { id: 'board', labelKey: 'settings.shortcut.board', group: 'board', keys: '' },
  { id: 'list', labelKey: 'settings.shortcut.list', group: 'board', keys: '' },
  { id: 'list-settings', labelKey: 'settings.shortcut.listSettings', group: 'board', keys: 'alt+shift+e' },
  // Açık görev ya da sayfa
  { id: 'favorite', labelKey: 'settings.shortcut.favorite', hintKey: 'settings.shortcut.favoriteHint', group: 'item', keys: 'alt+shift+s' },
  { id: 'copy-link', labelKey: 'settings.shortcut.copyLink', hintKey: 'settings.shortcut.copyLinkHint', group: 'item', keys: 'alt+shift+l' },
  // Görev penceresi
  { id: 'ticket-minimize', labelKey: 'settings.shortcut.ticketMinimize', group: 'ticket', keys: 'alt+shift+arrowdown' },
  { id: 'ticket-back', labelKey: 'settings.shortcut.ticketBack', group: 'ticket', keys: 'alt+shift+arrowleft' },
  { id: 'ticket-next', labelKey: 'settings.shortcut.ticketNext', group: 'ticket', keys: 'alt+shift+arrowright' },
  { id: 'ticket-done', labelKey: 'settings.shortcut.ticketDone', group: 'ticket', keys: 'alt+shift+enter' },
  { id: 'ticket-comment', labelKey: 'settings.shortcut.ticketComment', group: 'ticket', keys: 'alt+shift+r' },
  { id: 'ticket-panel', labelKey: 'settings.shortcut.ticketPanel', group: 'ticket', keys: '' },
]

/** The groups, in the order the dialog and the settings tab list them. */
export const SHORTCUT_GROUPS: { id: ShortcutGroup; labelKey: TranslationKey }[] = [
  { id: 'general', labelKey: 'settings.shortcut.group.general' },
  { id: 'navigation', labelKey: 'settings.shortcut.group.navigation' },
  { id: 'create', labelKey: 'settings.shortcut.group.create' },
  { id: 'board', labelKey: 'settings.shortcut.group.board' },
  { id: 'item', labelKey: 'settings.shortcut.group.item' },
  { id: 'ticket', labelKey: 'settings.shortcut.group.ticket' },
]

/**
 * Keys that belong to where they are pressed (an editor, a menu) — listed, not
 * remappable. `keys` is a canonical combo, so it is shown the same way as the
 * rest (Cmd on a Mac).
 */
export interface FixedShortcut { keys: string; labelKey: TranslationKey; whereKey?: TranslationKey }
export const FIXED_SHORTCUTS: { group: 'fixed' | 'editor'; labelKey: TranslationKey; items: FixedShortcut[] }[] = [
  {
    group: 'fixed', labelKey: 'settings.fixed.title', items: [
      { keys: 'f1', labelKey: 'settings.fixed.layer', whereKey: 'settings.fixed.layerWhere' },
      { keys: 'escape', labelKey: 'settings.fixed.esc', whereKey: 'settings.fixed.escWhere' },
      { keys: `${MOD}+enter`, labelKey: 'settings.fixed.comment', whereKey: 'settings.fixed.commentWhere' },
      { keys: 'enter', labelKey: 'common.save', whereKey: 'settings.fixed.saveWhere' },
      { keys: 'arrowup arrowdown enter', labelKey: 'settings.fixed.status', whereKey: 'settings.fixed.statusWhere' },
    ],
  },
  {
    // tiptap's StarterKit keys, plus our Ctrl+K link (DescriptionEditor).
    group: 'editor', labelKey: 'settings.editor.title', items: [
      { keys: '/', labelKey: 'settings.fixed.slash' },
      { keys: `${MOD}+b`, labelKey: 'settings.editor.bold' },
      { keys: `${MOD}+i`, labelKey: 'settings.editor.italic' },
      { keys: `${MOD}+shift+s`, labelKey: 'settings.editor.strike' },
      { keys: `${MOD}+e`, labelKey: 'settings.editor.code' },
      { keys: `${MOD}+k`, labelKey: 'settings.editor.link' },
      { keys: `${MOD}+shift+8`, labelKey: 'settings.editor.bullets' },
      { keys: `${MOD}+shift+7`, labelKey: 'settings.editor.numbers' },
      { keys: `${MOD}+shift+9`, labelKey: 'settings.editor.tasks' },
      { keys: `${MOD}+shift+b`, labelKey: 'settings.editor.quote' },
      { keys: `${MOD}+alt+c`, labelKey: 'settings.editor.codeBlock' },
      { keys: `${MOD}+alt+1`, labelKey: 'settings.editor.heading' },
      { keys: 'shift+enter', labelKey: 'settings.editor.lineBreak' },
      { keys: `${MOD}+z`, labelKey: 'settings.editor.undo' },
      { keys: `${MOD}+shift+z`, labelKey: 'settings.editor.redo' },
    ],
  },
]

export type Bindings = Record<ShortcutAction, string>

export const defaultBindings = (): Bindings =>
  Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.keys])) as Bindings

const MOD_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const

/** Normalise a KeyboardEvent to the same canonical string the registry uses. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = e.key
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'Dead'].includes(key)) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.metaKey) mods.push('meta')
  const withMod = e.ctrlKey || e.altKey || e.metaKey
  // Named keys lower-cased too ("ArrowDown" → "arrowdown"), as the registry writes them.
  let k = key.toLowerCase()
  // Any single letter in any script — the old list was ASCII plus the Turkish
  // letters, which silently dropped the shift modifier on German ä/ö/ü/ß once
  // the interface stopped being Turkish-only.
  let isLetter = /^\p{L}$/u.test(key)
  // With a modifier, a digit is its physical key: Ctrl+Shift+1 reports "!" on
  // most layouts. Option on a Mac turns letters into symbols (Option+N = "˜").
  const digit = /^Digit(\d)$/.exec(e.code)
  const letter = /^Key([A-Z])$/.exec(e.code)
  if (withMod && digit) k = digit[1]
  else if (e.altKey && letter && !isLetter) { k = letter[1].toLowerCase(); isLetter = true }
  // Shift is part of the identity for letters, digits and named keys; for
  // symbols the key itself already carries it ("?" is what the user sees, not "shift+/").
  if (e.shiftKey && (isLetter || key.length > 1 || (withMod && digit))) mods.push('shift')
  mods.sort((a, b) => MOD_ORDER.indexOf(a as never) - MOD_ORDER.indexOf(b as never))
  return [...mods, k].join('+')
}

/** The pieces of a combo as the user reads them: "ctrl+k" → ["Ctrl", "K"]; "" → []. */
export function comboParts(combo: string): string[] {
  if (!combo) return []
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  // Built per call, not per module: the space key's name is translated.
  const names: Record<string, string> = {
    ctrl: isMac ? '⌃' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: isMac ? '⇧' : 'Shift', meta: isMac ? '⌘' : 'Win',
    ' ': t('settings.shortcut.key.space'), escape: 'Esc', enter: 'Enter', tab: 'Tab', backspace: '⌫',
    arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', pageup: 'PgUp', pagedown: 'PgDn',
  }
  return combo.split('+').map((p) => names[p] ?? (p.length === 1 || /^f\d{1,2}$/.test(p) ? p.toUpperCase() : p))
}

/** Human-readable label: "ctrl+k" → "Ctrl + K", "?" → "?" */
export function formatCombo(combo: string): string {
  return comboParts(combo).join(' + ')
}

// ─── Bus ─────────────────────────────────────────────────────────────────────
type Handler = () => void
const handlers = new Map<ShortcutAction, Set<Handler>>()

/** Subscribe to an action; returns the unsubscribe function (use inside useEffect). */
export function onShortcut(action: ShortcutAction, fn: Handler): () => void {
  if (!handlers.has(action)) handlers.set(action, new Set())
  handlers.get(action)!.add(fn)
  return () => { handlers.get(action)?.delete(fn) }
}

/**
 * Fire an action: its handlers, or else a click on its visible marked element
 * (see `shortcutTarget`). Returns true when something ran.
 */
export function emitShortcut(action: ShortcutAction): boolean {
  const set = handlers.get(action)
  if (set?.size) {
    for (const fn of set) fn()
    return true
  }
  const el = shortcutTarget(action)
  if (!el) return false
  runTarget(el)
  return true
}

// ─── Marked elements (data-shortcut) ─────────────────────────────────────────

/**
 * Is this element what the user sees at its own position? Hidden, disabled,
 * off-screen or covered (a dialog on top) elements are not. `ignore` is the F1
 * layer, which covers everything while it is up.
 */
export function isShownAndOnTop(el: HTMLElement, ignore?: Element | null): boolean {
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1)
  const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1)
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false
  const hits = document.elementsFromPoint(x, y)
  const top = hits.find((h) => !ignore || !ignore.contains(h))
  return !!top && (el === top || el.contains(top) || top.contains(el))
}

/** Elements marked for an action (`data-shortcut` holds space-separated action ids). */
export const markedFor = (action: ShortcutAction): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[data-shortcut]')].filter((el) => el.dataset.shortcut!.split(' ').includes(action))

/** The first visible, uncovered element marked for the action. */
export function shortcutTarget(action: ShortcutAction, ignore?: Element | null): HTMLElement | null {
  return markedFor(action).find((el) => isShownAndOnTop(el, ignore)) ?? null
}

/** A button is pressed; anything else (the comment box) gets the focus. */
function runTarget(el: HTMLElement) {
  if (el.matches('button, a, [role="button"], [role="tab"], [role="menuitem"]')) { el.click(); return }
  const field = el.matches('[contenteditable="true"], input, textarea') ? el : el.querySelector<HTMLElement>('[contenteditable="true"], input, textarea')
  if (field) { field.focus(); return }
  el.click()
}
