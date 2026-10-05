/**
 * How every date and time in Fira is written.
 *
 * There are two independent choices, and they are separate on purpose:
 *
 *  - **Language** (`src/i18n`) decides the *words* — month names, "yesterday",
 *    "3 dk". A German interface must not show Turkish month names.
 *  - **Date format** (this module, #011D62C4) decides the *shape* — relative or
 *    absolute, month as a number or a word, day-first or month-first. Two people
 *    reading the same board in the same language can still want different shapes.
 *
 * The preference lives in `user_preferences` (unlike the language, nothing before
 * sign-in shows a date), but the formatters are plain functions called from
 * hundreds of render sites, so the resolved value is mirrored into a module-level
 * store the same way `setNotifyConfig` mirrors notification prefs. Components
 * that must repaint on a change subscribe with `useDateFormat()`.
 *
 * Whatever the shape, the exact moment stays one hover away: every shortened
 * timestamp is rendered with `exactTime()` in its `title`.
 */
import { useSyncExternalStore } from 'react'
import { getLang, localeOf, translate, type Lang } from '../i18n'

export type DateStyle = 'humanized' | 'compact' | 'full'
export type MonthStyle = 'name' | 'numeric'
/** `auto` follows the interface language's own convention — which itself starts
 *  from the browser's locale, so "leave it alone" needs no extra setting. */
export type DateOrder = 'auto' | 'dmy' | 'mdy'

export interface DateFormatPrefs {
  style: DateStyle
  month: MonthStyle
  order: DateOrder
}

export const DEFAULT_DATE_FORMAT: DateFormatPrefs = { style: 'humanized', month: 'name', order: 'auto' }

const isStyle = (v: unknown): v is DateStyle => v === 'humanized' || v === 'compact' || v === 'full'
const isMonth = (v: unknown): v is MonthStyle => v === 'name' || v === 'numeric'
const isOrder = (v: unknown): v is DateOrder => v === 'auto' || v === 'dmy' || v === 'mdy'

/** Read a stored preference blob defensively — it comes from the database. */
export function sanitizeDateFormat(raw: unknown): DateFormatPrefs {
  const o = (raw ?? {}) as Partial<DateFormatPrefs>
  return {
    style: isStyle(o.style) ? o.style : DEFAULT_DATE_FORMAT.style,
    month: isMonth(o.month) ? o.month : DEFAULT_DATE_FORMAT.month,
    order: isOrder(o.order) ? o.order : DEFAULT_DATE_FORMAT.order,
  }
}

let current: DateFormatPrefs = DEFAULT_DATE_FORMAT
const listeners = new Set<() => void>()

export const getDateFormat = (): DateFormatPrefs => current

export function setDateFormat(next: DateFormatPrefs) {
  if (next.style === current.style && next.month === current.month && next.order === current.order) return
  current = next
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Subscribe a component to the format choice so it repaints when it changes. */
export function useDateFormat(): DateFormatPrefs {
  return useSyncExternalStore(subscribe, getDateFormat, getDateFormat)
}

// ── Assembling a date ────────────────────────────────────────────────────────

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const clock = (d: Date, locale: string) =>
  d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

/**
 * Day/month/year in the requested order.
 *
 * `auto` hands the whole job to Intl, which knows each language's convention.
 * An explicit order has to be assembled from the parts instead — Intl has no
 * "give me this locale's words in that order" option — so the month name comes
 * from the language and only the arrangement is ours.
 */
function assembleDate(d: Date, opts: { withYear: boolean; month: MonthStyle; order: DateOrder; locale: string }): string {
  const { withYear, month, order, locale } = opts
  const intlOpts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: month === 'name' ? 'short' : 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }
  if (order === 'auto') return d.toLocaleDateString(locale, intlOpts)

  const parts = new Intl.DateTimeFormat(locale, intlOpts).formatToParts(d)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  const day = part('day')
  const mon = part('month')
  const year = part('year')

  if (month === 'numeric') {
    // Two-digit numbers so the columns line up in a list; the separator is the
    // one each arrangement is normally written with.
    const dd = day.padStart(2, '0')
    const mm = mon.padStart(2, '0')
    const core = order === 'mdy' ? `${mm}/${dd}` : `${dd}.${mm}`
    if (!withYear) return core
    return order === 'mdy' ? `${core}/${year}` : `${core}.${year}`
  }
  const core = order === 'mdy' ? `${mon} ${day}` : `${day} ${mon}`
  if (!withYear) return core
  return order === 'mdy' ? `${core}, ${year}` : `${core} ${year}`
}

// ── Public formatters ────────────────────────────────────────────────────────

/** The whole truth, for tooltips: full date, full time, never shortened. */
export const exactTime = (iso: string, lang: Lang = getLang()): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const locale = localeOf(lang)
  const { month, order } = current
  return `${assembleDate(d, { withYear: true, month, order, locale })} · ${clock(d, locale)}`
}

/**
 * "şimdi" · "20 dk" · "3 sa" · "dün" · "3 Ağu"  (future: "3 sa sonra")
 *
 * Deliberately terse and without an "ago" marker (#91DEA4C5): these sit at the
 * end of dense rows and everything in a log has already happened. Future times
 * keep their marker — there the direction carries the meaning. That is also why
 * this builds its own strings instead of using Intl.RelativeTimeFormat, which
 * always renders the marker.
 */
export function humanTime(iso: string, now: Date = new Date(), lang: Lang = getLang()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, number>) => translate(lang, key, vars)

  const diffMs = d.getTime() - now.getTime()          // negative in the past
  const future = diffMs > 0
  const sec = Math.round(Math.abs(diffMs) / 1000)
  if (sec < 45) return t('time.justNow')

  const min = Math.round(sec / 60)
  if (min < 60) return t(future ? 'time.inMinutes' : 'time.minutes', { n: min })

  const hour = Math.round(min / 60)
  if (hour < 24) return t(future ? 'time.inHours' : 'time.hours', { n: hour })

  const day = Math.round(hour / 24)
  if (day === 1) return t(future ? 'time.tomorrow' : 'time.yesterday')
  if (day < 7) return t(future ? 'time.inDays' : 'time.days', { n: day })

  // Older than a week: "5 hafta" is harder to place than a real date.
  return compactDate(d, now, lang)
}

/** No year, and today collapses to the clock — the shape for dense rows. */
function compactDate(d: Date, now: Date, lang: Lang): string {
  const locale = localeOf(lang)
  if (sameDay(d, now)) return clock(d, locale)
  // The year is dropped as asked, except across a year boundary: "9 Eyl" for
  // something from two years ago would be wrong, not merely short.
  const withYear = d.getFullYear() !== now.getFullYear()
  return assembleDate(d, { withYear, month: current.month, order: current.order, locale })
}

/**
 * A moment in time (created, updated, commented), in the shape the reader chose.
 * This is what render sites should call; `humanTime` is only one of its answers.
 */
export function displayTime(iso: string, now: Date = new Date(), lang: Lang = getLang()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  switch (current.style) {
    case 'full': return exactTime(iso, lang)
    case 'compact': return compactDate(d, now, lang)
    default: return humanTime(iso, now, lang)
  }
}

/**
 * A calendar day with no time of day (a due date, an extra deadline).
 *
 * `humanized` maps to the compact shape here on purpose: a deadline written as
 * "3 gün sonra" reads fine until it is overdue, and the row it sits in already
 * says that in colour. The month/order choice still applies.
 */
export function displayDate(iso: string, lang: Lang = getLang()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const locale = localeOf(lang)
  const withYear = current.style === 'full' || d.getFullYear() !== new Date().getFullYear()
  return assembleDate(d, { withYear, month: current.month, order: current.order, locale })
}
