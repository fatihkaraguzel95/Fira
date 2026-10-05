import { describe, it, expect } from 'vitest'
import { csvQuote, csvOf } from './listCsv'
import type { Ticket } from '../types'

const t = (over: Partial<Ticket>): Ticket => ({
  id: 'id1', title: 'Başlık, virgüllü', status: 'x', status_id: null, priority: 'high', assignee_id: null, project_id: 'p', due_date: '2026-09-20',
  archived_at: null, parent_id: null, created_by: 'u', updated_by: null, created_at: 'c', updated_at: 'u', order_index: 0, assignee: null, creator: null, updater: null,
  status_info: null,
  assignees: [{ user_id: 'u1', user: { id: 'u1', full_name: 'Ali "A"', email: 'a@x', avatar_url: null } as never }],
  tags: [{ tag: { id: 't', name: 'ui', color: '#000', project_id: 'p' } as never }],
  ...over,
} as Ticket)

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvQuote('plain')).toBe('plain')
    expect(csvQuote('a,b')).toBe('"a,b"')
    expect(csvQuote('say "hi"')).toBe('"say ""hi"""')
    expect(csvQuote('x\ny')).toBe('"x\ny"')
  })
  it('writes a header and one line per row with a BOM', () => {
    const csv = csvOf([t({})], ['name', 'priority', 'assignees', 'due', 'tags'], { label: (k) => k.toUpperCase(), priority: (p) => p ?? '', project: () => '' })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual(['NAME,PRIORITY,ASSIGNEES,DUE,TAGS', '"Başlık, virgüllü",high,"Ali ""A""",2026-09-20,ui'])
  })
})
