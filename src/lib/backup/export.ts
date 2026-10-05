import JSZip from 'jszip'
import { currentUser } from '../session'
import { supabase } from '../supabase'
import { APP_VERSION } from '../../version'
// `t` is the loop variable for tickets throughout this file, so the translator
// is imported under another name. Call it at use time, never at module level.
import { t as tr } from '../../i18n'
import type { BackupBundle, BundleFile, BundleTicket } from './types'
import { BACKUP_SCHEMA_VERSION } from './types'

export type Progress = (msg: string, ratio: number) => void

const PAGE = 1000
const CHUNK = 60

/** Read a whole table (or a filtered subset) page by page. */
async function readAll<T>(table: string, filter: (q: any) => any, order = 'id'): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select('*').order(order, { ascending: true }).range(from, from + PAGE - 1)
    q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function readIn<T>(table: string, column: string, ids: string[], order = 'id'): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    out.push(...(await readAll<T>(table, (q) => q.in(column, slice), order)))
  }
  return out
}

async function sha256(blob: Blob): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

const fileNameFromUrl = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() ?? 'dosya')
const IMG_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g

/** Collect the team's data into a bundle. */
export async function collectBundle(teamId: string, onProgress: Progress = () => {}): Promise<BackupBundle> {
  const warnings: string[] = []
  onProgress(tr('team.backup.progress.team'), 0.02)
  const { data: team, error: tErr } = await supabase.from('teams').select('*').eq('id', teamId).single()
  if (tErr || !team) throw new Error(tr('team.backup.error.teamRead', { message: tErr?.message ?? '' }))
  const user = await currentUser()

  const members = await readAll<any>('team_members', (q) => q.eq('team_id', teamId), 'user_id')
  const team_colors = await readAll<any>('team_colors', (q) => q.eq('team_id', teamId), 'order_index')
  const team_folders = await readAll<any>('team_folders', (q) => q.eq('team_id', teamId), 'order_index')
  onProgress(tr('team.backup.progress.lists'), 0.1)
  const projects = await readAll<any>('projects', (q) => q.eq('team_id', teamId), 'order_index')
  const projectIds = projects.map((p) => p.id)
  const ticket_statuses = await readIn<any>('ticket_statuses', 'project_id', projectIds, 'order_index')
  const tags = await readIn<any>('tags', 'project_id', projectIds, 'name')
  onProgress(tr('team.backup.progress.tickets'), 0.2)
  const tickets = await readIn<BundleTicket>('tickets', 'project_id', projectIds, 'created_at')
  const ticketIds = tickets.map((t) => t.id)
  onProgress(tr('team.backup.progress.assignments'), 0.35)
  const ticket_assignees = await readIn<any>('ticket_assignees', 'ticket_id', ticketIds, 'ticket_id')
  const ticket_tag_assignments = await readIn<any>('ticket_tag_assignments', 'ticket_id', ticketIds, 'ticket_id')
  const ticket_deadlines = await readIn<any>('ticket_deadlines', 'ticket_id', ticketIds, 'created_at')
  const ticket_links = await readIn<any>('ticket_links', 'ticket_id', ticketIds, 'order_index')
  onProgress(tr('team.backup.progress.comments'), 0.45)
  const ticket_comments = await readIn<any>('ticket_comments', 'ticket_id', ticketIds, 'created_at')
  onProgress(tr('team.backup.progress.fileRecords'), 0.5)
  const ticket_attachments = await readIn<any>('ticket_attachments', 'ticket_id', ticketIds, 'created_at')

  // Users referenced anywhere → profiles (by id; e-mail is the portable key)
  const userIds = new Set<string>()
  members.forEach((m) => userIds.add(m.user_id))
  tickets.forEach((t) => { userIds.add(t.created_by); if (t.updated_by) userIds.add(t.updated_by); if (t.assignee_id) userIds.add(t.assignee_id) })
  ticket_assignees.forEach((a) => userIds.add(a.user_id))
  ticket_comments.forEach((c) => userIds.add(c.author_id))
  ticket_attachments.forEach((a) => userIds.add(a.uploaded_by))
  ticket_links.forEach((l) => userIds.add(l.created_by))
  team_folders.forEach((f) => userIds.add(f.created_by))
  projects.forEach((p) => userIds.add(p.created_by))
  userIds.add(team.created_by)
  const profiles = await readIn<any>('profiles', 'id', [...userIds], 'email')
  const missing = [...userIds].filter((id) => !profiles.some((p) => p.id === id))
  if (missing.length) warnings.push(tr('team.backup.warn.profiles', { n: missing.length }))

  return {
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    exported_by: user ? { id: user.id, email: user.email ?? null } : null,
    app_version: APP_VERSION,
    source_origin: window.location.origin,
    team, members: members.map((m) => ({ user_id: m.user_id, role: m.role, joined_at: m.joined_at })),
    profiles: profiles.map((p) => ({ id: p.id, email: p.email, full_name: p.full_name, avatar_url: p.avatar_url })),
    team_colors, team_folders, projects, ticket_statuses, tags, tickets,
    ticket_assignees, ticket_tag_assignments, ticket_comments, ticket_attachments, ticket_deadlines, ticket_links,
    files: [], warnings,
  }
}

/**
 * Build the ZIP: backup.json + README + optional files (attachments, logos,
 * description images). Returns the blob and the final bundle (with `files`).
 */
export async function buildBackupZip(
  teamId: string,
  opts: { includeFiles: boolean },
  onProgress: Progress = () => {},
): Promise<{ blob: Blob; bundle: BackupBundle; fileName: string }> {
  const bundle = await collectBundle(teamId, onProgress)
  const zip = new JSZip()
  const files: BundleFile[] = []

  if (opts.includeFiles) {
    // Attachments
    const jobs: { url: string; path: string; ref: BundleFile['ref'] }[] = []
    for (const a of bundle.ticket_attachments) jobs.push({ url: a.file_url, path: `attachments/${a.ticket_id}/${a.id}-${fileNameFromUrl(a.file_url)}`, ref: { kind: 'attachment', id: a.id, ticket_id: a.ticket_id } })
    for (const p of bundle.projects) if (p.icon_url) jobs.push({ url: p.icon_url, path: `logos/${p.id}/${fileNameFromUrl(p.icon_url)}`, ref: { kind: 'logo', project_id: p.id } })
    // Images referenced from descriptions that are not attachment records
    const known = new Set(jobs.map((j) => j.url.split('?')[0]))
    for (const t of bundle.tickets) {
      for (const m of (t.description ?? '').matchAll(IMG_RE)) {
        const url = m[1]
        if (!url.includes('/storage/v1/object/public/') || known.has(url.split('?')[0])) continue
        known.add(url.split('?')[0])
        jobs.push({ url, path: `images/${t.id}/${fileNameFromUrl(url)}`, ref: { kind: 'description-image', ticket_id: t.id } })
      }
    }
    let done = 0
    for (const job of jobs) {
      onProgress(tr('team.backup.progress.files', { i: done + 1, n: jobs.length }), 0.55 + 0.35 * (done / Math.max(1, jobs.length)))
      try {
        const res = await fetch(job.url)
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        zip.file(job.path, blob)
        files.push({ path: job.path, url: job.url, size: blob.size, sha256: await sha256(blob), ref: job.ref })
      } catch (e) {
        bundle.warnings.push(tr('team.backup.warn.fileDownload', { url: job.url, message: (e as Error).message }))
      }
      done++
    }
  }
  bundle.files = files

  onProgress(tr('team.backup.progress.zip'), 0.92)
  zip.file('backup.json', JSON.stringify(bundle, null, 2))
  zip.file('manifest.json', JSON.stringify({ schema_version: bundle.schema_version, exported_at: bundle.exported_at, team: bundle.team.name, files }, null, 2))
  // Prose for whoever opens the ZIP — in the language the export was made in.
  // Nothing reads it back, so translating it breaks no round trip.
  zip.file('README.txt', [
    tr('team.backup.readme.title', { team: bundle.team.name }),
    tr('team.backup.readme.meta', { date: bundle.exported_at, app: bundle.app_version, schema: bundle.schema_version }),
    '',
    tr('team.backup.readme.contents'),
    tr('team.backup.readme.restore'),
    tr('team.backup.readme.modes'),
    tr('team.backup.readme.tools'),
  ].join('\n'))

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (m) => onProgress(tr('team.backup.progress.compressing'), 0.92 + 0.08 * (m.percent / 100)))
  const slug = bundle.team.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'takim'
  const fileName = `fira-backup-${slug}-${bundle.exported_at.slice(0, 10)}.zip`
  onProgress(tr('team.backup.progress.ready'), 1)
  return { blob, bundle, fileName }
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
