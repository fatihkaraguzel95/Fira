import { useEffect, useState } from 'react'

/**
 * Appearance: light, dark, or auto (follow the browser/OS setting).
 *
 * `auto` is the default for anyone who has not chosen yet, and it stays live —
 * switching the system to dark at night flips the app with it. The choice lives
 * in localStorage (not user_preferences) on purpose: it must be readable before
 * the session is, otherwise every page load flashes the wrong theme.
 */
export type ThemeMode = 'light' | 'dark' | 'auto'

const KEY = 'theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function readThemeMode(): ThemeMode {
  const stored = localStorage.getItem(KEY)
  return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto'
}

export const resolveIsDark = (mode: ThemeMode) => (mode === 'auto' ? media().matches : mode === 'dark')

// Every mounted useTheme() holds its own copy of the mode (the profile menu, the settings tab,
// the command palette); a change announces itself so the others follow instead of re-applying
// a stale mode later (an old "auto" copy flipped the theme back on the next system change).
const CHANGED = 'fira:theme'
export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(KEY, mode)
  window.dispatchEvent(new Event(CHANGED))
}

/** The installed PWA window paints the strip behind the window buttons (and a
 *  phone browser its own chrome) with <meta name="theme-color">. It has to be
 *  the **rail/top bar** colour, not white: in the installed window that strip
 *  sits right next to Fira's own top bar and two different greys side by side
 *  read as two mismatched title bars (#849dd4b8). The value is read from the
 *  live `--c-nav` token so it can never drift from the bar itself. */
const THEME_COLOR = { light: '#edf1f6', dark: '#070b14' }

function navColor(isDark: boolean): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--c-nav').trim()
  const rgb = raw.split(/[\s,]+/).map(Number)
  if (rgb.length === 3 && rgb.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
    return '#' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
  }
  return isDark ? THEME_COLOR.dark : THEME_COLOR.light
}

function applyThemeColor(isDark: boolean) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = navColor(isDark)
}

/** Kabuk değişince (useShell) `--c-nav` değişir; damga onu yeniden okur. */
export function refreshThemeColor() {
  applyThemeColor(document.documentElement.classList.contains('dark'))
}

function apply(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark)
  applyThemeColor(isDark)
}

/** Apply the persisted theme to <html>. Called once at startup so pages that
 *  do not render the Header (login, register, invite) follow the same theme. */
export function applyStoredTheme() {
  apply(resolveIsDark(readThemeMode()))
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode)
  const [isDark, setIsDark] = useState(() => resolveIsDark(readThemeMode()))

  useEffect(() => {
    localStorage.setItem(KEY, mode)
    setIsDark(resolveIsDark(mode))
    if (mode !== 'auto') return
    // Follow the system while on auto: no reload needed when it flips.
    const mq = media()
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  useEffect(() => { apply(isDark) }, [isDark])
  useEffect(() => {
    const follow = () => setModeState(readThemeMode())
    window.addEventListener(CHANGED, follow)
    return () => window.removeEventListener(CHANGED, follow)
  }, [])

  return {
    mode,
    isDark,
    setMode: setThemeMode,
    /** Kept for the old two-state toggle: light ⇄ dark, leaving auto behind. */
    toggle: () => setModeState(isDark ? 'light' : 'dark'),
  }
}
