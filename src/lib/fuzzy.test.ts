import { describe, expect, it } from 'vitest'
import { MATCH, fold, matchScore, termScore } from './fuzzy'

const score = (q: string, text: string) => termScore(fold(q), text)

describe('termScore — Türkçe harf atlama (#06903c11)', () => {
  it('finds "görev" from "grev" at least as easily as from "gırev"', () => {
    expect(score('grev', 'Görev bağla butonu')).toBeGreaterThanOrEqual(MATCH)
    expect(score('gırev', 'Görev bağla butonu')).toBeGreaterThanOrEqual(MATCH)
    expect(score('grev', 'Görev bağla butonu')).toBeGreaterThanOrEqual(score('gırev', 'Görev bağla butonu'))
  })
  it('counts a left-out ç ğ ı ö ş ü as half an edit, also in longer and half-typed words', () => {
    expect(score('grevleri', 'Görevleri sırala')).toBeGreaterThanOrEqual(MATCH)
    expect(score('gncelleme', 'Sürüm güncellemesi')).toBeGreaterThanOrEqual(MATCH)
    expect(score('grevl', 'Görevleri sırala')).toBeGreaterThanOrEqual(MATCH)
    expect(score('blm', 'Yeni bölüm')).toBeGreaterThanOrEqual(MATCH)
  })
  it('handles mixed typing: some Turkish letters written in ASCII, others left out', () => {
    expect(score('skstrma', 'Görsel sıkıştırma')).toBeGreaterThanOrEqual(MATCH)
    expect(score('gorsel skstrma', 'x')).toBe(0)
    expect(matchScore('gorsel skstrma', 'Görsel sıkıştırma')).toBeGreaterThanOrEqual(MATCH)
    expect(score('srm', 'Yeni sürüm')).toBeGreaterThanOrEqual(MATCH)
    expect(score('ogrnci', 'Öğrenci listesi')).toBeGreaterThanOrEqual(MATCH)
  })
  it('does not turn short terms into general typo matches', () => {
    expect(score('grav', 'Görev bağla')).toBeLessThan(MATCH)
    expect(score('grv', 'Görev bağla')).toBeLessThan(MATCH)
    expect(score('gz', 'Göz')).toBe(0)
    expect(score('ktap', 'Kitap')).toBeLessThan(MATCH)
    expect(score('gorv', 'Görev')).toBeLessThan(MATCH)   // 4 harf: e'nin eksikliği Türkçe harf değil
  })
  // Sunucudaki fira_term_score (099) aynı sayıları veriyor (psql ile ölçüldü, 30 Eyl 2026).
  it('gives the same scores as the database', () => {
    const server: [string, string, number][] = [
      ['grev', 'Görev bağla butonu', 0.9], ['gırev', 'Görev bağla butonu', 0.8], ['grevleri', 'Görevleri sırala', 0.944],
      ['gncelleme', 'Sürüm güncellemesi', 0.95], ['grevl', 'Görevleri sırala', 0.917], ['blm', 'Yeni bölüm', 0.8],
      ['grav', 'Görev bağla', 0], ['grv', 'Görev bağla', 0], ['gz', 'Göz', 0], ['ktap', 'Kitap', 0],
      ['sirala', 'Sıralama', 1], ['tamanlamdi', 'Tamamlandı', 0.8], ['grev', 'Grev hakkı', 1],
      ['cerez', 'ÇEREZ BİLDİRİMİ', 1], ['crez', 'Çerez bildirimi', 0], ['grev', 'GÖREV LİSTESİ', 0.9],
      ['skstrma', 'Görsel sıkıştırma', 0.85], ['srm', 'Yeni sürüm', 0.8], ['ogrnci', 'Öğrenci listesi', 0.857], ['gorv', 'Görev', 0],
    ]
    for (const [q, t, v] of server) expect(score(q, t), `${q} / ${t}`).toBeCloseTo(v, 2)
  })
  it('keeps the earlier rules', () => {
    expect(score('sirala', 'Sıralama')).toBe(1)
    expect(score('tamanlamdi', 'Tamamlandı')).toBeGreaterThanOrEqual(MATCH)
    expect(score('grev', 'Grev hakkı')).toBe(1)
    expect(matchScore('grev bagla', 'Görev bağla butonu')).toBeGreaterThanOrEqual(MATCH)
    expect(matchScore('grev kitap', 'Görev bağla butonu')).toBe(0)
  })
})
