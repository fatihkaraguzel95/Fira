/**
 * Tekrarlayan görevlerin kural motoru (#59e0b75e, TK-1/TK-5).
 *
 * Aynı kural sunucuda da var (`fira_next_occurrence`, migration 084): görevi
 * sunucu üretir, istemci yalnız **hayalet** (henüz üretilmemiş) tekrarları ve
 * kuralın insan diline çevrilmiş hâlini gösterir. İki taraf aynı sonucu
 * vermeli — `recurrence.test.ts` SQL testlerindeki örneklerin aynısını tutar.
 *
 * Hesap kuralın kendi zaman diliminde yapılır: "her cuma 12:00" yaz saati
 * değişse de 12:00 kalır.
 */
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type RecurrenceTrigger = 'schedule' | 'completion'

export interface RecurrenceRule {
  freq: RecurrenceFreq
  /** Kaç periyotta bir (1 = her). */
  interval: number
  /** Haftalık kuralda ISO gün numaraları (1 = Pazartesi … 7 = Pazar). */
  byweekday?: number[] | null
  /** Aylık kuralda ayın günü; boşsa başlangıcın günü. */
  bymonthday?: number | null
  /** 'HH:MM' */
  at_time: string
  tz: string
  /** 'YYYY-MM-DD' */
  starts_on: string
  ends_on?: string | null
  trigger: RecurrenceTrigger
  /** Son tarihten kaç dakika önce hatırlatılsın; boşsa hatırlatma yok. */
  reminder_minutes?: number | null
}

/** Sunucudaki `ticket_recurrences` satırı. */
export interface TicketRecurrence {
  id: string
  project_id: string
  template_ticket_id: string
  freq: RecurrenceFreq
  interval_n: number
  byweekday: number[] | null
  bymonthday: number | null
  at_time: string
  tz: string
  starts_on: string
  ends_on: string | null
  trigger: RecurrenceTrigger
  reminder_minutes: number | null
  next_at: string
  active: boolean
  created_by: string | null
}

export interface RecurrenceOccurrence {
  id: string
  recurrence_id: string
  occurrence_no: number
  due_at: string
  outcome: 'created' | 'missed' | 'skipped'
  ticket_id: string | null
  reminded_at: string | null
}

export const DEFAULT_TZ = 'Europe/Istanbul'

export const ruleOf = (r: TicketRecurrence): RecurrenceRule => ({
  freq: r.freq, interval: r.interval_n, byweekday: r.byweekday, bymonthday: r.bymonthday,
  at_time: r.at_time.slice(0, 5), tz: r.tz, starts_on: r.starts_on, ends_on: r.ends_on,
  trigger: r.trigger, reminder_minutes: r.reminder_minutes,
})

/** Kuralın sunucuya gönderilen hâli (`set_ticket_recurrence` p_rule). */
export const rulePayload = (rule: RecurrenceRule) => ({
  freq: rule.freq,
  interval: rule.interval,
  byweekday: rule.freq === 'weekly' ? (rule.byweekday ?? null) : null,
  bymonthday: rule.freq === 'monthly' || rule.freq === 'yearly' ? (rule.bymonthday ?? null) : null,
  at_time: rule.at_time,
  tz: rule.tz,
  starts_on: rule.starts_on,
  ends_on: rule.ends_on || null,
  trigger: rule.trigger,
  reminder_minutes: rule.reminder_minutes ?? null,
})

// ── Zaman dilimi yardımcıları ────────────────────────────────────────────────
const partsIn = (date: Date, tz: string) => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(date)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  // Gece yarısı "24" gelebiliyor (Intl), 0'a çevir.
  return { y: p.year, m: p.month, d: p.day, hh: p.hour % 24, mm: p.minute, ss: p.second }
}

const offsetMs = (date: Date, tz: string) => {
  const p = partsIn(date, tz)
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(date.getTime() / 1000) * 1000
}

/** O zaman dilimindeki duvar saatini gerçek ana çevirir (yaz saati dahil). */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const first = new Date(guess - offsetMs(new Date(guess), tz))
  return new Date(guess - offsetMs(first, tz))
}

/** Bir anın o zaman dilimindeki takvim günü ('YYYY-MM-DD'). */
export const dayIn = (date: Date, tz: string) => {
  const p = partsIn(date, tz)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

// ── Kural motoru ─────────────────────────────────────────────────────────────
const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}
/** ISO gün numarası (1 = Pazartesi … 7 = Pazar) — takvim gününden, saat dilimsiz. */
const isoDow = (y: number, m: number, d: number) => ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1
const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000)
/** Pazartesiye yaslanmış hafta numarası (SQL'deki date_trunc('week', …) ile aynı). */
const weekNumber = (y: number, m: number, d: number) => Math.floor((dayNumber(y, m, d) - (isoDow(y, m, d) - 1)) / 7)

/**
 * `after`dan **kesinlikle sonraki** tekrar. Gün gün ilerler (kural gün bazlı),
 * üst sınır 1500 gün — yıllık kuralda 4 aralığa kadar yeter; bulunamazsa null.
 */
export function nextOccurrence(rule: RecurrenceRule, after: Date = new Date()): Date | null {
  const start = parseDay(rule.starts_on)
  const ends = rule.ends_on ? parseDay(rule.ends_on) : null
  const [hh, mm] = rule.at_time.split(':').map(Number)
  const days = rule.byweekday?.length ? rule.byweekday : [isoDow(start.y, start.m, start.d)]
  const monthday = rule.bymonthday ?? start.d
  const interval = Math.max(1, rule.interval || 1)

  const from = parseDay(dayIn(after, rule.tz))
  let n = Math.max(dayNumber(start.y, start.m, start.d), dayNumber(from.y, from.m, from.d))
  const startNo = dayNumber(start.y, start.m, start.d)
  const endNo = ends ? dayNumber(ends.y, ends.m, ends.d) : null

  for (let i = 0; i < 1500; i++, n++) {
    if (endNo !== null && n > endNo) return null
    const dt = new Date(n * 86400000)
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate()
    let match = false
    if (rule.freq === 'daily') match = (n - startNo) % interval === 0
    else if (rule.freq === 'weekly') {
      match = days.includes(isoDow(y, m, d))
        && (weekNumber(y, m, d) - weekNumber(start.y, start.m, start.d)) % interval === 0
    } else if (rule.freq === 'monthly') {
      match = d === monthday && ((y - start.y) * 12 + (m - start.m)) % interval === 0
    } else if (rule.freq === 'yearly') {
      match = m === start.m && d === monthday && (y - start.y) % interval === 0
    }
    if (!match) continue
    const cand = zonedToUtc(y, m, d, hh || 0, mm || 0, rule.tz)
    if (cand.getTime() > after.getTime()) return cand
  }
  return null
}

/** Sıradaki n tekrar — hayalet satırlar bundan çizilir (TK-5). */
export function previewOccurrences(rule: RecurrenceRule, count = 5, after: Date = new Date()): Date[] {
  const out: Date[] = []
  let cursor = after
  for (let i = 0; i < Math.min(Math.max(count, 1), 50); i++) {
    const next = nextOccurrence(rule, cursor)
    if (!next) break
    out.push(next)
    cursor = next
  }
  return out
}

/** Hayaletler kuralın kendi ufkunda kalsın: varsayılan 4 hafta ya da 10 tekrar. */
export const GHOST_HORIZON_DAYS = 28
export const GHOST_LIMIT = 10

export function ghostDates(rule: RecurrenceRule, from: Date = new Date(), horizonDays = GHOST_HORIZON_DAYS): Date[] {
  const limit = Date.now() + horizonDays * 86400000
  return previewOccurrences(rule, GHOST_LIMIT, from).filter((d) => d.getTime() <= limit)
}
