import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LIST_VIEW, sanitizeListView, listViewFromParams, listViewToParams,
  sortTickets, groupTickets, buildRows, rootTickets, childProgress, sortValue, groupPreset, moveColumn, nextDeadline, dueQuickDates, presetFromFilters, mergePresets, rangeBetween, rowDropMode, descendantIds, placeInOrder,
} from './listView'
import type { Ticket, TicketStatus, Profile } from '../types'

const status = (id: string, order_index: number, category: TicketStatus['category'] = 'active'): TicketStatus =>
  ({ id, project_id: 'p', name: id, color: '#000', order_index, category, is_cancelled: false } as TicketStatus)
const user = (id: string, full_name: string): Profile => ({ id, full_name, email: `${id}@x`, avatar_url: null } as Profile)

let n = 0
const ticket = (over: Partial<Ticket>): Ticket => ({
  id: over.id ?? `t${++n}`, title: over.title ?? `T${n}`, status: 'x', status_id: over.status_info?.id ?? null, priority: null,
  assignee_id: null, project_id: 'p', due_date: null, archived_at: null, parent_id: null, created_by: 'u', updated_by: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', order_index: n, assignee: null, creator: null, updater: null,
  status_info: null, assignees: [], tags: [], ...over,
} as Ticket)

describe('sanitizeListView', () => {
  it('falls back per field and keeps the name column first', () => {
    const c = sanitizeListView({ groupBy: 'bogus', sort: { key: 'due', dir: 'weird' }, columns: ['status', { key: 'due', width: 90 }, 'nope'], density: 'compact' })
    expect(c.groupBy).toBe('none')
    expect(c.sort).toEqual({ key: 'due', dir: 'asc' })
    expect(c.columns).toEqual([{ key: 'name' }, { key: 'status' }, { key: 'due', width: 90 }])
    expect(c.density).toBe('compact')
    expect(c.meMode).toBe(false); expect(c.showMeta).toBe(true); expect(c.showParentName).toBe(true)
    expect(sanitizeListView({ meMode: true, showTagsInline: true, showClosedSubtasks: true }).meMode).toBe(true)
  })
  it('round-trips group and sort through the URL', () => {
    const cfg = { ...DEFAULT_LIST_VIEW, groupBy: 'assignee' as const, sort: { key: 'due' as const, dir: 'desc' as const } }
    const p = listViewToParams(cfg, new URLSearchParams('view=all'))
    expect(p.get('view')).toBe('all')
    expect(listViewFromParams(p, DEFAULT_LIST_VIEW)).toEqual(cfg)
    expect(listViewToParams(DEFAULT_LIST_VIEW, p).toString()).toBe('view=all')
    expect(listViewFromParams(new URLSearchParams('sort=none'), cfg).sort).toBeNull()
  })
})

describe('sortTickets', () => {
  const s1 = status('todo', 0), s2 = status('doing', 1)
  const a = ticket({ id: 'a', title: 'b', due_date: '2026-09-20', status_info: s2, priority: 'low', order_index: 2 })
  const b = ticket({ id: 'b', title: 'a', due_date: null, status_info: s1, priority: 'critical', order_index: 1 })
  const c = ticket({ id: 'c', title: 'c', due_date: '2026-09-10', status_info: null, priority: null, order_index: 3 })
  it('uses manual order when there is no sort', () => {
    expect(sortTickets([a, b, c], null).map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })
  it('sorts by a column with nulls last in both directions', () => {
    expect(sortTickets([a, b, c], { key: 'due', dir: 'asc' }).map((t) => t.id)).toEqual(['c', 'a', 'b'])
    expect(sortTickets([a, b, c], { key: 'due', dir: 'desc' }).map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(sortTickets([a, b, c], { key: 'priority', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'a', 'c'])
    expect(sortTickets([a, b, c], { key: 'status', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'a', 'c'])
    expect(sortTickets([a, b, c], { key: 'name', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })
  it('does not mutate the input', () => {
    const arr = [a, b, c]; sortTickets(arr, { key: 'due', dir: 'asc' }); expect(arr.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
  it('sortValue covers every column', () => {
    for (const k of DEFAULT_LIST_VIEW.columns.map((c) => c.key)) expect(sortValue(a, k)).not.toBeUndefined()
  })
})

describe('groupTickets', () => {
  const todo = status('todo', 0), done = status('done', 1, 'done')
  const u1 = user('u1', 'Zeynep'), u2 = user('u2', 'Ali')
  const t1 = ticket({ id: '1', status_info: todo, assignees: [{ user_id: 'u1', user: u1 }, { user_id: 'u2', user: u2 }], priority: 'high' })
  const t2 = ticket({ id: '2', status_info: done, assignees: [], priority: null })
  const t3 = ticket({ id: '3', status_info: todo, assignees: [{ user_id: 'u2', user: u2 }], priority: 'low' })
  it('none = one group with everything', () => {
    const g = groupTickets([t1, t2, t3], 'none')
    expect(g).toHaveLength(1); expect(g[0].tickets).toHaveLength(3)
  })
  it('groups by status in board order, empty statuses only on request', () => {
    const statuses = [done, todo]   // deliberately reversed: ctx order wins over order_index
    expect(groupTickets([t1, t2, t3], 'status', { statuses }).map((g) => g.key)).toEqual(['status:done', 'status:todo'])
    const extra = status('review', 2)
    expect(groupTickets([t1, t2], 'status', { statuses: [todo, extra, done] }, true).map((g) => [g.key, g.tickets.length])).toEqual([['status:todo', 1], ['status:review', 0], ['status:done', 1]])
  })
  it('puts a multi-assignee ticket in every matching group and the unassigned last', () => {
    const g = groupTickets([t1, t2, t3], 'assignee')
    expect(g.map((x) => x.key)).toEqual(['assignee:u2', 'assignee:u1', 'assignee:'])
    expect(g[0].tickets.map((t) => t.id)).toEqual(['1', '3'])
    expect(g[1].tickets[0]).toBe(t1)   // same object, not a copy
  })
  it('combined mode makes one group per distinct set of assignees', () => {
    const g = groupTickets([t1, t2, t3], 'assignee', { multi: 'combined' })
    expect(g.map((x) => x.key)).toEqual(['assignee:u2', 'assignee:u1+u2', 'assignee:'])
    expect(g[1].value.kind === 'assignee' && g[1].value.users.map((u) => u.id)).toEqual(['u1', 'u2'])
    expect(g[1].tickets).toEqual([t1])
  })
  it('orders priorities critical → low, none last', () => {
    expect(groupTickets([t1, t2, t3], 'priority').map((x) => x.key)).toEqual(['priority:high', 'priority:low', 'priority:'])
  })
  it('groups by due bucket in time order', () => {
    const now = new Date(2026, 8, 17)
    const a = ticket({ id: 'a', due_date: '2026-09-10' }), b = ticket({ id: 'b', due_date: '2026-09-17' }), c = ticket({ id: 'c', due_date: null })
    expect(groupTickets([c, b, a], 'due', { now }).map((x) => x.key)).toEqual(['due:overdue', 'due:today', 'due:none'])
  })
})

describe('buildRows', () => {
  const p = ticket({ id: 'p' }), c1 = ticket({ id: 'c1', parent_id: 'p' }), c2 = ticket({ id: 'c2', parent_id: 'p' }), gc = ticket({ id: 'gc', parent_id: 'c1' }), orphan = ticket({ id: 'o', parent_id: 'elsewhere' })
  const all = [c2, p, gc, c1, orphan]
  it('separate = flat rows', () => {
    expect(buildRows(all, 'separate').map((r) => [r.ticket.id, r.depth])).toEqual([['c2', 0], ['p', 0], ['gc', 0], ['c1', 0], ['o', 0]])
    expect(buildRows(all, 'separate').map((r) => r.orphan)).toEqual([true, false, true, true, true])
  })
  it('expand nests children under their parent, orphans stay at the root', () => {
    const rows = buildRows(all, 'expand')
    expect(rows.map((r) => `${r.ticket.id}@${r.depth}`)).toEqual(['p@0', 'c2@1', 'c1@1', 'gc@2', 'o@0'])
    expect(rows.find((r) => r.ticket.id === 'o')?.orphan).toBe(true)
    expect(rows.find((r) => r.ticket.id === 'p')?.hasChildren).toBe(true)
  })
  it('a hidden parent keeps its subtree folded; collapse mode is expand with every parent hidden', () => {
    expect(buildRows(all, 'collapse', new Set(['p', 'c1'])).map((r) => r.ticket.id)).toEqual(['p', 'o'])
    expect(buildRows(all, 'expand', new Set(['c1'])).map((r) => r.ticket.id)).toEqual(['p', 'c2', 'c1', 'o'])
  })
  it('walks the given roots but finds children in the pool (a group holds parents, subtasks follow)', () => {
    expect(rootTickets(all).map((r) => r.id)).toEqual(['p', 'o'])
    const rows = buildRows([p], 'expand', new Set(), all)
    expect(rows.map((r) => `${r.ticket.id}@${r.depth}`)).toEqual(['p@0', 'c2@1', 'c1@1', 'gc@2'])
    // a root that is a child of another pool member is skipped (it will be drawn under its parent)
    expect(buildRows([c1], 'expand', new Set(), all)).toEqual([])
  })
})

describe('childProgress', () => {
  it('counts done and blocked', () => {
    const t = ticket({ children: [{ id: 'a', status_info: { category: 'done', color: '', is_cancelled: false } }, { id: 'b', status_info: { category: 'blocked', color: '', is_cancelled: false } }, { id: 'c', status_info: null }] })
    expect(childProgress(t)).toEqual({ total: 3, done: 1, blocked: 1 })
  })
})

describe('groupPreset', () => {
  const now = new Date(2026, 8, 17)   // Thursday
  it('hands a new task the group value', () => {
    const u = user('u1', 'Zeynep')
    expect(groupPreset({ kind: 'status', status: status('s', 0) })).toEqual({ status_id: 's' })
    expect(groupPreset({ kind: 'priority', priority: null })).toEqual({ priority: null })
    expect(groupPreset({ kind: 'assignee', user: u, users: [u] })).toEqual({ assignee_ids: ['u1'] })
    expect(groupPreset({ kind: 'assignee', user: null, users: [] })).toEqual({ assignee_ids: [] })
    expect(groupPreset({ kind: 'due', bucket: 'today' }, now)).toEqual({ due_date: '2026-09-17' })
    expect(groupPreset({ kind: 'due', bucket: 'tomorrow' }, now)).toEqual({ due_date: '2026-09-18' })
    expect(groupPreset({ kind: 'due', bucket: 'next_week' }, now)).toEqual({ due_date: '2026-09-21' })
    expect(groupPreset({ kind: 'due', bucket: 'overdue' }, now)).toEqual({ due_date: null })
    expect(groupPreset({ kind: 'none' })).toEqual({})
  })
})

describe('columns', () => {
  const cols = [{ key: 'name' as const }, { key: 'status' as const }, { key: 'due' as const, width: 90 }, { key: 'tags' as const }]
  it('moveColumn keeps the name column first', () => {
    expect(moveColumn(cols, 'tags', 'start').map((c) => c.key)).toEqual(['name', 'tags', 'status', 'due'])
    expect(moveColumn(cols, 'status', 'end').map((c) => c.key)).toEqual(['name', 'due', 'tags', 'status'])
    expect(moveColumn(cols, 'due', 0).map((c) => c.key)).toEqual(['name', 'due', 'status', 'tags'])
    expect(moveColumn(cols, 'due', 0)[1]).toEqual({ key: 'due', width: 90 })
    expect(moveColumn(cols, 'name', 'end').map((c) => c.key)).toEqual(['name', 'status', 'due', 'tags'])
  })
  it('nextDeadline prefers the next upcoming date, else the last past one', () => {
    const now = new Date(2026, 8, 17)
    expect(nextDeadline({ deadlines: [] })).toBeNull()
    expect(nextDeadline({ deadlines: [{ date: '2026-09-30' }, { date: '2026-09-10' }, { date: '2026-09-20' }] }, now)).toEqual({ date: '2026-09-20', past: false, total: 3 })
    expect(nextDeadline({ deadlines: [{ date: '2026-09-01' }, { date: '2026-09-10' }] }, now)).toEqual({ date: '2026-09-10', past: true, total: 2 })
  })
})

describe('dueQuickDates', () => {
  it('today, tomorrow, this Saturday, next Monday, +14 days', () => {
    const thu = new Date(2026, 8, 17)   // Thursday
    expect(dueQuickDates(thu).map((q) => [q.key, q.date])).toEqual([['today', '2026-09-17'], ['tomorrow', '2026-09-18'], ['weekend', '2026-09-19'], ['nextWeek', '2026-09-21'], ['twoWeeks', '2026-10-01']])
    const sat = new Date(2026, 8, 19)
    expect(dueQuickDates(sat).find((q) => q.key === 'weekend')?.date).toBe('2026-09-26')
    const mon = new Date(2026, 8, 21)
    expect(dueQuickDates(mon).find((q) => q.key === 'nextWeek')?.date).toBe('2026-09-28')
  })
})

describe('presetFromFilters', () => {
  const now = new Date(2026, 8, 17)
  it('takes only single-valued filters, never the unassigned marker', () => {
    expect(presetFromFilters(undefined)).toEqual({})
    expect(presetFromFilters({ status_id: ['s1'], priority: ['high', 'low'], assignee_ids: ['__unassigned__'], tag_ids: ['t1'], due: ['tomorrow'] }, now))
      .toEqual({ status_id: 's1', tag_ids: ['t1'], due_date: '2026-09-18' })
    expect(presetFromFilters({ assignee_ids: ['u1'], priority: ['low'] })).toEqual({ assignee_ids: ['u1'], priority: 'low' })
  })
  it('mergePresets lets the group win over the filters', () => {
    expect(mergePresets({ status_id: 'g' }, { status_id: 'f', priority: 'low' })).toEqual({ status_id: 'g', priority: 'low' })
    expect(mergePresets({ priority: null }, { priority: 'high' })).toEqual({ priority: null })
  })
})

describe('rangeBetween', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  it('selects the inclusive span in either direction', () => {
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(order, null, 'c')).toEqual(['c'])
    expect(rangeBetween(order, 'zz', 'c')).toEqual(['c'])
  })
})

describe('row drag-and-drop', () => {
  const rect = { top: 100, height: 30, left: 0 }
  it('rowDropMode: thirds, and nest only when pulled right', () => {
    expect(rowDropMode(rect, 10, 105)).toBe('before')
    expect(rowDropMode(rect, 10, 125)).toBe('after')
    expect(rowDropMode(rect, 10, 114)).toBe('before')
    expect(rowDropMode(rect, 10, 116)).toBe('after')
    expect(rowDropMode(rect, 100, 115)).toBe('nest')
  })
  it('descendantIds walks the tree; placeInOrder moves within the list', () => {
    const p = ticket({ id: 'p' }), c = ticket({ id: 'c', parent_id: 'p' }), gc = ticket({ id: 'gc', parent_id: 'c' }), o = ticket({ id: 'o' })
    expect(Array.from(descendantIds([p, c, gc, o], 'p')).sort()).toEqual(['c', 'gc'])
    expect(placeInOrder(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
    expect(placeInOrder(['a', 'b', 'c'], 'a', 'b', 'after')).toEqual(['b', 'a', 'c'])
    expect(placeInOrder(['a', 'b'], 'z', 'q', 'after')).toEqual(['a', 'b', 'z'])
  })
})
