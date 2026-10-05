import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { BackupBundle, BundleTicket } from './types'

/** UTF-8 BOM + CRLF so Excel opens Turkish text correctly. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const csv = Papa.unparse(rows, { columns, newline: '\r\n', quotes: true })
  return '﻿' + csv
}

const short = (id: string) => id.slice(0, 6).toUpperCase()
const priorityTr: Record<string, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' }

/** Lookup helpers shared by all exporters. */
export function indexBundle(b: BackupBundle) {
  const profiles = new Map(b.profiles.map((p) => [p.id, p]))
  const statuses = new Map(b.ticket_statuses.map((s) => [s.id, s]))
  const projects = new Map(b.projects.map((p) => [p.id, p]))
  const folders = new Map(b.team_folders.map((f) => [f.id, f]))
  const tags = new Map(b.tags.map((t) => [t.id, t]))
  const tickets = new Map(b.tickets.map((t) => [t.id, t]))
  const assignees = new Map<string, string[]>()
  for (const a of b.ticket_assignees) assignees.set(a.ticket_id, [...(assignees.get(a.ticket_id) ?? []), a.user_id])
  const ticketTags = new Map<string, string[]>()
  for (const a of b.ticket_tag_assignments) ticketTags.set(a.ticket_id, [...(ticketTags.get(a.ticket_id) ?? []), a.tag_id])
  const comments = new Map<string, BackupBundle['ticket_comments']>()
  for (const c of b.ticket_comments) comments.set(c.ticket_id, [...(comments.get(c.ticket_id) ?? []), c])
  const attachments = new Map<string, BackupBundle['ticket_attachments']>()
  for (const a of b.ticket_attachments) attachments.set(a.ticket_id, [...(attachments.get(a.ticket_id) ?? []), a])
  const deadlines = new Map<string, BackupBundle['ticket_deadlines']>()
  for (const d of b.ticket_deadlines) deadlines.set(d.ticket_id, [...(deadlines.get(d.ticket_id) ?? []), d])
  const children = new Map<string, BundleTicket[]>()
  for (const t of b.tickets) if (t.parent_id) children.set(t.parent_id, [...(children.get(t.parent_id) ?? []), t])
  const email = (id: string | null | undefined) => (id && profiles.get(id)?.email) || ''
  const name = (id: string | null | undefined) => { const p = id ? profiles.get(id) : null; return p ? (p.full_name || p.email) : '' }
  return { profiles, statuses, projects, folders, tags, tickets, assignees, ticketTags, comments, attachments, deadlines, children, email, name }
}

/** Tool-agnostic flat tables: tickets.csv, comments.csv, attachments.csv (subtasks are tickets with Üst görev ID). */
export function csvPackage(b: BackupBundle): { name: string; content: string }[] {
  const ix = indexBundle(b)
  const ticketRows = b.tickets.map((t) => {
    const st = t.status_id ? ix.statuses.get(t.status_id) : null
    const pr = t.project_id ? ix.projects.get(t.project_id) : null
    return {
      'ID': t.id, 'Kısa ID': short(t.id), 'Üst görev ID': t.parent_id ?? '', 'Üst görev': t.parent_id ? ix.tickets.get(t.parent_id)?.title ?? '' : '',
      'Liste': pr?.name ?? '', 'Klasör': pr?.folder_id ? ix.folders.get(pr.folder_id)?.name ?? '' : '',
      'Başlık': t.title, 'Açıklama (Markdown)': t.description ?? '',
      'Durum': st?.name ?? t.status, 'Durum kategorisi': st?.category ?? '', 'Öncelik': t.priority ? priorityTr[t.priority] ?? t.priority : '',
      'Atananlar': (ix.assignees.get(t.id) ?? []).map(ix.email).filter(Boolean).join('; '),
      'Etiketler': (ix.ticketTags.get(t.id) ?? []).map((id) => ix.tags.get(id)?.name ?? '').filter(Boolean).join('; '),
      'Bitiş': t.due_date ?? '', 'Ekstra son tarihler': (ix.deadlines.get(t.id) ?? []).map((d) => d.date + (d.description ? ` (${d.description})` : '')).join('; '),
      'Oluşturan': ix.email(t.created_by), 'Oluşturma': t.created_at, 'Güncelleme': t.updated_at, 'Arşiv': t.archived_at ?? '',
      'Alt görev sayısı': (ix.children.get(t.id) ?? []).length, 'Yorum sayısı': (ix.comments.get(t.id) ?? []).length,
      'Ek dosyalar': (ix.attachments.get(t.id) ?? []).map((a) => a.file_name).join('; '),
    }
  })
  const commentRows = b.ticket_comments.map((c) => ({ 'Yorum ID': c.id, 'Görev ID': c.ticket_id, 'Görev': ix.tickets.get(c.ticket_id)?.title ?? '', 'Yazar': ix.email(c.author_id), 'Tarih': c.created_at, 'İçerik': c.content }))
  const attRows = b.ticket_attachments.map((a) => ({ 'Ek ID': a.id, 'Görev ID': a.ticket_id, 'Görev': ix.tickets.get(a.ticket_id)?.title ?? '', 'Dosya': a.file_name, 'URL': a.file_url, 'Yükleyen': ix.email(a.uploaded_by), 'Tarih': a.created_at }))
  const statusRows = b.ticket_statuses.map((s) => ({ 'Liste': ix.projects.get(s.project_id)?.name ?? '', 'Durum': s.name, 'Kategori': s.category, 'İptal': s.is_cancelled ? 'evet' : '', 'Renk': s.color, 'Sıra': s.order_index }))
  return [
    { name: 'tickets.csv', content: toCsv(ticketRows) },
    { name: 'comments.csv', content: toCsv(commentRows) },
    { name: 'attachments.csv', content: toCsv(attRows) },
    { name: 'statuses.csv', content: toCsv(statusRows) },
  ]
}

/** One .xlsx with the same sheets (MS Planner / Excel users). */
export function xlsxPackage(b: BackupBundle): Blob {
  const wb = XLSX.utils.book_new()
  for (const f of csvPackage(b)) {
    const parsed = Papa.parse<Record<string, string>>(f.content.replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
    const ws = XLSX.utils.json_to_sheet(parsed.data)
    XLSX.utils.book_append_sheet(wb, ws, f.name.replace('.csv', '').slice(0, 31))
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
