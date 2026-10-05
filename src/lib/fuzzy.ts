/**
 * Typo-tolerant, Turkish-aware text matching (#43a865fb). The same rules as the
 * database's `fira_fold` / `fira_term_score` (migration 082), so the command
 * palette ranks its client-side items (commands, teams) the way the server
 * ranks tasks, lists and pages.
 *
 *  - fold: lower case, Turkish/German letters folded (ş→s, ı/İ→i, ğ→g, ç→c, ö→o, ü→u, ä→a, ß→s)
 *  - a term that occurs in the text scores 1
 *  - otherwise the best Levenshtein similarity against the text's words (and against each
 *    word's prefix of the term's length, for a half-typed word): 1 - distance / longer length
 *  - a term shorter than 5 letters must occur as it is (80% of 4 letters allows no typo anyway)
 *  - a match needs 0.8 — "tamanlamdi" vs "tamamlandı" is 2 edits in 10 letters = 0.8
 *  - Türkçe ağırlıklı mesafe (0.72.1, #06903c11, migration 099): ç ğ ı ö ş ü yazılamayınca
 *    ya ASCII karşılığı yazılıyor (ö → o, bedava: katlama) ya da hiç yazılmıyor. Kelimede
 *    bu harflerden biri varsa ağırlıklı Levenshtein da hesaplanır: bu harfin atlanması
 *    0,5, diğer her düzeltme 1 (3–4 harfli terimde diğer düzeltmelere izin yok). Kelimenin
 *    önekleriyle de karşılaştırılır (yarım yazılmış kelime). Karışık yazım da tutar:
 *    "skstrma" / "sıkıştırma" = üç ı atlanmış, ş → s → 1,5 / 10 → 0,85.
 *    "grev" / "görev" = 0,5 / 5 → 0,9; "gırev" / "görev" = 1 / 5 → 0,8 (düz yol).
 *    Hız için (sunucuda aynısı): bu yol yalnız terim, metnin bu harfler çıkarılmış
 *    hâlinde geçiyorsa ya da terimin c g i o s u dışındaki harfleri (en az 3) metnin
 *    aynı harfleri çıkarılmış hâlinde geçiyorsa çalışır.
 */
export const MATCH = 0.8

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u', ä: 'a', ß: 's' }

export function fold(s: string): string {
  // Turkish capitals first (toLowerCase would turn İ into "i̇" with a combining dot).
  return s.replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase().replace(/[çğıöşüâîûäß]|i̇/g, (c) => FOLD[c] ?? c)
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Harfleri yazılamayınca atlanan Türkçe harfler (küçük harfe çevrilmiş metinde). */
const OMITTABLE = /[çğıöşü]/
const OMITTABLE_ANY = /[çğıöşüÇĞÖŞÜ]/g
/** Katlanınca bu harflerin yerine geçen ASCII harfler: ön süzgeçte ikisi de atılır. */
const FOLD_TARGETS = /[cgiosu]/g

/**
 * Türkçe ağırlıklı benzerlik (0..1): terim (katlanmış) ile kelime (küçük harf, Türkçe
 * harfler yerinde) arasında; kelimenin her önekine karşı en iyisi. Katlanmış harf
 * eşleşmesi bedava, ç ğ ı ö ş ü atlanması 0,5, diğer düzeltme 1 (kısa terimde yasak).
 * Sunucudaki `fira_tr_similarity` (099) ile aynı.
 */
export function trSimilarity(term: string, word: string): number {
  const n = term.length, m = word.length
  if (!n || !m) return 0
  const full = n < 5 ? 100 : 1
  const del = (c: string) => (OMITTABLE.test(c) ? 0.5 : full)
  let prev: number[] = [0]
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + del(word[j - 1])
  for (let i = 1; i <= n; i++) {
    const cur = [i * full]
    for (let j = 1; j <= m; j++) {
      const same = fold(word[j - 1]) === term[i - 1]
      cur[j] = Math.min(prev[j] + full, cur[j - 1] + del(word[j - 1]), prev[j - 1] + (same ? 0 : full))
    }
    prev = cur
  }
  let best = 0
  for (let j = 1; j <= m; j++) best = Math.max(best, 1 - prev[j] / Math.max(n, j))
  return best
}

/** Best similarity (0..1) of one already-folded term against a text. */
export function termScore(term: string, text: string): number {
  if (!term) return 1
  if (fold(text).includes(term)) return 1
  if (term.length < 3) return 0
  const skeleton = fold(text.replace(OMITTABLE_ANY, ''))
  const core = term.replace(FOLD_TARGETS, '')
  const turkish = skeleton.includes(term) || (core.length >= 3 && skeleton.replace(FOLD_TARGETS, '').includes(core))
  // Words with their Turkish letters still in (capitals first, as in `fold`).
  const lowered = text.replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase()
  let best = 0
  for (const w of lowered.split(/[^a-z0-9çğıöşüâîûäß]+/)) {
    if (!w) continue
    const f = fold(w)
    if (term.length >= 5) {
      best = Math.max(best, 1 - levenshtein(term, f) / Math.max(term.length, f.length))
      if (f.length > term.length) best = Math.max(best, 1 - levenshtein(term, f.slice(0, term.length)) / term.length)
    }
    if (turkish && OMITTABLE.test(w)) best = Math.max(best, trSimilarity(term, w))
    if (best === 1) break
  }
  return best
}

/** Every word of the query must match; the result is their average score, 0 when one fails. */
export function matchScore(query: string, text: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return 1
  let sum = 0
  for (const w of words) {
    const s = termScore(w, text)
    if (s < MATCH) return 0
    sum += s
  }
  return sum / words.length
}
