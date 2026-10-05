import JSZip from 'jszip'
import { currentUser } from '../session'
import Papa from 'papaparse'
import { supabase, supabaseBulk } from '../supabase'
import type { StatusCategory } from '../../types'
import type { BackupBundle, ImportMode, ImportReport } from './types'
import type { Progress } from './export'
// `t` is the loop variable for tickets throughout this file, hence the alias.
import { t as tr, type TranslationKey } from '../../i18n'

export interface ReadBackup { bundle: BackupBundle; zip: JSZip | null }

/** Accepts the ZIP or a bare backup.json. */
export async function readBackupFile(file: File): Promise<ReadBackup> {
  if (file.name.toLowerCase().endsWith('.json')) {
    const bundle = JSON.parse(await file.text()) as BackupBundle
    validate(bundle)
    return { bundle, zip: null }
  }
  const zip = await JSZip.loadAsync(file)
  const entry = zip.file('backup.json')
  if (!entry) throw new Error(tr('team.import.error.noBackupJson'))
  const bundle = JSON.parse(await entry.async('string')) as BackupBundle
  validate(bundle)
  return { bundle, zip }
}

function validate(b: BackupBundle) {
  if (b.schema_version !== 1) throw new Error(tr('team.import.error.schema', { version: String(b.schema_version) }))
  if (!b.team?.id || !Array.isArray(b.tickets)) throw new Error(tr('team.import.error.corrupt'))
}

export interface Preview {
  teamExists: boolean
  isAdminOfTeam: boolean
  existingTickets: number
  conflicts: number
  unmappedUsers: string[]
  knownUsers: number
}

/** What will happen before running the import. */
export async function previewImport(b: BackupBundle): Promise<Preview> {
  const { data: team } = await supabase.from('teams').select('id').eq('id', b.team.id).maybeSingle()
  const teamExists = !!team
  let isAdminOfTeam = false
  if (teamExists) {
    const { data } = await supabase.rpc('is_team_admin', { t: b.team.id })
    isAdminOfTeam = !!data
  }
  const ids = b.tickets.map((t) => t.id)
  let conflicts = 0
  for (let i = 0; i < ids.length; i += 60) {
    const { count } = await supabase.from('tickets').select('id', { count: 'exact', head: true }).in('id', ids.slice(i, i + 60))
    conflicts += count ?? 0
  }
  const emails = b.profiles.map((p) => p.email).filter(Boolean)
  const knownSet = new Set<string>()
  for (let i = 0; i < emails.length; i += 60) {
    const { data } = await supabase.from('profiles').select('email').in('email', emails.slice(i, i + 60))
    for (const r of data ?? []) knownSet.add(r.email.toLowerCase())
  }
  const unmappedUsers = emails.filter((e) => !knownSet.has(e.toLowerCase()))
  return { teamExists, isAdminOfTeam, existingTickets: conflicts, conflicts, unmappedUsers, knownUsers: knownSet.size }
}

/** Run the server-side import (one transaction). */
export async function runImport(b: BackupBundle, mode: ImportMode, targetTeam: string | null): Promise<ImportReport> {
  const payload = { ...b, files: [] } // files are restored separately
  const { data, error } = await supabaseBulk.rpc('import_bundle', { p_bundle: payload, p_mode: mode, p_target_team: targetTeam })
  if (error) throw new Error(error.message)
  const r = data as { mode: ImportMode; team_id: string; counts: Record<string, number>; unmapped_users: string[]; id_map: Record<string, string> }
  return {
    mode: r.mode, team_id: r.team_id,
    counts: Object.fromEntries(Object.entries(r.counts ?? {}).map(([k, v]) => [k, { inserted: v, updated: 0, skipped: 0 }])),
    unmapped_users: r.unmapped_users ?? [], id_map: r.id_map ?? {}, errors: [],
  }
}

/**
 * Upload files from the ZIP into storage under the (possibly remapped) ticket
 * ids, then point attachment rows and description image URLs at the new URLs.
 */
export async function restoreFiles(read: ReadBackup, report: ImportReport, onProgress: Progress = () => {}): Promise<string[]> {
  const errors: string[] = []
  if (!read.zip || read.bundle.files.length === 0) return errors
  const user = await currentUser()
  if (!user) throw new Error(tr('team.import.error.noSession'))
  const map = (id: string) => report.id_map?.[id] ?? id
  const bucket = supabase.storage.from('ticket-attachments')
  const urlRewrites = new Map<string, string>() // old url (no query) → new public url
  let done = 0
  for (const f of read.bundle.files) {
    onProgress(tr('team.import.progress.file', { i: done + 1, n: read.bundle.files.length }), done / read.bundle.files.length)
    done++
    const entry = read.zip.file(f.path)
    if (!entry) { errors.push(tr('team.import.error.notInZip', { path: f.path })); continue }
    try {
      const blob = await entry.async('blob')
      const name = f.path.split('/').pop() ?? 'dosya'
      let path: string
      if (f.ref.kind === 'attachment') path = `${user.id}/${map(f.ref.ticket_id)}/${Date.now()}-${name.replace(/^[0-9a-f-]{36}-/, '')}`
      else if (f.ref.kind === 'logo') path = `${user.id}/logos/${map(f.ref.project_id)}-${name}`
      else path = `${user.id}/${map(f.ref.ticket_id)}/${Date.now()}-${name}`
      const { error } = await bucket.upload(path, blob, { upsert: true, contentType: blob.type || undefined })
      if (error) throw error
      const newUrl = bucket.getPublicUrl(path).data.publicUrl
      urlRewrites.set(f.url.split('?')[0], newUrl)
      if (f.ref.kind === 'attachment') {
        await supabase.from('ticket_attachments').update({ file_url: newUrl }).eq('id', map(f.ref.id))
      } else if (f.ref.kind === 'logo') {
        await supabase.from('projects').update({ icon_url: newUrl }).eq('id', map(f.ref.project_id))
      }
    } catch (e) {
      errors.push(`${f.path}: ${(e as Error).message}`)
    }
  }
  // Rewrite description image links
  if (urlRewrites.size > 0) {
    for (const t of read.bundle.tickets) {
      if (!t.description) continue
      let next = t.description
      for (const [oldUrl, newUrl] of urlRewrites) next = next.split(oldUrl).join(newUrl)
      if (next !== t.description) await supabase.from('tickets').update({ description: next.replace(/\?t=\d+/g, '') }).eq('id', map(t.id))
    }
  }
  onProgress(tr('team.import.progress.filesDone'), 1)
  return errors
}

// ─── CSV import (from other tools) ───────────────────────────────────────────
export type CsvField = 'title' | 'description' | 'status' | 'priority' | 'assignees' | 'tags' | 'due_date' | 'parent' | 'external_id' | 'comments' | 'created_at' | 'ignore'
/** Labels for the mapping dropdown. Keys, not words — the map is built once at
 *  import, so the text is resolved when a row is rendered. */
export const CSV_FIELD_KEYS: Record<CsvField, TranslationKey> = {
  title: 'team.backup.field.title', description: 'team.backup.field.description', status: 'team.backup.field.status',
  priority: 'team.backup.field.priority', assignees: 'team.backup.field.assignees', tags: 'team.backup.field.tags',
  due_date: 'team.backup.field.dueDate', parent: 'team.backup.field.parent', external_id: 'team.backup.field.externalId',
  comments: 'team.backup.field.comments', created_at: 'team.backup.field.createdAt', ignore: 'team.backup.field.ignore',
}
export const CSV_FIELDS = Object.keys(CSV_FIELD_KEYS) as CsvField[]

// Header names the importer matches on. These are DATA, not UI: they cover the
// column titles other tools write (and the ones Fira's own CSV export writes),
// so they stay exactly as they are in every language.
const GUESS: [RegExp, CsvField][] = [
  [/^(summary|task name|name|görev adı|başlık|title)$/i, 'title'],
  [/^(description|açıklama|notes|notlar)$/i, 'description'],
  [/^(status|durum|kova|bucket)$/i, 'status'],
  [/^(priority|öncelik)$/i, 'priority'],
  [/^(assignee|assignees|atanan|atananlar)$/i, 'assignees'],
  [/^(labels|tags|etiketler)$/i, 'tags'],
  [/^(due date|due|bitiş|son tarih)$/i, 'due_date'],
  [/^(parent|parent id|parent task id|parent item|üst görev|üst görev id)$/i, 'parent'],
  [/^(issue id|task id|id|fira id|dış id)$/i, 'external_id'],
  [/^(comment|comments|yorum|yorumlar)/i, 'comments'],
  [/^(created|date created|oluşturma)$/i, 'created_at'],
]

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
  return { headers: res.meta.fields ?? [], rows: res.data }
}

export function guessMapping(headers: string[]): Record<string, CsvField> {
  const m: Record<string, CsvField> = {}
  const used = new Set<CsvField>()
  for (const h of headers) {
    const hit = GUESS.find(([re, f]) => re.test(h.trim()) && (!used.has(f) || f === 'comments'))
    m[h] = hit ? hit[1] : 'ignore'
    if (hit) used.add(hit[1])
  }
  return m
}

export { PRIORITY_MAP, statusCategoryOf, colorFor } from './fields'
import { PRIORITY_MAP, statusCategoryOf, colorFor } from './fields'

/** A completion the source tool recorded: when, and by whom. */
export interface ImportedCompletion {
  at: string
  /** Key of the person who finished it — see ImportedPerson.key. */
  personKey: string | null
  /** Name as written in the export — kept even when nobody matched. */
  name: string | null
  /** Column the task sat in before it was moved to the finished one. */
  from: string | null
}

/**
 * Someone the source tool knew about. If they have no Fira account, the import
 * creates a placeholder profile (source='import', migration 040) so their work
 * keeps a name and they inherit it when they eventually sign up.
 */
export interface ImportedPerson {
  /** Key used by tickets[].assignees — the e-mail, or `name:<display name>`. */
  key: string
  email: string | null
  name: string | null
  external_id: string | null
}

export interface CsvPlan {
  tickets: { key: string; title: string; description: string | null; status: string; priority: string | null; assignees: string[]; tags: string[]; due_date: string | null; parentKey: string | null; comments: string[]; created_at: string | null; completion?: ImportedCompletion | null; createdByKey?: string | null }[]
  newStatuses: { name: string; category: StatusCategory }[]
  newTags: string[]
  /** People without a Fira account — a placeholder profile is created for each. */
  unknownUsers: string[]
  people?: ImportedPerson[]
}

export function planCsvImport(rows: Record<string, string>[], mapping: Record<string, CsvField>, existing: { statuses: string[]; tags: string[]; users: string[] }): CsvPlan {
  const col = (f: CsvField) => Object.entries(mapping).filter(([, v]) => v === f).map(([k]) => k)
  const get = (r: Record<string, string>, f: CsvField) => col(f).map((k) => r[k]?.trim() ?? '').filter(Boolean)
  const tickets = rows.map((r, i) => {
    const title = get(r, 'title')[0] ?? ''
    const key = get(r, 'external_id')[0] || `row-${i + 1}`
    const due = get(r, 'due_date')[0]
    const d = due ? new Date(due) : null
    return {
      key, title, description: get(r, 'description')[0] ?? null, status: get(r, 'status')[0] ?? '',
      priority: (() => { const p = (get(r, 'priority')[0] ?? '').toLowerCase(); return PRIORITY_MAP[p] ?? null })(),
      assignees: get(r, 'assignees').flatMap((s) => s.split(/[;,]/)).map((s) => s.trim()).filter((s) => s.includes('@')),
      tags: get(r, 'tags').flatMap((s) => s.split(/[;,]/)).map((s) => s.trim()).filter(Boolean),
      due_date: d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null,
      parentKey: get(r, 'parent')[0] ?? null,
      comments: get(r, 'comments'),
      created_at: (() => { const c = get(r, 'created_at')[0]; const x = c ? new Date(c) : null; return x && !isNaN(x.getTime()) ? x.toISOString() : null })(),
    }
  }).filter((t) => t.title)
  const lower = (a: string[]) => new Set(a.map((x) => x.toLowerCase()))
  const st = lower(existing.statuses), tg = lower(existing.tags), us = lower(existing.users)
  const newStatuses = [...new Set(tickets.map((t) => t.status).filter((s) => s && !st.has(s.toLowerCase())))].map((name) => ({ name, category: statusCategoryOf(name) }))
  const newTags = [...new Set(tickets.flatMap((t) => t.tags).filter((s) => !tg.has(s.toLowerCase())))]
  const unknownUsers = [...new Set(tickets.flatMap((t) => t.assignees).filter((e) => !us.has(e.toLowerCase())))]
  return { tickets, newStatuses, newTags, unknownUsers }
}

/** Execute a CSV plan into an existing list (project). Admin only (RLS). */
/**
 * Runs a reviewed plan. `shouldStop` lets the background job (`importJob.ts`)
 * end it between two tasks: what is already written stays, the rest is skipped
 * and `stopped` says so — half a Planner plan is better than a dialog the user
 * cannot leave.
 */
export async function runCsvImport(
  plan: CsvPlan,
  projectId: string,
  onProgress: Progress = () => {},
  sourceLabel: string | null = null,
  shouldStop: () => boolean = () => false,
): Promise<{ created: number; errors: string[]; people: number; stopped: boolean }> {
  let stopped = false
  const errors: string[] = []
  const user = await currentUser()
  if (!user) throw new Error(tr('team.import.error.noSession'))
  const startedAt = new Date().toISOString()
  const { data: statuses = [] } = await supabase.from('ticket_statuses').select('id, name, category, order_index').eq('project_id', projectId).order('order_index')
  const statusByName = new Map((statuses ?? []).map((s) => [s.name.toLowerCase(), s]))
  let nextOrder = (statuses ?? []).length
  for (const [i, st] of plan.newStatuses.entries()) {
    const { data, error } = await supabase.from('ticket_statuses')
      .insert({ project_id: projectId, name: st.name, color: colorFor(i), order_index: nextOrder++, category: st.category })
      .select('id, name, category, order_index').single()
    if (error) { errors.push(tr('team.import.error.statusCreate', { name: st.name, message: error.message })); continue }
    statusByName.set(st.name.toLowerCase(), data)
  }
  const { data: tags = [] } = await supabase.from('tags').select('id, name').eq('project_id', projectId)
  const tagByName = new Map((tags ?? []).map((t) => [t.name.toLowerCase(), t.id]))
  for (const [i, name] of plan.newTags.entries()) {
    const { data, error } = await supabase.from('tags').insert({ project_id: projectId, name, color: colorFor(i + 3) }).select('id').single()
    if (error) { errors.push(tr('team.import.error.tagCreate', { name })); continue }
    tagByName.set(name.toLowerCase(), data.id)
  }
  const keys = [...new Set([
    ...plan.tickets.flatMap((t) => t.assignees),
    ...plan.tickets.map((t) => t.completion?.personKey).filter((e): e is string => !!e),
    ...plan.tickets.map((t) => t.createdByKey).filter((e): e is string => !!e),
  ])]
  const emails = keys.filter((k) => k.includes('@'))
  const { data: users = [] } = emails.length ? await supabase.from('profiles').select('id, email').in('email', emails) : { data: [] }
  const userByEmail = new Map((users ?? []).map((u) => [(u.email ?? '').toLowerCase(), u.id]))

  // Everyone the export named but Fira does not know yet gets a placeholder
  // profile, so the assignment survives instead of being dropped on the floor.
  const { data: project } = await supabase.from('projects').select('team_id').eq('id', projectId).single()
  const peopleByKey = new Map((plan.people ?? []).map((p) => [p.key, p]))
  const personIdByKey = new Map<string, string>()
  let createdPeople = 0
  for (const key of keys) {
    const known = key.includes('@') ? userByEmail.get(key.toLowerCase()) : undefined
    if (known) { personIdByKey.set(key, known); continue }
    const person = peopleByKey.get(key) ?? { key, email: key.includes('@') ? key : null, name: key.includes('@') ? null : key.replace(/^name:/, ''), external_id: null }
    const { data, error } = await supabase.rpc('upsert_imported_profile', {
      p_team: project?.team_id ?? null,
      p_email: person.email,
      p_name: person.name,
      p_external_id: person.external_id,
      p_source: sourceLabel,
    })
    if (error || !data) {
      errors.push(tr('team.import.error.personCreate', {
        who: person.name ?? person.email ?? key,
        message: error?.message ?? tr('team.import.error.emptyResponse'),
      }))
      continue
    }
    personIdByKey.set(key, data as string)
    createdPeople++
  }

  const fallback = (statuses ?? []).find((s) => s.category === 'backlog') ?? (statuses ?? [])[0]
  const idByKey = new Map<string, string>()
  const titleToId = new Map<string, string>()
  let created = 0
  // parents first (rows without parent), then children
  const ordered = [...plan.tickets.filter((t) => !t.parentKey), ...plan.tickets.filter((t) => !!t.parentKey)]
  for (let i = 0; i < ordered.length; i++) {
    if (shouldStop()) { stopped = true; break }
    const t = ordered[i]
    onProgress(tr('team.import.progress.ticket', { i: i + 1, n: ordered.length }), i / ordered.length)
    const st = statusByName.get(t.status.toLowerCase()) ?? fallback
    const parentId = t.parentKey ? (idByKey.get(t.parentKey) ?? titleToId.get(t.parentKey.toLowerCase()) ?? null) : null
    // Everything an import writes goes through the bulk client (see supabase.ts):
    // one flag on the request, no notification storm at the other end.
    const { data, error } = await supabaseBulk.from('tickets').insert({
      title: t.title, description: t.description, status: st?.name ?? 'todo', status_id: st?.id ?? null, project_id: projectId, parent_id: parentId,
      priority: t.priority, due_date: t.due_date, created_by: user.id, updated_by: user.id, order_index: i, created_at: t.created_at ?? undefined,
    }).select('id').single()
    if (error) { errors.push(`${t.title}: ${error.message}`); continue }
    created++
    idByKey.set(t.key, data.id); titleToId.set(t.title.toLowerCase(), data.id)
    const uids = [...new Set(t.assignees.map((e) => personIdByKey.get(e)).filter((x): x is string => !!x))]
    if (uids.length) await supabaseBulk.from('ticket_assignees').insert(uids.map((uid) => ({ ticket_id: data.id, user_id: uid })))
    const tids = t.tags.map((n) => tagByName.get(n.toLowerCase())).filter((x): x is string => !!x)
    if (tids.length) await supabaseBulk.from('ticket_tag_assignments').insert(tids.map((tid) => ({ ticket_id: data.id, tag_id: tid })))
    for (const c of t.comments) if (c.trim()) await supabaseBulk.from('ticket_comments').insert({ ticket_id: data.id, author_id: user.id, content: c })
    // The ticket had to be inserted as the importing user (RLS), but it was
    // created by someone else in the source tool — hand it over, and keep who
    // brought it in as an "imported" line in the log.
    const author = t.createdByKey ? personIdByKey.get(t.createdByKey) ?? null : null
    if (author || sourceLabel) {
      const { error: aErr } = await supabaseBulk.rpc('set_import_author', {
        p_ticket: data.id, p_creator: author, p_source: sourceLabel, p_at: null,
      })
      if (aErr) errors.push(tr('team.import.error.authorSet', { title: t.title, message: aErr.message }))
    }
    // The source tool knew when and by whom the task was finished — record that as
    // a real status transition in the activity log, dated back to that moment.
    if (t.completion) {
      const { error: cErr } = await supabaseBulk.rpc('log_import_completion', {
        p_ticket: data.id,
        p_at: t.completion.at,
        p_actor: t.completion.personKey ? personIdByKey.get(t.completion.personKey) ?? null : null,
        p_from: t.completion.from,
        p_by_name: t.completion.name,
      })
      if (cErr) errors.push(tr('team.import.error.completionLog', { title: t.title, message: cErr.message }))
    }
  }
  onProgress(stopped ? tr('team.import.progress.stopped') : tr('team.import.progress.done'), 1)
  // Everything above was flagged bulk (no per-row notifications); one summary
  // per person who received work in this run, delivered to Telegram if linked.
  if (created > 0) {
    const { error: sErr } = await supabase.rpc('notify_import_summary', { p_project: projectId, p_since: startedAt })
    if (sErr) errors.push(tr('team.import.error.summaryNotify', { message: sErr.message }))
  }
  return { created, errors, people: createdPeople, stopped }
}
