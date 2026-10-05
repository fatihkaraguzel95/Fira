import { describe, expect, it } from 'vitest'
import { checklistProgress, nextChecklistOrder, parseChecklistPaste, sortChecklist } from './checklist'

describe('yapılacaklar listesi', () => {
  it('ilerleme: tamamlanan / toplam ve yüzde', () => {
    expect(checklistProgress([{ done: true }, { done: false }, { done: true }])).toEqual({ done: 2, total: 3, pct: 67 })
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, pct: 0 })
    expect(checklistProgress(undefined)).toEqual({ done: 0, total: 0, pct: 0 })
  })

  it('sıra: order_index, eşitse eklenme zamanı', () => {
    const items = [
      { id: 'c', order_index: 1, created_at: '2026-09-30T10:00:00Z' },
      { id: 'a', order_index: 0 },
      { id: 'b', order_index: 1, created_at: '2026-09-30T09:00:00Z' },
    ]
    expect(sortChecklist(items).map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(nextChecklistOrder(items)).toBe(2)
    expect(nextChecklistOrder([])).toBe(0)
  })

  it('yapıştırılan liste maddelere bölünür, işaretler atılır', () => {
    expect(parseChecklistPaste('- Taslak\n* İnceleme\n\n1. Yayın\n2) Duyuru\n• Arşiv')).toEqual([
      { title: 'Taslak', done: false }, { title: 'İnceleme', done: false }, { title: 'Yayın', done: false },
      { title: 'Duyuru', done: false }, { title: 'Arşiv', done: false },
    ])
    expect(parseChecklistPaste('- [x] Bitti\n- [ ] Bekliyor\r\n[X] Bu da')).toEqual([
      { title: 'Bitti', done: true }, { title: 'Bekliyor', done: false }, { title: 'Bu da', done: true },
    ])
  })

  it('tek satır normal yapıştırmadır; boş madde çıkmaz', () => {
    expect(parseChecklistPaste('tek satır')).toBeNull()
    expect(parseChecklistPaste('- \n- [ ] \nGerçek madde\nİkinci')).toEqual([{ title: 'Gerçek madde', done: false }, { title: 'İkinci', done: false }])
  })
})
