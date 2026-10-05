import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextOccurrence, previewOccurrences, ghostDates, zonedToUtc, type RecurrenceRule } from './recurrence'

const TZ = 'Europe/Istanbul'
const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  freq: 'weekly', interval: 1, at_time: '12:00', tz: TZ, starts_on: '2026-09-01', trigger: 'schedule', ...over,
})
/** Yerel (kural zaman dilimi) okunuşu: SQL testlerindeki biçimin aynısı. */
const local = (d: Date | null) => d && new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(d).replace(/^(\w+), (\d+)\/(\d+)\/(\d+), (\d+):(\d+)$/, '$4-$3-$2 $5:$6 $1')

describe('nextOccurrence — SQL ile aynı sonuçlar (084 recurrence-tests.sql)', () => {
  it('her cuma 12:00', () => {
    const r = rule({ byweekday: [5] })
    expect(local(nextOccurrence(r, new Date('2026-09-21T06:00:00Z')))).toBe('2026-09-25 12:00 Fri')
  })

  it('iki haftada bir pazartesi', () => {
    const r = rule({ byweekday: [1], interval: 2, at_time: '09:00', starts_on: '2026-09-14' })
    expect(local(nextOccurrence(r, new Date('2026-09-21T06:00:00Z')))).toBe('2026-09-28 09:00 Mon')
  })

  it('ayın 31i olmayan ayı atlar', () => {
    const r = rule({ freq: 'monthly', bymonthday: 31, at_time: '10:00', starts_on: '2026-01-31' })
    expect(local(nextOccurrence(r, new Date('2026-01-31T09:00:00Z')))).toBe('2026-03-31 10:00 Tue')
  })

  it('bitiş tarihi geçmişse tekrar yok', () => {
    const r = rule({ freq: 'daily', interval: 3, at_time: '08:00', starts_on: '2026-09-21', ends_on: '2026-09-22' })
    expect(nextOccurrence(r, new Date('2026-09-25T00:00:00Z'))).toBeNull()
  })

  it('aynı gün saat geçmişse ertesi tekrara gider', () => {
    const r = rule({ freq: 'daily', at_time: '08:00', starts_on: '2026-09-01' })
    expect(local(nextOccurrence(r, new Date('2026-09-21T06:00:00Z')))).toBe('2026-09-22 08:00 Tue')
  })

  it('yıllık kural yılı atlar', () => {
    const r = rule({ freq: 'yearly', at_time: '09:00', starts_on: '2026-03-15' })
    expect(local(nextOccurrence(r, new Date('2026-06-01T00:00:00Z')))).toBe('2027-03-15 09:00 Mon')
  })

  it('haftada iki gün', () => {
    const r = rule({ byweekday: [1, 5] })
    // 21 Eylül pazartesi, yerel saat 09:00: o günün 12:00'si hâlâ önümüzde.
    const first = nextOccurrence(r, new Date('2026-09-21T06:00:00Z'))
    expect(local(first)).toBe('2026-09-21 12:00 Mon')
    expect(local(nextOccurrence(r, first!))).toBe('2026-09-25 12:00 Fri')
  })
})

describe('yaz saati', () => {
  it('geçişin iki yanında da duvar saati aynı kalır', () => {
    // Avrupa'da saatler 25 Ekim 2026 gecesi geri alınıyor; "her pazar 12:00" 12:00 kalmalı.
    const r = rule({ byweekday: [7], tz: 'Europe/Berlin', starts_on: '2026-10-01' })
    const before = nextOccurrence(r, new Date('2026-10-13T00:00:00Z'))!  // 18 Ekim (yaz saati)
    const after = nextOccurrence(r, before)!
    const hour = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour12: false, hour: '2-digit' }).format(d)
    expect(hour(before)).toBe(hour(after))
    expect(after.getTime() - before.getTime()).toBe((7 * 24 + 1) * 3600 * 1000) // saat geri alındı: bir saat uzun hafta
  })

  it('zonedToUtc yaz ve kış saatini ayırır', () => {
    expect(zonedToUtc(2026, 7, 1, 12, 0, TZ).toISOString()).toBe('2026-07-01T09:00:00.000Z') // TRT hep +03
    expect(zonedToUtc(2026, 7, 1, 12, 0, 'Europe/Berlin').toISOString()).toBe('2026-07-01T10:00:00.000Z')
    expect(zonedToUtc(2026, 12, 1, 12, 0, 'Europe/Berlin').toISOString()).toBe('2026-12-01T11:00:00.000Z')
  })
})

describe('hayalet tekrarlar', () => {
  it('istenen sayıda ve sırayla üretir', () => {
    const r = rule({ byweekday: [5] })
    const list = previewOccurrences(r, 3, new Date('2026-09-21T06:00:00Z')).map(local)
    expect(list).toEqual(['2026-09-25 12:00 Fri', '2026-10-02 12:00 Fri', '2026-10-09 12:00 Fri'])
  })

  // Ufuk **bugünden** sayılıyor; saat sabitlenmezse test takvim ilerledikçe
  // kendiliğinden kırılıyor (25 Eyl 2026'da kırıldı da).
  afterEach(() => vi.useRealTimers())

  it('ufkun dışına taşmaz', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T06:00:00Z'))
    const r = rule({ byweekday: [5] })
    const list = ghostDates(r, new Date('2026-09-21T06:00:00Z'), 14)
    expect(list.map(local)).toEqual(['2026-09-25 12:00 Fri', '2026-10-02 12:00 Fri'])
  })

  it('biten kuralda boş döner', () => {
    const r = rule({ byweekday: [5], ends_on: '2026-09-22' })
    expect(ghostDates(r, new Date('2026-09-21T06:00:00Z'))).toEqual([])
  })
})
