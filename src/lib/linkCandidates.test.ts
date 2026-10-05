import { describe, expect, it } from 'vitest'
import { matchesWords, sortLikeBoard } from './linkCandidates'

const row = (id: string, project: string, status: number | null, order: number | null, title = id) =>
  ({ id, project_id: project, order_index: order, title, status_info: status === null ? null : { order_index: status } })

describe('sortLikeBoard', () => {
  it('orders by status column, then card order, like the board', () => {
    const list = [row('c', 'p', 1, 0), row('a', 'p', 0, 2), row('b', 'p', 0, 1), row('d', 'p', 2, 0)]
    expect(sortLikeBoard(list, 'p').map((r) => r.id)).toEqual(['b', 'a', 'c', 'd'])
  })
  it('puts the current list first and other lists after it, each in board order', () => {
    const list = [row('x2', 'q', 0, 1), row('p1', 'p', 1, 0), row('x1', 'q', 0, 0), row('p0', 'p', 0, 5)]
    expect(sortLikeBoard(list, 'p').map((r) => r.id)).toEqual(['p0', 'p1', 'x1', 'x2'])
  })
  it('sends rows without a status or order to the end of their group', () => {
    const list = [row('none', 'p', null, 0), row('late', 'p', 0, null), row('first', 'p', 0, 3)]
    expect(sortLikeBoard(list, 'p').map((r) => r.id)).toEqual(['first', 'late', 'none'])
  })
})

describe('matchesWords', () => {
  it('ignores case and Turkish letters', () => {
    expect(matchesWords('İletişim formu', ['ILETISIM'])).toBe(true)
    expect(matchesWords('Çerez bildirimi', ['c'])).toBe(true)
    expect(matchesWords('Blog altyapısı', ['form'])).toBe(false)
    expect(matchesWords('Blog', [])).toBe(true)
  })
})
