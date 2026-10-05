import { describe, expect, it } from 'vitest'
import { categoryRank, insertionIndex, isCategorySorted, sortByCategory } from './statusOrder'
import type { StatusCategory } from '../types'

const s = (name: string, category: StatusCategory, is_cancelled = false) => ({ name, category, is_cancelled })
const names = (list: { name: string }[]) => list.map((x) => x.name)

const defaults = [s('Yapılacak', 'backlog'), s('Devam Ediyor', 'active'), s('İncelemede', 'active'), s('Tamamlandı', 'closed')]

describe('statusOrder', () => {
  it('ranks categories in board order, cancelled after closed', () => {
    const order = ['backlog', 'active', 'blocked', 'done', 'closed'] as StatusCategory[]
    const ranks = order.map((c) => categoryRank(s('x', c)))
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(categoryRank(s('İptal', 'closed', true))).toBeGreaterThan(categoryRank(s('Kapandı', 'closed')))
  })

  it('puts a new backlog status after the last backlog one, not at the end', () => {
    // The demo list case: "Planlanıyor" used to land to the right of "Tamamlandı".
    expect(insertionIndex(defaults, s('Planlanıyor', 'backlog'))).toBe(1)
  })

  it('puts a new status at the end of its own category', () => {
    expect(insertionIndex(defaults, s('Test', 'active'))).toBe(3)
    expect(insertionIndex(defaults, s('Bloke', 'blocked'))).toBe(3)
    expect(insertionIndex(defaults, s('Arşiv', 'closed'))).toBe(4)
    expect(insertionIndex(defaults, s('İptal', 'closed', true))).toBe(4)
  })

  it('goes first when every status ranks after it, and first in an empty list', () => {
    expect(insertionIndex([s('Bitti', 'done'), s('Kapandı', 'closed')], s('Fikir', 'backlog'))).toBe(0)
    expect(insertionIndex([], s('Fikir', 'backlog'))).toBe(0)
  })

  it('keeps a custom order and only picks the slot after the last lower-or-equal status', () => {
    const custom = [s('Devam', 'active'), s('Yapılacak', 'backlog'), s('Bitti', 'closed')]
    expect(insertionIndex(custom, s('Fikir', 'backlog'))).toBe(2)
  })

  it('tells whether a list follows the categories', () => {
    expect(isCategorySorted(defaults)).toBe(true)
    expect(isCategorySorted([...defaults, s('Planlanıyor', 'backlog')])).toBe(false)
    expect(isCategorySorted([])).toBe(true)
  })

  it('sorts by category and keeps the order inside a category', () => {
    const mixed = [s('Yapılacak', 'backlog'), s('Devam', 'active'), s('Tamamlandı', 'closed'), s('Planlanıyor', 'backlog'), s('İncelemede', 'active'), s('İptal', 'closed', true)]
    expect(names(sortByCategory(mixed))).toEqual(['Yapılacak', 'Planlanıyor', 'Devam', 'İncelemede', 'Tamamlandı', 'İptal'])
  })
})
