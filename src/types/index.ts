import type { TranslationKey } from '../i18n'

// ─── Enums ───────────────────────────────────────────────────────────────────
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical'

// ─── Profiles ────────────────────────────────────────────────────────────────
export interface Profile {
  id: string
  /** Null only for imported people the source tool had no address for. */
  email: string | null
  full_name: string | null
  /**
   * `account` — a real login. `import` — created while importing another tool's
   * data for someone who has no Fira account yet; it carries their history and
   * is taken over automatically when they sign up with the same e-mail (040).
   */
  source?: 'account' | 'import'
  /** Where the imported record came from, e.g. "Microsoft Planner · REWE Tasks". */
  imported_from?: string | null
  imported_at?: string | null
  /** Their id in that other tool. */
  external_id?: string | null
  /** Small (≤256px WebP) copy — used everywhere in the UI. */
  avatar_url: string | null
  /** Bounded (≤1024px) copy for the detail view; may be null for legacy avatars. */
  avatar_full_url?: string | null
  /** True for AI-agent accounts (e.g. "Ali İlker Claude"). Assignable like anyone,
   *  but a ticket can be explicitly handed to them via "Claude'a yaptır" (059). */
  is_ai?: boolean
  created_at: string
}

// ─── AI work hand-off (059) ──────────────────────────────────────────────────
export type AiWorkStatus = 'pending' | 'processing' | 'done' | 'failed' | 'cancelled'
export interface AiWorkRequest {
  id: string
  ticket_id: string
  requested_by: string | null
  ai_user_id: string | null
  status: AiWorkStatus
  detail: string | null
  /** How it started (100): the "Claude'a yaptır" button or assigning the agent. */
  source?: 'button' | 'assign'
  claimed_at?: string | null
  finished_at?: string | null
  /** "May this go live?" (109): the agent's question and a person's answer. Written only by the server's two functions. */
  approval?: AiApprovalState | null
  created_at: string
  updated_at: string
}

export interface AiApprovalState {
  status: 'pending' | 'approved' | 'rejected'
  /** What would go live, in the agent's words. */
  summary: string
  asked_at: string
  decided_by?: string
  decided_at?: string
  note?: string
}

// ─── Agents (100) ────────────────────────────────────────────────────────────
/** An AI account bound to the person it works for, with its own settings. */
export interface Agent {
  id: string
  /** The AI account (a profile with `is_ai`). */
  profile_id: string
  owner_id: string | null
  /** Assigning a ticket to the agent starts the work; removing it stops the work. */
  assign_trigger: boolean
  /** How often the listener re-reads the queue, in seconds (30–3600). */
  poll_seconds: number
  settings: Record<string, unknown>
  /** What the listener last reported about itself. */
  runner: { kind?: string; place?: string; watch?: string } & Record<string, unknown>
  last_seen_at: string | null
  created_at: string
  updated_at: string
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
  owner?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
}

// ─── Run records (103) ───────────────────────────────────────────────────────
/** What one piece of agent work took. Opened and closed by the queue; the numbers come from the agent. */
export interface AiRun {
  id: string
  request_id: string | null
  agent_id: string | null
  ticket_id: string | null
  team_id: string | null
  /** The title the ticket had when the work started; all that is left when the ticket is deleted. */
  ticket_title: string | null
  /** Where the numbers come from: the agent's report, a transcript read afterwards, or the queue's timestamps only. */
  source: 'runner' | 'transcript' | 'queue'
  outcome: 'running' | 'done' | 'failed' | 'cancelled'
  requested_at: string | null
  started_at: string
  finished_at: string | null
  heartbeat_at: string | null
  step: string | null
  active_seconds: number | null
  turns: number | null
  model: string | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cost_usd: number | null
  version: string | null
  session_url: string | null
  /** The ticket as it is now, when the reader may still see it. */
  ticket?: {
    id: string
    title: string
    project: { name: string } | null
    status_info: { name: string; color: string | null; category: string | null } | null
  } | null
}

// ─── Muted tickets (062) ─────────────────────────────────────────────────────
/** One ticket this user stopped following; the embed feeds the settings list. */
export interface TicketMute {
  ticket_id: string
  created_at: string
  ticket: { title: string; project_id: string | null } | null
}

// ─── Teams ───────────────────────────────────────────────────────────────────
export interface Team {
  id: string
  name: string
  code: string
  created_by: string
  created_at: string
}

/** GitHub-like team roles. owner: everything (one per team); admin: manage
 *  lists/members/anything except the owner; member: write; viewer: read + comment. */
export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer'
export type InvitableRole = Exclude<TeamRole, 'owner'>

/**
 * Vocabulary tables hold translation *keys*, not text.
 *
 * They used to hold Turkish. A module-level constant is evaluated once at
 * import, so the words would have frozen in whatever language was active then
 * and never followed a language switch. Callers resolve these with `t(...)` at
 * render time; the strings themselves live in `common` (`src/i18n/locales/*`).
 */
export const ROLE_LABELS: Record<TeamRole, TranslationKey> = {
  owner: 'common.role.owner',
  admin: 'common.role.admin',
  member: 'common.role.member',
  viewer: 'common.role.viewer',
}
export const ROLE_DESCRIPTIONS: Record<TeamRole, TranslationKey> = {
  owner: 'common.roleHint.owner',
  admin: 'common.roleHint.admin',
  member: 'common.roleHint.member',
  viewer: 'common.roleHint.viewer',
}

export interface TeamMember {
  team_id: string
  user_id: string
  role: TeamRole
  joined_at: string
  user?: Profile
}

export interface TeamInvitation {
  id: string
  team_id: string
  email: string | null
  token: string
  invited_by: string
  role: InvitableRole
  status: 'pending' | 'accepted' | 'declined' | 'revoked'
  expires_at: string | null
  accepted_by: string | null
  accepted_at: string | null
  created_at: string
}

export interface PendingInvitation {
  id: string
  team_id: string
  team_name: string
  role: InvitableRole
  invited_by_name: string | null
  created_at: string
}

// ─── Team colours (named palette; lists/folders pick from it) ────────────────
export interface TeamColor {
  id: string
  team_id: string
  name: string
  hex: string
  order_index: number
  created_at: string
}

// ─── Folders (Team → Folder → List) ──────────────────────────────────────────
export interface TeamFolder {
  id: string
  team_id: string
  /** The folder this one sits in (068); null = the team root. */
  parent_id: string | null
  name: string
  color_id: string | null
  order_index: number
  created_by: string
  created_at: string
}

// ─── Pages (064) ─────────────────────────────────────────────────────────────
/** A markdown document without task properties. At most one parent column is
 *  set; none means the page sits at the team root. `team_id` is derived from
 *  the parent on the server. */
/**
 * What a row of `pages` is (096): a markdown page, or one of the two canvases
 * (beta). Canvases hold their content in `page_scenes`, never in `content`.
 */
export type PageKind = 'page' | 'drawing' | 'whiteboard'
export type CanvasKind = Exclude<PageKind, 'page'>
export const isCanvasKind = (k: PageKind | null | undefined): k is CanvasKind => k === 'drawing' || k === 'whiteboard'

export interface Page {
  id: string
  team_id: string
  folder_id: string | null
  project_id: string | null
  ticket_id: string | null
  parent_page_id: string | null
  /** Absent only in rows cached by a build older than 096; treat as 'page'. */
  kind?: PageKind
  title: string
  /** Absent in tree queries, which only need titles. */
  content?: string
  order_index: number
  created_by: string
  created_at: string
  updated_by: string | null
  updated_at: string
  /** In the trash since (067); null = live. */
  archived_at: string | null
  archived_by?: string | null
  creator?: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  updater?: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  archiver?: Pick<Profile, 'id' | 'full_name' | 'email'> | null
}

/** Where a new page goes: exactly one of these (or none → team root). */
export type PageParent =
  | { kind: 'team' }
  | { kind: 'folder'; id: string }
  | { kind: 'list'; id: string }
  | { kind: 'ticket'; id: string }
  | { kind: 'page'; id: string }

// ─── Lists (DB table is still "projects") ────────────────────────────────────
export interface Project {
  id: string
  team_id: string
  name: string
  description: string | null
  folder_id: string | null
  icon: string | null      // preset icon key (see ListIcon)
  icon_url: string | null  // uploaded logo
  /** Board background for this list — set by owners/admins (migration 043). */
  background_url?: string | null
  background_credit?: string | null
  color_id: string | null
  order_index: number
  created_by: string
  created_at: string
  color?: TeamColor | null // joined
}

// ─── Ticket Statuses ─────────────────────────────────────────────────────────
/** ClickUp-like status type. 'active' is the default (uncategorised). */
export type StatusCategory = 'backlog' | 'active' | 'blocked' | 'done' | 'closed'

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, TranslationKey> = {
  backlog: 'common.statusCategory.backlog',
  active: 'common.statusCategory.active',
  blocked: 'common.statusCategory.blocked',
  done: 'common.statusCategory.done',
  closed: 'common.statusCategory.closed',
}

export const STATUS_CATEGORY_HINTS: Record<StatusCategory, TranslationKey> = {
  backlog: 'common.statusCategoryHint.backlog',
  active: 'common.statusCategoryHint.active',
  blocked: 'common.statusCategoryHint.blocked',
  done: 'common.statusCategoryHint.done',
  closed: 'common.statusCategoryHint.closed',
}

export const STATUS_CATEGORY_ORDER: StatusCategory[] = ['backlog', 'active', 'blocked', 'done', 'closed']

/** Done + closed (except cancelled) count as complete in progress counters. */
export const isCompleteStatus = (s?: Pick<TicketStatus, 'category' | 'is_cancelled'> | null) =>
  !!s && (s.category === 'done' || (s.category === 'closed' && !s.is_cancelled))

export interface TicketStatus {
  id: string
  project_id: string
  name: string
  color: string
  order_index: number
  category: StatusCategory
  is_cancelled: boolean
}

// ─── Tags ────────────────────────────────────────────────────────────────────
export interface Tag {
  id: string
  project_id: string
  name: string
  color: string
  created_at: string
}

// ─── Tickets ─────────────────────────────────────────────────────────────────
export interface Ticket {
  blockers?: TicketBlockerRef[] | null
  id: string
  title: string
  /** Absent in the board/list query, which fetches `has_description` instead (063). */
  description?: string | null
  /** Generated column (063): is the description non-empty? Drawn as a dot on the card. */
  has_description?: boolean
  status: string          // legacy TEXT (used when no project)
  status_id: string | null // references ticket_statuses
  priority: TicketPriority | null
  assignee_id: string | null  // legacy single assignee
  project_id: string | null
  due_date: string | null
  /** Saatli bitiş: tekrar ve hatırlatma bunu kullanır (084). */
  due_time?: string | null
  /** Tekrarlayan görev serisi (084): bu görev seriden doğdu ya da serinin şablonu. */
  recurrence_id?: string | null
  /** Seri içindeki sıra (1 = şablon). */
  occurrence_no?: number | null
  archived_at: string | null
  /** Set when this ticket is a subtask of another ticket (same list, depth ≤ 3). */
  parent_id: string | null
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
  order_index: number
  // Joined relations
  assignee: Profile | null
  creator: Profile | null
  updater: Profile | null
  status_info: TicketStatus | null
  assignees: { user_id: string; user: Profile }[]
  tags: { tag: Tag }[]
  // Card indicators (lightweight aggregates joined in TICKET_SELECT)
  children?: ChildSummary[]
  attachments?: { file_url: string }[]
  /** Extra deadlines (ticket_deadlines) — dates only, for the list's column (TL-05). */
  deadlines?: { date: string }[]
  /** Chosen image attachment shown as the kanban card's header; null = no cover (061). */
  cover_url?: string | null
  comments?: { count: number }[]
  /** The task's own to-do items (097, #7c54fb70) — counted on the card, listed there when `checklist_on_board`. */
  checklist?: ChecklistItem[]
  /** Show the to-do items on the board card (set from the task window). */
  checklist_on_board?: boolean
}

/** One to-do item of a task (ticket_checklist_items, 097). Lighter than a subtask: a line and a tick. */
export interface ChecklistItem {
  id: string
  title: string
  done: boolean
  order_index: number
  ticket_id?: string
  done_by?: string | null
  done_at?: string | null
  created_by?: string | null
  created_at?: string
}

export interface ChildSummary {
  id: string
  status_info: Pick<TicketStatus, 'category' | 'color' | 'is_cancelled'> | null
}

export type LinkKind = 'relates' | 'blocks' | 'waits_for' | 'duplicates'

/** How a link reads from each side; the row is stored once (see 056). */
export const LINK_KIND_LABELS: Record<LinkKind, { out: TranslationKey; in: TranslationKey; hint: TranslationKey }> = {
  blocks:     { out: 'common.linkKind.blocks.out',     in: 'common.linkKind.blocks.in',     hint: 'common.linkKind.blocks.hint' },
  waits_for:  { out: 'common.linkKind.waits_for.out',  in: 'common.linkKind.waits_for.in',  hint: 'common.linkKind.waits_for.hint' },
  relates:    { out: 'common.linkKind.relates.out',    in: 'common.linkKind.relates.in',    hint: 'common.linkKind.relates.hint' },
  duplicates: { out: 'common.linkKind.duplicates.out', in: 'common.linkKind.duplicates.in', hint: 'common.linkKind.duplicates.hint' },
}

/** Incoming "blocks" links embedded on board/list rows (see TICKET_SELECT). */
export interface TicketBlockerRef { kind: LinkKind; source: { id: string; status_info: { category: string; is_cancelled?: boolean } | null } | null }
export const openBlockers = (t: { blockers?: TicketBlockerRef[] | null }) =>
  (t.blockers ?? []).filter((b) => b.kind === 'blocks' && b.source && !isCompleteStatus(b.source.status_info as never))

export interface TicketLink {
  id: string
  ticket_id: string
  linked_ticket_id: string
  kind: LinkKind
  created_by: string
  created_at: string
  order_index: number
  linked?: LinkedTicket | null
  /** Set on rows read from the other side (this ticket is the *target*). */
  source?: LinkedTicket | null
}

export interface TicketAttachment {
  id: string
  ticket_id: string
  file_url: string
  file_name: string
  uploaded_by: string
  created_at: string
  uploader: Profile | null
}

/** What a comment did when it was sent (#83CC7930, 077): shown as a badge next to it. */
export type CommentAction =
  | { kind: 'assign'; user_id: string; user_name: string }
  | { kind: 'close'; status: string }
  | { kind: 'block'; status: string }

export interface TicketComment {
  id: string
  ticket_id: string
  author_id: string
  content: string
  created_at: string
  /** Sonradan düzenlendiyse son düzenleme zamanı (092). */
  edited_at?: string | null
  author: Profile | null
  action?: CommentAction | null
}

// ─── Activity log ─────────────────────────────────────────────────────────────
/** One recorded change on a ticket. Written by database triggers (migration 038). */
export type ActivityKind =
  | 'created' | 'status' | 'priority' | 'title' | 'description' | 'due_date'
  | 'archived' | 'unarchived' | 'parent' | 'child_added' | 'child_removed'
  | 'assignee_added' | 'assignee_removed' | 'tag_added' | 'tag_removed'
  | 'attachment_added' | 'attachment_removed' | 'deadline_added' | 'deadline_removed'
  | 'comment_added' | 'comment_removed' | 'link_added' | 'link_removed' | 'imported' | 'mentioned' | 'project'

export interface TicketActivity {
  id: string
  ticket_id: string
  actor_id: string | null
  kind: ActivityKind
  from_value: string | null
  to_value: string | null
  meta: Record<string, unknown>
  created_at: string
  actor: Profile | null
}

// ─── Linked tickets ───────────────────────────────────────────────────────────
export interface LinkedTicket {
  id: string
  title: string
  project_id: string
  status_info: { name: string; color: string; category?: StatusCategory; is_cancelled?: boolean } | null
}

// ─── Extra Deadlines ──────────────────────────────────────────────────────────
export interface TicketDeadline {
  id: string
  ticket_id: string
  date: string
  description: string | null
  created_at: string
}

// ─── Form Types ───────────────────────────────────────────────────────────────
export interface CreateTicketInput {
  title: string
  description?: string
  status: string
  status_id?: string | null
  priority?: TicketPriority | null // omitted/null = no priority
  project_id?: string | null
  assignee_ids?: string[]
  due_date?: string | null
  tag_ids?: string[]
  parent_id?: string | null
  /** 'top' puts the new ticket at the head of its column — used by the column's quick add, so the card appears where you are looking. */
  place?: 'top' | 'bottom'
}

export interface UpdateTicketInput {
  title?: string
  description?: string | null
  status?: string
  status_id?: string | null
  priority?: TicketPriority | null
  assignee_id?: string | null
  due_date?: string | null
  order_index?: number
  project_id?: string | null
  parent_id?: string | null
  /** One of this task's own image attachments, shown as the card header (061). */
  cover_url?: string | null
}

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'later' | 'none'

export interface TicketFilters {
  status_id?: string[]
  priority?: TicketPriority[]
  /** User ids; the special value UNASSIGNED (src/lib/ticketFilters) matches tickets without assignees. */
  assignee_ids?: string[]
  tag_ids?: string[]
  due?: DueBucket[]
  search?: string
  project_id?: string
  include_archived?: boolean
  /** Show tickets in closed-category statuses (hidden by default). */
  show_closed?: boolean
  /** Show subtasks (tickets with a parent) as their own cards/rows. */
  show_children?: boolean
  /** Show tickets in backlog-category statuses ("Planlanıyor"). Shown by default;
   *  set to false to hide them and focus on what is actually in play. */
  show_backlog?: boolean
}

export type ViewMode = 'board' | 'list'

// ─── Labels ───────────────────────────────────────────────────────────────────
export const PRIORITY_LABELS: Record<TicketPriority, TranslationKey> = {
  low: 'common.priority.low',
  medium: 'common.priority.medium',
  high: 'common.priority.high',
  critical: 'common.priority.critical',
}
