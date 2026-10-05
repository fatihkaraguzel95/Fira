import { fold } from './fuzzy'
import type { TranslationKey } from '../i18n'

/**
 * The command palette's query language (#43a865fb). A query is words and
 * filters, GitHub-style:
 *
 *   ana sayfa                 words: fuzzy (typos, ş/s, ı/i, case) in titles, exact in descriptions
 *   "tek tıkla"               a phrase: exact (still case- and ş/s-insensitive), title or description
 *   -yeni                     leave out titles containing "yeni"
 *   #118F5C                   the short id the board prints
 *   atanan:ben son:3sa        filters — every filter has a Turkish and an English name
 *
 * parseQuery is pure (tests in paletteQuery.test.ts); the server does the matching
 * (`palette_search`, migration 082). Dates are read in the viewer's local time.
 */
/** What `tür:` can ask for. `page` is a text page; a drawing and a whiteboard are kinds of their own (114). */
export type SearchKind = 'ticket' | 'project' | 'page' | 'drawing' | 'whiteboard'

export type OpKey =
  | 'assignee' | 'creator' | 'status' | 'priority' | 'tag' | 'list' | 'team'
  | 'comment' | 'has' | 'type' | 'due' | 'after' | 'before' | 'date' | 'created' | 'last'

export interface OperatorDef {
  key: OpKey
  /** Accepted names, folded; the first is the Turkish display name, the second the English one. */
  names: string[]
  descKey: TranslationKey
  /** Display name in Turkish / English (with Turkish letters; parsing folds them anyway). */
  label: [string, string]
  /** Example value in Turkish / English. */
  example: [string, string]
}

export const OPERATORS: OperatorDef[] = [
  { key: 'assignee', names: ['atanan', 'assignee', 'ata'], descKey: 'board.palette.op.assignee', label: ['atanan', 'assignee'], example: ['ben', 'me'] },
  { key: 'creator', names: ['olusturan', 'creator', 'by'], descKey: 'board.palette.op.creator', label: ['oluşturan', 'creator'], example: ['halil', 'halil'] },
  // durum:açık / tamamlandı / gecikmiş are states; any other value is a status (column) name.
  { key: 'status', names: ['durum', 'status', 'is'], descKey: 'board.palette.op.status', label: ['durum', 'status'], example: ['açık', 'open'] },
  { key: 'priority', names: ['oncelik', 'priority'], descKey: 'board.palette.op.priority', label: ['öncelik', 'priority'], example: ['yüksek', 'high'] },
  { key: 'tag', names: ['etiket', 'tag'], descKey: 'board.palette.op.tag', label: ['etiket', 'tag'], example: ['altyapı', 'infra'] },
  { key: 'list', names: ['liste', 'list', 'in'], descKey: 'board.palette.op.list', label: ['liste', 'list'], example: ['"web sitesi"', '"web site"'] },
  { key: 'team', names: ['takim', 'team'], descKey: 'board.palette.op.team', label: ['takım', 'team'], example: ['pars', 'pars'] },
  { key: 'comment', names: ['yorum', 'comment'], descKey: 'board.palette.op.comment', label: ['yorum', 'comment'], example: ['konfeti', 'confetti'] },
  { key: 'has', names: ['var', 'has'], descKey: 'board.palette.op.has', label: ['var', 'has'], example: ['dosya', 'file'] },
  { key: 'type', names: ['tur', 'type'], descKey: 'board.palette.op.type', label: ['tür', 'type'], example: ['sayfa', 'page'] },
  { key: 'due', names: ['bitis', 'due'], descKey: 'board.palette.op.due', label: ['bitiş', 'due'], example: ['gecikmiş', 'overdue'] },
  { key: 'last', names: ['son', 'last'], descKey: 'board.palette.op.last', label: ['son', 'last'], example: ['3sa', '3h'] },
  { key: 'after', names: ['sonra', 'after'], descKey: 'board.palette.op.after', label: ['sonra', 'after'], example: ['2026', '2026'] },
  { key: 'before', names: ['once', 'before'], descKey: 'board.palette.op.before', label: ['önce', 'before'], example: ['2025', '2025'] },
  { key: 'date', names: ['tarih', 'date', 'on'], descKey: 'board.palette.op.date', label: ['tarih', 'date'], example: ['18-09-2026', '18-09-2026'] },
  { key: 'created', names: ['olusturma', 'created'], descKey: 'board.palette.op.created', label: ['oluşturma', 'created'], example: ['09-2026', '09-2026'] },
]

const BY_NAME = new Map<string, OperatorDef>()
for (const op of OPERATORS) for (const n of op.names) BY_NAME.set(n, op)

export interface PaletteSearchPayload {
  terms: string[]
  not: string[]
  phrases: string[]
  kinds?: SearchKind[]
  assignee?: string
  creator?: string
  status?: string
  state?: 'open' | 'done'
  priority?: 'critical' | 'high' | 'medium' | 'low' | 'none'
  tag?: string
  list?: string
  team?: string
  comment?: string
  has?: string[]
  due?: 'overdue' | 'today' | 'week' | 'none'
  after?: string
  before?: string
  on_from?: string
  on_to?: string
  created_from?: string
  created_to?: string
  /** Kesin kapsam (098): bağlama çubuğu yalnız bulunulan listede / takımda arar. */
  project_id?: string
  team_id?: string
}

/** A filter as the palette shows it under the box. */
export interface FilterChip {
  op: OpKey
  /** The name the user typed (folded) — shown back as written. */
  name: string
  value: string
  ok: boolean
}

export interface ParsedQuery {
  payload: PaletteSearchPayload
  chips: FilterChip[]
  /** "#118F5C" tokens. */
  shortIds: string[]
  /** True when there is something to ask the server. */
  searchable: boolean
  /** The word being typed when it could become a filter name (for suggestions). */
  partialName: string | null
}

// ── Values ────────────────────────────────────────────────────────────────────
const pick = <T extends string>(v: string, table: Record<string, T>): T | undefined => table[fold(v)]

const PRIORITY: Record<string, PaletteSearchPayload['priority'] & string> = {
  kritik: 'critical', critical: 'critical', acil: 'critical',
  yuksek: 'high', high: 'high',
  orta: 'medium', medium: 'medium', normal: 'medium',
  dusuk: 'low', low: 'low',
  yok: 'none', none: 'none',
}
const HAS: Record<string, string> = {
  dosya: 'file', ek: 'file', file: 'file', attach: 'file', attachment: 'file', dosyasi: 'file',
  yorum: 'comment', comment: 'comment',
  bitis: 'due', tarih: 'due', due: 'due',
  altgorev: 'subtask', alt: 'subtask', subtask: 'subtask',
  aciklama: 'desc', desc: 'desc', description: 'desc',
  bag: 'link', baglanti: 'link', link: 'link',
}
// A drawing and a whiteboard are rows of `pages`, asked for by their own names (114). "whiteboard" is the
// word the app itself uses in Turkish too; "tahta" is accepted for who types it.
const TYPE: Record<string, SearchKind> = {
  gorev: 'ticket', task: 'ticket', ticket: 'ticket',
  liste: 'project', list: 'project',
  sayfa: 'page', page: 'page',
  cizim: 'drawing', drawing: 'drawing', zeichnung: 'drawing',
  whiteboard: 'whiteboard', tahta: 'whiteboard', beyaztahta: 'whiteboard',
}
const DUE: Record<string, PaletteSearchPayload['due'] & string> = {
  bugun: 'today', today: 'today',
  gecmis: 'overdue', gecikmis: 'overdue', overdue: 'overdue',
  hafta: 'week', week: 'week',
  yok: 'none', none: 'none',
}
const ME = new Set(['ben', 'me', '@me', 'bana'])
const NOBODY = new Set(['yok', 'none', 'kimse', 'nobody'])

/** A day, a month or a year in local time, as [from, to). */
export function parseDateRange(raw: string, now = new Date()): { from: Date; to: Date } | null {
  const v = fold(raw.trim())
  const day = (y: number, m: number, d: number) => {
    const from = new Date(y, m - 1, d)
    if (from.getFullYear() !== y || from.getMonth() !== m - 1 || from.getDate() !== d) return null
    return { from, to: new Date(y, m - 1, d + 1) }
  }
  if (v === 'bugun' || v === 'today') return day(now.getFullYear(), now.getMonth() + 1, now.getDate())
  if (v === 'dun' || v === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); return day(d.getFullYear(), d.getMonth() + 1, d.getDate()) }
  let m = v.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/)
  if (m) return day(+m[3], +m[2], +m[1])
  m = v.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
  if (m) return day(+m[1], +m[2], +m[3])
  const month = (y: number, mo: number) => (mo < 1 || mo > 12 ? null : { from: new Date(y, mo - 1, 1), to: new Date(y, mo, 1) })
  m = v.match(/^(\d{1,2})[-./](\d{4})$/)
  if (m) return month(+m[2], +m[1])
  m = v.match(/^(\d{4})[-./](\d{1,2})$/)
  if (m) return month(+m[1], +m[2])
  m = v.match(/^(\d{4})$/)
  if (m) return { from: new Date(+m[1], 0, 1), to: new Date(+m[1] + 1, 0, 1) }
  return null
}

/** "3sa", "3h", "2g", "2d", "1hf", "1w", "30dk", "30m", "1ay", "1mo" → milliseconds. */
export function parseDuration(raw: string): number | null {
  const m = fold(raw.trim()).match(/^(\d+)\s*(dk|dakika|min|m|sa|saat|h|g|gun|d|hf|hafta|w|ay|mo)$/)
  if (!m) return null
  const n = +m[1]
  const unit = { dk: 60e3, dakika: 60e3, min: 60e3, m: 60e3, sa: 3600e3, saat: 3600e3, h: 3600e3, g: 86400e3, gun: 86400e3, d: 86400e3, hf: 604800e3, hafta: 604800e3, w: 604800e3, ay: 2592000e3, mo: 2592000e3 }[m[2]]!
  return n > 0 ? n * unit : null
}

// ── Tokens ────────────────────────────────────────────────────────────────────
interface Token { neg: boolean; name: string | null; value: string; quoted: boolean; raw: string }

function tokenize(q: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < q.length) {
    while (i < q.length && /\s/.test(q[i])) i++
    if (i >= q.length) break
    const start = i
    let neg = false
    if (q[i] === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])) { neg = true; i++ }
    if (q[i] === '"') {
      const end = q.indexOf('"', i + 1)
      const value = q.slice(i + 1, end < 0 ? q.length : end)
      i = end < 0 ? q.length : end + 1
      out.push({ neg, name: null, value, quoted: true, raw: q.slice(start, i) })
      continue
    }
    let j = i
    while (j < q.length && !/\s/.test(q[j]) && q[j] !== ':') j++
    if (q[j] === ':' && j > i) {
      const name = q.slice(i, j)
      let k = j + 1
      let value: string, quoted = false
      if (q[k] === '"') {
        const end = q.indexOf('"', k + 1)
        value = q.slice(k + 1, end < 0 ? q.length : end); quoted = true
        k = end < 0 ? q.length : end + 1
      } else {
        const e = k; while (k < q.length && !/\s/.test(q[k])) k++
        value = q.slice(e, k)
      }
      out.push({ neg, name, value, quoted, raw: q.slice(start, k) })
      i = k
      continue
    }
    while (j < q.length && !/\s/.test(q[j])) j++
    out.push({ neg, name: null, value: q.slice(i, j), quoted: false, raw: q.slice(start, j) })
    i = j
  }
  return out
}

export function parseQuery(q: string, now = new Date()): ParsedQuery {
  const payload: PaletteSearchPayload = { terms: [], not: [], phrases: [] }
  const chips: FilterChip[] = []
  const shortIds: string[] = []
  const tokens = tokenize(q)
  const iso = (d: Date) => d.toISOString()
  let filters = 0

  for (const tk of tokens) {
    const op = tk.name ? BY_NAME.get(fold(tk.name)) : undefined
    if (tk.name && op) {
      const v = tk.value.trim()
      if (!v) continue   // "atanan:" still being typed
      let ok = true
      const f = fold(v)
      switch (op.key) {
        case 'assignee': payload.assignee = ME.has(f) ? '@me' : NOBODY.has(f) ? '@none' : v; break
        case 'creator': payload.creator = ME.has(f) ? '@me' : v; break
        case 'status':
          if (['acik', 'open', 'acikta'].includes(f)) payload.state = 'open'
          else if (['tamam', 'tamamlandi', 'kapali', 'done', 'closed', 'bitti', 'tamamlanan'].includes(f)) payload.state = 'done'
          else if (['gecikmis', 'gecmis', 'overdue'].includes(f)) payload.due = 'overdue'
          else payload.status = v
          break
        case 'priority': { const p = pick(v, PRIORITY); if (p) payload.priority = p; else ok = false; break }
        case 'tag': payload.tag = v; break
        case 'list': payload.list = v; break
        case 'team': payload.team = v; break
        case 'comment': payload.comment = v; break
        case 'has': {
          const vals = v.split(',').map((x) => pick(x, HAS))
          if (vals.some((x) => !x)) ok = false
          else payload.has = [...new Set([...(payload.has ?? []), ...(vals as string[])])]
          break
        }
        case 'type': {
          const vals = v.split(',').map((x) => pick(x, TYPE))
          if (vals.some((x) => !x)) ok = false
          else payload.kinds = [...new Set([...(payload.kinds ?? []), ...(vals as SearchKind[])])]
          break
        }
        case 'due': { const d = pick(v, DUE); if (d) payload.due = d; else ok = false; break }
        case 'last': { const ms = parseDuration(v); if (ms) payload.after = iso(new Date(now.getTime() - ms)); else ok = false; break }
        case 'after': { const r = parseDateRange(v, now); if (r) payload.after = iso(r.from); else ok = false; break }
        case 'before': { const r = parseDateRange(v, now); if (r) payload.before = iso(r.to); else ok = false; break }
        case 'date': { const r = parseDateRange(v, now); if (r) { payload.on_from = iso(r.from); payload.on_to = iso(r.to) } else ok = false; break }
        case 'created': { const r = parseDateRange(v, now); if (r) { payload.created_from = iso(r.from); payload.created_to = iso(r.to) } else ok = false; break }
      }
      chips.push({ op: op.key, name: fold(tk.name), value: v, ok })
      if (ok) filters++
      continue
    }
    if (tk.quoted && !tk.name) { if (tk.value.trim()) (tk.neg ? payload.not : payload.phrases).push(tk.value.trim()); continue }
    const word = tk.name ? tk.raw.replace(/^-/, '') : tk.value
    // "#118F5C" is an id; a bare "118f5c" may also be a word in a title, so it is searched both ways.
    if (!tk.neg && /^#?[0-9a-f]{6,32}$/i.test(word) && /[0-9]/.test(word)) {
      shortIds.push(word.replace(/^#/, ''))
      if (word.startsWith('#')) continue
    }
    if (tk.neg) payload.not.push(word)
    else payload.terms.push(word)
  }

  const last = tokens[tokens.length - 1]
  const trailingSpace = /\s$/.test(q)
  const partialName = last && !trailingSpace && !last.name && !last.quoted && !last.neg && /^[\p{L}]+$/u.test(last.value) ? fold(last.value) : null
  const termChars = payload.terms.join('').length + payload.phrases.join('').length
  return {
    payload,
    chips,
    shortIds,
    searchable: termChars >= 2 || filters > 0,
    partialName,
  }
}

/** Filters whose name starts with what is being typed ("ata" → atanan:). "?" lists them all. */
export function suggestOperators(parsed: ParsedQuery, query: string): OperatorDef[] {
  if (query.trim() === '?') return OPERATORS
  const p = parsed.partialName
  if (!p || p.length < 2) return []
  return OPERATORS.filter((op) => op.names.some((n) => n.startsWith(p) && n !== p)).slice(0, 4)
}

/** The query with its last (partial) word replaced by `name:` — or appended. */
export function insertOperator(query: string, name: string): string {
  if (query.trim() === '?') return `${name}:`
  if (/\s$/.test(query) || !query) return `${query}${name}:`
  return query.replace(/\S+$/, `${name}:`)
}
