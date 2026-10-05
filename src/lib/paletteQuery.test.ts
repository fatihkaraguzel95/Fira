import { describe, expect, it } from 'vitest'
import { fold, levenshtein, termScore, matchScore } from './fuzzy'
import { parseQuery, parseDateRange, parseDuration, suggestOperators, insertOperator } from './paletteQuery'

describe('fuzzy', () => {
  it('folds Turkish and German letters and case', () => {
    expect(fold('Tamamlandı ŞİMDİ Işık Çağ Günü Größe')).toBe('tamamlandi simdi isik cag gunu grose')
  })
  it('measures edits', () => {
    expect(levenshtein('tamamlandi', 'tamanlamdi')).toBe(2)
    expect(levenshtein('', 'abc')).toBe(3)
  })
  it('accepts 80% similar words (the request\'s own example)', () => {
    expect(termScore('tamanlamdi', 'Tamamlandı olarak işaretle')).toBeCloseTo(0.8)
    expect(matchScore('tamanlamdi', 'Tamamlandı olarak işaretle')).toBeGreaterThanOrEqual(0.8)
  })
  it('matches ş/s, ı/i and case without typos', () => {
    expect(matchScore('SIRALAMA', 'Alt görevlerin sıralaması')).toBe(1)
    expect(matchScore('gorev', 'Görevlerim')).toBe(1)
  })
  it('keeps short words exact', () => {
    expect(termScore('tem', 'Tema: Koyu')).toBe(1)
    expect(termScore('tmea', 'Tema: Koyu')).toBe(0)
  })
  it('matches a half-typed word by its prefix', () => {
    expect(termScore('ayarlr', 'Ayarlar: Profil')).toBeGreaterThanOrEqual(0.8)
  })
  it('needs every word', () => {
    expect(matchScore('tema koyu', 'Tema: Koyu')).toBe(1)
    expect(matchScore('tema acik', 'Tema: Koyu')).toBe(0)
  })
})

describe('parseQuery', () => {
  const now = new Date(2026, 8, 18, 15, 0, 0)   // 18 Sep 2026 15:00 local

  it('splits words, phrases, exclusions and ids', () => {
    const p = parseQuery('ana sayfa "tek tıkla" -yeni #118F5C', now)
    expect(p.payload.terms).toEqual(['ana', 'sayfa'])
    expect(p.payload.phrases).toEqual(['tek tıkla'])
    expect(p.payload.not).toEqual(['yeni'])
    expect(p.shortIds).toEqual(['118F5C'])
    expect(p.searchable).toBe(true)
  })
  it('searches a bare hex-looking word as a word too', () => {
    const p = parseQuery('20250724', now)
    expect(p.shortIds).toEqual(['20250724'])
    expect(p.payload.terms).toEqual(['20250724'])
  })
  it('reads Turkish and English filter names alike', () => {
    const a = parseQuery('atanan:ben öncelik:yüksek var:dosya,yorum', now).payload
    const b = parseQuery('assignee:me priority:high has:file,comment', now).payload
    expect(a).toEqual(b)
    expect(a.assignee).toBe('@me')
    expect(a.priority).toBe('high')
    expect(a.has).toEqual(['file', 'comment'])
  })
  it('turns state words of durum: into a state, other values into a status name', () => {
    expect(parseQuery('durum:açık', now).payload.state).toBe('open')
    expect(parseQuery('is:done', now).payload.state).toBe('done')
    expect(parseQuery('durum:gecikmiş', now).payload.due).toBe('overdue')
    expect(parseQuery('durum:incelemede', now).payload.status).toBe('incelemede')
  })
  it('takes quoted values', () => {
    const p = parseQuery('liste:"Web sitesi" menü', now)
    expect(p.payload.list).toBe('Web sitesi')
    expect(p.payload.terms).toEqual(['menü'])
  })
  it('reads dates as local day/month/year ranges', () => {
    const d = parseDateRange('18-09-2026')!
    expect([d.from.getDate(), d.to.getDate()]).toEqual([18, 19])
    expect(parseDateRange('2026-09-18')!.from.getMonth()).toBe(8)
    const m = parseDateRange('09.2026')!
    expect([m.from.getMonth(), m.to.getMonth()]).toEqual([8, 9])
    const y = parseDateRange('2025')!
    expect([y.from.getFullYear(), y.to.getFullYear()]).toEqual([2025, 2026])
    expect(parseDateRange('31-02-2026')).toBeNull()
    expect(parseDateRange('dün', now)!.from.getDate()).toBe(17)
  })
  it('after: starts at the period, before: ends after it (both inclusive, as asked)', () => {
    expect(parseQuery('sonra:2026', now).payload.after).toBe(new Date(2026, 0, 1).toISOString())
    // "before:2025 — 2025'ten sonra hiçbir etkinliği olmayanlar": last activity before 1 Jan 2026
    expect(parseQuery('önce:2025', now).payload.before).toBe(new Date(2026, 0, 1).toISOString())
    const t = parseQuery('tarih:18-09-2026', now).payload
    expect([t.on_from, t.on_to]).toEqual([new Date(2026, 8, 18).toISOString(), new Date(2026, 8, 19).toISOString()])
  })
  it('reads durations in Turkish and English units', () => {
    expect(parseDuration('3sa')).toBe(3 * 3600e3)
    expect(parseDuration('3h')).toBe(3 * 3600e3)
    expect(parseDuration('2g')).toBe(2 * 86400e3)
    expect(parseDuration('1hafta')).toBe(604800e3)
    expect(parseDuration('30dk')).toBe(30 * 60e3)
    expect(parseDuration('1mo')).toBe(2592000e3)
    expect(parseDuration('abc')).toBeNull()
    expect(parseQuery('son:3sa', now).payload.after).toBe(new Date(now.getTime() - 3 * 3600e3).toISOString())
  })
  it('reads the kinds of tür:, drawings and whiteboards among them', () => {
    expect(parseQuery('tür:sayfa', now).payload.kinds).toEqual(['page'])
    expect(parseQuery('tür:çizim', now).payload.kinds).toEqual(['drawing'])
    expect(parseQuery('tür:Çizim', now).payload.kinds).toEqual(['drawing'])
    expect(parseQuery('tür:whiteboard', now).payload.kinds).toEqual(['whiteboard'])
    expect(parseQuery('type:drawing,whiteboard retro', now).payload).toMatchObject({ kinds: ['drawing', 'whiteboard'], terms: ['retro'] })
    expect(parseQuery('tür:çizim tür:sayfa', now).payload.kinds).toEqual(['drawing', 'page'])
    const bad = parseQuery('tür:resim', now)
    expect(bad.chips.map((c) => c.ok)).toEqual([false])
    expect(bad.payload.kinds).toBeUndefined()
  })
  it('marks values it cannot read and does not search on them', () => {
    const p = parseQuery('öncelik:süper tarih:32-13-2026', now)
    expect(p.chips.map((c) => c.ok)).toEqual([false, false])
    expect(p.payload.priority).toBeUndefined()
    expect(p.searchable).toBe(false)
  })
  it('treats an unknown name: as a word', () => {
    expect(parseQuery('Ör.: deneme', now).payload.terms).toEqual(['Ör.:', 'deneme'])
    expect(parseQuery('http://x.y', now).payload.terms).toEqual(['http://x.y'])
  })
  it('ignores a filter still being typed', () => {
    const p = parseQuery('atanan:', now)
    expect(p.chips).toEqual([])
    expect(p.searchable).toBe(false)
  })
  it('suggests filter names for the word being typed, all of them for "?"', () => {
    const q = 'menü ata'
    expect(suggestOperators(parseQuery(q, now), q).map((o) => o.key)).toContain('assignee')
    expect(suggestOperators(parseQuery('?', now), '?').length).toBeGreaterThan(10)
    expect(insertOperator(q, 'atanan')).toBe('menü atanan:')
    expect(insertOperator('?', 'son')).toBe('son:')
  })
})
