/**
 * Interface language: Turkish, English, German.
 *
 * Two constraints shaped this:
 *
 *  1. The choice must be readable *before* the session is. Login, register and
 *     invite render with no user, and `user_preferences` needs one — so the
 *     language lives in localStorage, like the theme, and for the same reason.
 *     (See CLAUDE.md: theme and language are the only two localStorage prefs.)
 *  2. Changing it must repaint the whole app at once. `useTheme` gets away with
 *     per-component state because it writes a class onto <html>; text cannot.
 *     So this is one module-level store with `useSyncExternalStore` on top —
 *     no context provider to thread through every tree.
 *
 * Turkish is the source of truth. Every other locale is typed against it, so a
 * missing translation is a compile error, not a Turkish word in an English UI.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { tr } from './locales/tr'

export type Lang = 'tr' | 'en' | 'de'
export type TranslationKey = keyof typeof tr

export const LANGUAGES: { id: Lang; label: string; endonym: string; locale: string }[] = [
  { id: 'tr', label: 'Türkçe', endonym: 'Türkçe', locale: 'tr-TR' },
  { id: 'en', label: 'English', endonym: 'English', locale: 'en-GB' },
  { id: 'de', label: 'Deutsch', endonym: 'Deutsch', locale: 'de-DE' },
]

/**
 * Türkçe kaynak ve yedek olarak pakette; İngilizce ve Almanca seçilince iner
 * (#74d303e2 — üç sözlük birlikte ana pakette ~400 KB tutuyordu). Açılışta kayıtlı
 * dil main.tsx'te `loadLang` ile önce yüklenir, uygulama ondan sonra çizilir: İngilizce
 * kullanıcı bir an Türkçe görmez.
 */
const DICTS: Partial<Record<Lang, Record<string, string>>> = { tr }
const LOADERS: Record<Exclude<Lang, 'tr'>, () => Promise<Record<string, string>>> = {
  en: () => import('./locales/en').then((m) => m.en),
  de: () => import('./locales/de').then((m) => m.de),
}

/** Sözlüğü hazırla (zaten yüklüyse hemen döner; yüklenemezse Türkçe yedekte kalınır). */
export async function loadLang(lang: Lang): Promise<void> {
  if (DICTS[lang] || lang === 'tr') return
  try { DICTS[lang] = await LOADERS[lang]() } catch { /* çevrimdışı ilk açılış: Türkçe yedek */ }
}
const KEY = 'lang'

const isLang = (v: unknown): v is Lang => v === 'tr' || v === 'en' || v === 'de'

/** Stored choice, else the closest match for the browser, else Turkish. */
export function readLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY)
    if (isLang(stored)) return stored
  } catch { /* private mode: fall through to the browser's preference */ }
  // No navigator outside a browser (vitest's default 'node' environment): stay on Turkish.
  if (typeof navigator === 'undefined') return 'tr'
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = (tag ?? '').slice(0, 2).toLowerCase()
    if (isLang(base)) return base
  }
  return 'tr'
}

let current: Lang = readLang()
const listeners = new Set<() => void>()

export const getLang = (): Lang => current
export const localeOf = (l: Lang = current) => LANGUAGES.find((x) => x.id === l)?.locale ?? 'tr-TR'

export async function setLang(next: Lang) {
  if (next === current) return
  await loadLang(next)
  current = next
  try { localStorage.setItem(KEY, next) } catch { /* not fatal — the session still switches */ }
  document.documentElement.lang = next
  for (const fn of listeners) fn()
}

/** Called once at startup, next to applyStoredTheme(), so <html lang> is right
 *  for screen readers and hyphenation even before React mounts. */
export function applyStoredLang() {
  document.documentElement.lang = current
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

const missing = new Set<string>()

/**
 * Translate. `vars` fills `{name}` placeholders:
 *   t('board.hiddenCount', { n: 3 })  →  "3 görev gizli"
 *
 * Falls back to Turkish and then to the key itself, so a missing string degrades
 * to something readable instead of blanking the UI.
 */
export function translate(lang: Lang, key: TranslationKey, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang]?.[key] ?? tr[key]
  if (raw === undefined) {
    if (import.meta.env.DEV && !missing.has(key)) {
      missing.add(key)
      console.warn(`[i18n] missing key: ${key}`)
    }
    return key
  }
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m))
}

/** For modules that run outside React (toasts, error mapping, shortcut labels). */
export const t = (key: TranslationKey, vars?: Record<string, string | number>) => translate(current, key, vars)

/** The language the app is currently showing; re-renders on change. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang)
}

/** `const t = useT()` — the component re-renders when the language changes. */
export function useT() {
  const lang = useLang()
  return useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  )
}

/** Language plus its BCP-47 locale, for Intl formatting. */
export function useLocale() {
  const lang = useLang()
  return useMemo(() => ({ lang, locale: localeOf(lang) }), [lang])
}
