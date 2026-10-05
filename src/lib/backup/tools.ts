import type { BackupBundle, BundleTicket } from './types'
import { indexBundle, toCsv } from './csv'
import * as XLSX from 'xlsx'
// `t` is the loop variable for tickets throughout this file, hence the alias.
import { t as tr, type TranslationKey } from '../../i18n'

export type ToolProfile = 'jira' | 'clickup' | 'planner' | 'notion'

export const TOOL_LABELS: Record<ToolProfile, string> = {
  jira: 'Jira (CSV importer)',
  clickup: 'ClickUp (CSV import)',
  planner: 'MS Planner (Excel)',
  notion: 'Notion (CSV)',
}

/**
 * What each target cannot represent — appended to the task notes and listed in
 * the report. Keys rather than words: the table is built at import time, so the
 * text is looked up when it is shown, not when the module loads.
 */
const TOOL_LOSS_KEYS: Record<ToolProfile, TranslationKey[]> = {
  jira: ['team.tools.jira.deadlines', 'team.tools.jira.links', 'team.tools.jira.colors', 'team.tools.jira.attachments'],
  clickup: ['team.tools.clickup.deadlines', 'team.tools.clickup.links', 'team.tools.clickup.priority', 'team.tools.clickup.attachments'],
  planner: ['team.tools.planner.subtasks', 'team.tools.planner.description', 'team.tools.planner.labels', 'team.tools.planner.comments'],
  notion: ['team.tools.notion.deadlines', 'team.tools.notion.attachments', 'team.tools.notion.statuses'],
}

export const toolLosses = (tool: ToolProfile): string[] => TOOL_LOSS_KEYS[tool].map((k) => tr(k))

const priorityJira: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Highest' }
const priorityClickUp: Record<string, string> = { critical: '1', high: '2', medium: '3', low: '4' }
const priorityPlanner: Record<string, string> = { critical: 'Acil', high: 'Önemli', medium: 'Orta', low: 'Düşük' }

/** Markdown → Jira wiki markup (headings, bold/italic, lists, code, links, images). Good enough for text; tables become plain rows. */
export function markdownToJira(md: string): string {
  return md
    .replace(/^######\s+(.*)$/gm, 'h6. $1').replace(/^#####\s+(.*)$/gm, 'h5. $1').replace(/^####\s+(.*)$/gm, 'h4. $1')
    .replace(/^###\s+(.*)$/gm, 'h3. $1').replace(/^##\s+(.*)$/gm, 'h2. $1').replace(/^#\s+(.*)$/gm, 'h1. $1')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => `{code${lang ? ':' + lang : ''}}\n${code}{code}`)
    .replace(/`([^`]+)`/g, '{{$1}}')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1_$2_')
    .replace(/~~([^~]+)~~/g, '-$1-')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '!$1!')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]')
    .replace(/^\s*[-*]\s+\[( |x)\]\s+/gm, (_m, x) => (x === 'x' ? '* (/) ' : '* (x) '))
    .replace(/^\s*[-*]\s+/gm, '* ').replace(/^\s*\d+\.\s+/gm, '# ')
    .replace(/^>\s?(.*)$/gm, 'bq. $1')
    .replace(/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/gm, '')
    .replace(/^---+$/gm, '----')
}

const stripMd = (md: string) => md
  .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  .replace(/[`*_>#]+/g, '').replace(/^\s*[-*]\s+\[( |x)\]\s+/gm, (_m, x) => (x === 'x' ? '☑ ' : '☐ ')).replace(/^\s*[-*]\s+/gm, '• ')

function extras(b: BackupBundle, t: BundleTicket, ix: ReturnType<typeof indexBundle>): string[] {
  const lines: string[] = []
  const dl = ix.deadlines.get(t.id) ?? []
  if (dl.length) lines.push('Ekstra son tarihler: ' + dl.map((d) => d.date + (d.description ? ` (${d.description})` : '')).join(', '))
  const links = b.ticket_links.filter((l) => l.ticket_id === t.id)
  if (links.length) lines.push('İlişkili görevler: ' + links.map((l) => ix.tickets.get(l.linked_ticket_id)?.title ?? l.linked_ticket_id).join(', '))
  const att = ix.attachments.get(t.id) ?? []
  if (att.length) lines.push('Ekler: ' + att.map((a) => `${a.file_name} <${a.file_url}>`).join(', '))
  return lines
}

export function toolExport(b: BackupBundle, tool: ToolProfile): { name: string; blob: Blob } {
  const ix = indexBundle(b)
  const stamp = b.exported_at.slice(0, 10)
  const statusName = (t: BundleTicket) => (t.status_id ? ix.statuses.get(t.status_id)?.name : null) ?? t.status
  const listName = (t: BundleTicket) => (t.project_id ? ix.projects.get(t.project_id)?.name : '') ?? ''
  const tagNames = (t: BundleTicket) => (ix.ticketTags.get(t.id) ?? []).map((id) => ix.tags.get(id)?.name ?? '').filter(Boolean)
  const assigneeEmails = (t: BundleTicket) => (ix.assignees.get(t.id) ?? []).map(ix.email).filter(Boolean)
  const comments = (t: BundleTicket) => (ix.comments.get(t.id) ?? [])

  if (tool === 'jira') {
    // One row per ticket; subtasks reference Parent by "Issue ID" (external id). Multiple "Comment" columns per Jira importer convention.
    const maxComments = Math.max(0, ...b.tickets.map((t) => comments(t).length))
    const rows = b.tickets.map((t) => {
      const row: Record<string, unknown> = {
        'Issue ID': t.id, 'Parent ID': t.parent_id ?? '', 'Issue Type': t.parent_id ? 'Sub-task' : 'Task',
        'Summary': t.title, 'Description': markdownToJira([t.description ?? '', ...extras(b, t, ix)].filter(Boolean).join('\n\n')),
        'Status': statusName(t), 'Priority': t.priority ? priorityJira[t.priority] : 'Medium', 'Assignee': assigneeEmails(t)[0] ?? '',
        'Reporter': ix.email(t.created_by), 'Labels': tagNames(t).map((x) => x.replace(/\s+/g, '_')).join(' '),
        'Due Date': t.due_date ? new Date(t.due_date).toLocaleDateString('en-GB') : '', 'Created': t.created_at, 'Project': listName(t),
      }
      comments(t).forEach((c, i) => { row[`Comment${i ? ' ' + (i + 1) : ''}`] = `${c.created_at.replace('T', ' ').slice(0, 16)};${ix.email(c.author_id)};${c.content}` })
      return row
    })
    const columns = ['Issue ID', 'Parent ID', 'Issue Type', 'Summary', 'Description', 'Status', 'Priority', 'Assignee', 'Reporter', 'Labels', 'Due Date', 'Created', 'Project', ...Array.from({ length: maxComments }, (_, i) => `Comment${i ? ' ' + (i + 1) : ''}`)]
    return { name: `fira-jira-${stamp}.csv`, blob: new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }) }
  }

  if (tool === 'clickup') {
    const rows = b.tickets.map((t) => ({
      'Task ID': t.id, 'Task Name': t.title, 'Parent Task ID': t.parent_id ?? '', 'List': listName(t),
      'Description': [t.description ?? '', ...extras(b, t, ix)].filter(Boolean).join('\n\n'),
      'Status': statusName(t), 'Priority': t.priority ? priorityClickUp[t.priority] : '', 'Assignees': assigneeEmails(t).join(','),
      'Tags': tagNames(t).join(','), 'Due Date': t.due_date ?? '', 'Date Created': t.created_at, 'Created By': ix.email(t.created_by),
      'Comments': comments(t).map((c) => `[${c.created_at.slice(0, 16).replace('T', ' ')}] ${ix.name(c.author_id)}: ${c.content}`).join('\n'),
    }))
    return { name: `fira-clickup-${stamp}.csv`, blob: new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }) }
  }

  if (tool === 'notion') {
    const rows = b.tickets.map((t) => ({
      'Name': t.title, 'ID': t.id, 'Parent item': t.parent_id ? ix.tickets.get(t.parent_id)?.title ?? '' : '', 'List': listName(t),
      'Status': statusName(t), 'Priority': t.priority ? priorityPlanner[t.priority] : '', 'Assignee': assigneeEmails(t).join(', '),
      'Tags': tagNames(t).join(', '), 'Due': t.due_date ?? '', 'Created': t.created_at,
      'Description': [t.description ?? '', ...extras(b, t, ix)].filter(Boolean).join('\n\n'),
      'Comments': comments(t).map((c) => `${ix.name(c.author_id)} (${c.created_at.slice(0, 10)}): ${c.content}`).join('\n'),
    }))
    return { name: `fira-notion-${stamp}.csv`, blob: new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }) }
  }

  // MS Planner: one sheet per list (bucket = status), subtasks become checklist items, description/comments → Notes (plain text).
  const wb = XLSX.utils.book_new()
  for (const p of b.projects) {
    const rows = b.tickets.filter((t) => t.project_id === p.id && !t.parent_id).map((t) => {
      const kids = ix.children.get(t.id) ?? []
      const notes = [stripMd(t.description ?? ''), ...extras(b, t, ix), ...comments(t).map((c) => `Yorum · ${ix.name(c.author_id)} (${c.created_at.slice(0, 10)}): ${c.content}`)].filter(Boolean).join('\n\n')
      return {
        'Görev adı': t.title, 'Kova': statusName(t), 'İlerleme': ix.statuses.get(t.status_id ?? '')?.category === 'closed' || ix.statuses.get(t.status_id ?? '')?.category === 'done' ? 'Tamamlandı' : ix.statuses.get(t.status_id ?? '')?.category === 'backlog' ? 'Başlamadı' : 'Devam ediyor',
        'Öncelik': t.priority ? priorityPlanner[t.priority] : 'Orta', 'Atananlar': assigneeEmails(t).join('; '), 'Oluşturan': ix.email(t.created_by),
        'Başlangıç': t.created_at.slice(0, 10), 'Bitiş': t.due_date ?? '', 'Etiketler': tagNames(t).slice(0, 25).join('; '),
        'Kontrol listesi': kids.slice(0, 20).map((k) => `${ix.statuses.get(k.status_id ?? '')?.category === 'closed' ? '☑' : '☐'} ${k.title}`).join('\n'),
        'Notlar': notes, 'Fira ID': t.id,
      }
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), p.name.slice(0, 31) || 'Liste')
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return { name: `fira-planner-${stamp}.xlsx`, blob: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }
}
