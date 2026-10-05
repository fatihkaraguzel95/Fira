/**
 * Reading languages and translations (113, #fa4b05e9).
 *
 * Each person says which languages they read and which one the rest should be translated into
 * (`user_preferences` global `reading`: `{ read: ['tr', 'en'], to: 'tr' }`). The server prepares
 * translations from these (as a passive job, when the team turned it on); this module decides what
 * a reader is shown.
 *
 * The rule for showing a translation has three parts, all of which must hold:
 *   - the row is a finished translation into the reader's language,
 *   - it was made for exactly the text on the screen (its hash is the text's hash): a translation
 *     of an older text is never shown under a newer one,
 *   - the text is not in a language the reader reads.
 */

export interface Reading { read: string[]; to: string | null }
export const NO_READING: Reading = { read: [], to: null }

/** The languages offered in the settings, each written in its own language. */
export const READ_LANGS: { id: string; endonym: string }[] = [
  { id: 'tr', endonym: 'Türkçe' },
  { id: 'en', endonym: 'English' },
  { id: 'de', endonym: 'Deutsch' },
  { id: 'fr', endonym: 'Français' },
  { id: 'es', endonym: 'Español' },
  { id: 'it', endonym: 'Italiano' },
  { id: 'nl', endonym: 'Nederlands' },
  { id: 'pl', endonym: 'Polski' },
  { id: 'pt', endonym: 'Português' },
  { id: 'ru', endonym: 'Русский' },
  { id: 'uk', endonym: 'Українська' },
  { id: 'ar', endonym: 'العربية' },
]

const CODE = /^[a-z]{2,3}$/

/** What is stored, made safe: known shape, lower case, no repeats; the target is one of the languages read. */
export function normalizeReading(raw: unknown): Reading {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NO_READING
  const r = raw as { read?: unknown; to?: unknown }
  const read = [...new Set((Array.isArray(r.read) ? r.read : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter((x) => CODE.test(x)))]
  const to = typeof r.to === 'string' && CODE.test(r.to.trim().toLowerCase()) ? r.to.trim().toLowerCase() : null
  if (!read.length || !to) return NO_READING
  return { read: read.includes(to) ? read : [to, ...read], to }
}

/**
 * The preference after a language is ticked or unticked. Unticking the target moves the target to
 * the first language left; unticking the last language turns translation off (nothing is stored).
 */
export function toggleReadLang(now: Reading, lang: string, uiLang: string): Reading {
  const has = now.read.includes(lang)
  const read = has ? now.read.filter((l) => l !== lang) : [...now.read, lang]
  if (!read.length) return NO_READING
  const to = now.to && read.includes(now.to) ? now.to : read.includes(uiLang) ? uiLang : read[0]
  return { read, to }
}

/** A language's name in the language of the screen ("İngilizce"); the code itself when the browser has no name for it. */
export function langName(code: string | null | undefined, uiLang: string): string {
  if (!code) return ''
  try { return new Intl.DisplayNames([uiLang], { type: 'language' }).of(code) ?? code } catch { return code }
}

export interface TranslationRow {
  comment_id: string | null
  source_hash: string
  source_lang: string | null
  status: string
  text: string | null
}

/**
 * The translation to show for a text, or null (show the text as it is).
 * `hash` is the hash of the text on the screen; null while it is being computed.
 */
export function translationFor(row: TranslationRow | null | undefined, hash: string | null, reading: Reading): string | null {
  if (!row || !hash || !reading.to) return null
  if (row.status !== 'done' || !row.text) return null
  if (row.source_hash !== hash) return null
  if (row.source_lang && reading.read.includes(row.source_lang)) return null
  return row.text
}

/** sha256 of a text as lower-case hex, the same value the server stores (`encode(sha256(convert_to(t, 'UTF8')), 'hex')`). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
