/**
 * Fira backup bundle — schema v1.
 *
 * The single source of truth for export/import. Every table that holds team
 * data is included with its raw columns (ids preserved). Users are carried by
 * e-mail (profiles) so a bundle can be restored into another Fira instance.
 * Tool-specific exports (CSV/Excel for Jira, ClickUp, Planner, Notion) are
 * derived from this bundle — see csv.ts / tools.ts.
 */
export const BACKUP_SCHEMA_VERSION = 1 as const

export interface BundleProfile { id: string; email: string; full_name: string | null; avatar_url: string | null }
export interface BundleMember { user_id: string; role: string; joined_at: string }
export interface BundleTeam { id: string; name: string; code: string; created_by: string; created_at: string }
export interface BundleColor { id: string; team_id: string; name: string; hex: string; order_index: number; created_at: string }
export interface BundleFolder { id: string; team_id: string; name: string; color_id: string | null; order_index: number; created_by: string; created_at: string }
export interface BundleProject {
  id: string; team_id: string; name: string; description: string | null; created_by: string; created_at: string
  archived: boolean | null; folder_id: string | null; icon: string | null; icon_url: string | null; color_id: string | null; order_index: number
}
export interface BundleStatus { id: string; project_id: string; name: string; color: string; order_index: number; category: string; is_cancelled: boolean }
export interface BundleTag { id: string; project_id: string; name: string; color: string; created_at: string }
export interface BundleTicket {
  id: string; title: string; description: string | null; status: string; status_id: string | null; priority: string | null
  assignee_id: string | null; due_date: string | null; created_by: string; created_at: string; updated_at: string; order_index: number
  project_id: string | null; updated_by: string | null; archived_at: string | null; parent_id: string | null
}
export interface BundleAssignee { ticket_id: string; user_id: string }
export interface BundleTagAssignment { ticket_id: string; tag_id: string }
export interface BundleComment { id: string; ticket_id: string; author_id: string; content: string; created_at: string }
export interface BundleAttachment { id: string; ticket_id: string; file_url: string; file_name: string; uploaded_by: string; created_at: string }
export interface BundleDeadline { id: string; ticket_id: string; date: string; description: string | null; created_at: string }
export interface BundleLink { id: string; ticket_id: string; linked_ticket_id: string; created_by: string; created_at: string; order_index: number }

export interface BackupBundle {
  schema_version: typeof BACKUP_SCHEMA_VERSION
  exported_at: string
  exported_by: { id: string; email: string | null } | null
  app_version: string
  source_origin: string
  team: BundleTeam
  members: BundleMember[]
  profiles: BundleProfile[]
  team_colors: BundleColor[]
  team_folders: BundleFolder[]
  projects: BundleProject[]
  ticket_statuses: BundleStatus[]
  tags: BundleTag[]
  tickets: BundleTicket[]
  ticket_assignees: BundleAssignee[]
  ticket_tag_assignments: BundleTagAssignment[]
  ticket_comments: BundleComment[]
  ticket_attachments: BundleAttachment[]
  ticket_deadlines: BundleDeadline[]
  ticket_links: BundleLink[]
  /** Files included in the ZIP (attachments/ and logos/). Empty for meta-only backups. */
  files: BundleFile[]
  warnings: string[]
}

export interface BundleFile {
  /** Path inside the ZIP, e.g. attachments/<ticket_id>/<name> or logos/<project_id>/<name>. */
  path: string
  /** Original public URL at export time (used to rewrite descriptions on restore). */
  url: string
  size: number
  sha256: string | null
  /** Which record this file belongs to. */
  ref: { kind: 'attachment'; id: string; ticket_id: string } | { kind: 'logo'; project_id: string } | { kind: 'description-image'; ticket_id: string }
}

export type ImportMode = 'restore' | 'skip' | 'copy'

export interface ImportReport {
  mode: ImportMode
  team_id: string
  counts: Record<string, { inserted: number; updated: number; skipped: number }>
  unmapped_users: string[]
  id_map?: Record<string, string>
  errors: string[]
}

export const BUNDLE_TABLES = [
  'team_colors', 'team_folders', 'projects', 'ticket_statuses', 'tags', 'tickets',
  'ticket_assignees', 'ticket_tag_assignments', 'ticket_comments', 'ticket_attachments', 'ticket_deadlines', 'ticket_links', 'members',
] as const

export function countBundle(b: BackupBundle) {
  return {
    listeler: b.projects.length,
    gorevler: b.tickets.filter((t) => !t.parent_id).length,
    alt_gorevler: b.tickets.filter((t) => !!t.parent_id).length,
    yorumlar: b.ticket_comments.length,
    dosyalar: b.ticket_attachments.length,
    uyeler: b.members.length,
  }
}
