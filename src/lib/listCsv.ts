import type { Ticket } from '../types'
import { type ColumnKey, childProgress, commentCount, attachmentCount, nextDeadline } from './listView'
import { checklistProgress } from './checklist'

/**
 * CSV export of the list as drawn (#883CF8 / TL-09): the visible rows, the
 * visible columns, one line per row. Pure: the caller resolves names it holds
 * (project names, priority labels) through `ctx`.
 */
export interface CsvContext {
  label: (key: ColumnKey) => string
  priority: (p: Ticket['priority']) => string
  project: (id: string | null) => string
  now?: Date
}

export function csvCell(t: Ticket, key: ColumnKey, ctx: CsvContext): string {
  switch (key) {
    case 'name': return t.title
    case 'status': return t.status_info?.name ?? t.status ?? ''
    case 'priority': return ctx.priority(t.priority)
    case 'assignees': return (t.assignees ?? []).map((a) => a.user?.full_name || a.user?.email || '').filter(Boolean).join('; ')
    case 'due': return t.due_date ?? ''
    case 'deadlines': return (t.deadlines ?? []).map((d) => d.date).sort().join('; ') || (nextDeadline(t, ctx.now)?.date ?? '')
    case 'tags': return (t.tags ?? []).map((x) => x.tag.name).join('; ')
    case 'project': return ctx.project(t.project_id)
    case 'created': return t.created_at
    case 'updated': return t.updated_at
    case 'creator': return t.creator?.full_name || t.creator?.email || ''
    case 'children': { const p = childProgress(t); return p.total ? `${p.done}/${p.total}` : '' }
    case 'checklist': { const p = checklistProgress(t.checklist); return p.total ? `${p.done}/${p.total}` : '' }
    case 'activity': return `${commentCount(t)}/${attachmentCount(t)}`
    case 'id': return t.id
  }
}

/** RFC 4180-ish quoting: wrap when the value holds a comma, quote or newline; double the quotes. */
export const csvQuote = (v: string) => (/[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function csvOf(rows: Ticket[], columns: ColumnKey[], ctx: CsvContext): string {
  const head = columns.map((k) => csvQuote(ctx.label(k))).join(',')
  const body = rows.map((t) => columns.map((k) => csvQuote(csvCell(t, k, ctx))).join(','))
  // BOM so Excel opens UTF-8 (Turkish letters) without asking.
  return '﻿' + [head, ...body].join('\r\n')
}

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
