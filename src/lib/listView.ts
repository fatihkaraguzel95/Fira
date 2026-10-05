import type { Ticket, TicketStatus, TicketPriority, Profile, Tag, DueBucket } from '../types'
import { isCompleteStatus } from '../types'
import { dueBucket, UNASSIGNED } from './ticketFilters'
import type { TicketFilters } from '../types'
import { checklistProgress } from './checklist'

/**
 * The list view model (#883CF8 / TL-01).
 *
 * One object describes how a ticket list is drawn — grouping, sort, columns,
 * subtask mode, collapsed groups, the view toggles — and every list feature
 * reads and writes this object and nothing else. The functions below are pure:
 * the panel counts, the group headers and the rows all come from the same
 * computation, so they cannot disagree.
 *
 * Persistence is not this module's business: TL-01 keeps the config in memory
 * and in the URL (`useListViewConfig`), TL-09 adds saved views.
 */

export type GroupBy = 'none' | 'status' | 'assignee' | 'priority' | 'tags' | 'due' | 'project'
export const GROUP_BYS: GroupBy[] = ['none', 'status', 'assignee', 'priority', 'tags', 'due', 'project']

export type SortDir = 'asc' | 'desc'

/** Every column the registry knows. Adding one = one entry here + one in `columns.tsx`. */
export type ColumnKey =
  | 'name' | 'status' | 'priority' | 'assignees' | 'due' | 'deadlines' | 'tags' | 'project'
  | 'created' | 'updated' | 'creator' | 'children' | 'checklist' | 'activity' | 'id'
export const COLUMN_KEYS: ColumnKey[] = ['name', 'status', 'priority', 'assignees', 'due', 'deadlines', 'tags', 'project', 'created', 'updated', 'creator', 'children', 'checklist', 'activity', 'id']

/** How subtasks appear: hidden under their parent, open under it, or as rows of their own. */
export type SubtaskMode = 'collapse' | 'expand' | 'separate'
export type Density = 'comfortable' | 'compact'

export interface ColumnSetting { key: ColumnKey; width?: number }

/** Tickets with several assignees/tags: a row in every matching group, or one combined group per set. */
export type GroupMulti = 'each' | 'combined'

export interface ListViewConfig {
  v: 1
  groupBy: GroupBy
  groupMulti: GroupMulti
  sort: { key: ColumnKey; dir: SortDir } | null
  columns: ColumnSetting[]
  subtaskMode: SubtaskMode
  /** Group keys (see `Group.key`) the user folded. */
  collapsed: string[]
  showClosed: boolean
  /** Completed subtasks under an open parent (independent of `showClosed`). */
  showClosedSubtasks: boolean
  showEmptyGroups: boolean
  wrapText: boolean
  density: Density
  /** Only the tasks assigned to me (on top of the filters, without touching them). */
  meMode: boolean
  /** Small indicators next to the name: description, files, comments, subtasks, blockers. */
  showMeta: boolean
  /** Tag chips next to the name (the tags column is separate). */
  showTagsInline: boolean
  /** The parent's name above a subtask whose parent is not in the list. */
  showParentName: boolean
}

/** What a list looks like before anyone customises it — the board's list view today. */
export const DEFAULT_LIST_VIEW: ListViewConfig = {
  v: 1,
  groupBy: 'none',
  groupMulti: 'each',
  sort: null,
  columns: [{ key: 'name' }, { key: 'status' }, { key: 'priority' }, { key: 'assignees' }, { key: 'due' }, { key: 'created' }],
  subtaskMode: 'collapse',
  collapsed: [],
  showClosed: false,
  showClosedSubtasks: false,
  showEmptyGroups: false,
  wrapText: false,
  density: 'comfortable',
  meMode: false,
  showMeta: true,
  showTagsInline: false,
  showParentName: true,
}

const isColumnKey = (v: unknown): v is ColumnKey => typeof v === 'string' && (COLUMN_KEYS as string[]).includes(v)
const isGroupBy = (v: unknown): v is GroupBy => typeof v === 'string' && (GROUP_BYS as string[]).includes(v)

/** Accept whatever was stored (older builds, hand-edited URLs) and fall back per field. */
export function sanitizeListView(raw: unknown, base: ListViewConfig = DEFAULT_LIST_VIEW): ListViewConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ListViewConfig, unknown>>
  const columns = Array.isArray(r.columns)
    ? (r.columns as unknown[]).flatMap((c): ColumnSetting[] => {
        const key = typeof c === 'string' ? c : (c as { key?: unknown })?.key
        if (!isColumnKey(key)) return []
        const width = typeof (c as { width?: unknown })?.width === 'number' ? (c as { width: number }).width : undefined
        return [width ? { key, width } : { key }]
      })
    : base.columns
  const sortRaw = r.sort as { key?: unknown; dir?: unknown } | null | undefined
  const sort = sortRaw && isColumnKey(sortRaw.key) ? { key: sortRaw.key, dir: sortRaw.dir === 'desc' ? 'desc' as const : 'asc' as const } : sortRaw === null ? null : base.sort
  return {
    v: 1,
    groupBy: isGroupBy(r.groupBy) ? r.groupBy : base.groupBy,
    groupMulti: r.groupMulti === 'combined' ? 'combined' : r.groupMulti === 'each' ? 'each' : base.groupMulti,
    sort,
    columns: columns.length ? dedupeColumns(columns) : base.columns,
    subtaskMode: r.subtaskMode === 'collapse' || r.subtaskMode === 'expand' || r.subtaskMode === 'separate' ? r.subtaskMode : base.subtaskMode,
    collapsed: Array.isArray(r.collapsed) ? (r.collapsed as unknown[]).filter((k): k is string => typeof k === 'string') : base.collapsed,
    showClosed: typeof r.showClosed === 'boolean' ? r.showClosed : base.showClosed,
    showClosedSubtasks: typeof r.showClosedSubtasks === 'boolean' ? r.showClosedSubtasks : base.showClosedSubtasks,
    showEmptyGroups: typeof r.showEmptyGroups === 'boolean' ? r.showEmptyGroups : base.showEmptyGroups,
    wrapText: typeof r.wrapText === 'boolean' ? r.wrapText : base.wrapText,
    density: r.density === 'compact' ? 'compact' : r.density === 'comfortable' ? 'comfortable' : base.density,
    meMode: typeof r.meMode === 'boolean' ? r.meMode : base.meMode,
    showMeta: typeof r.showMeta === 'boolean' ? r.showMeta : base.showMeta,
    showTagsInline: typeof r.showTagsInline === 'boolean' ? r.showTagsInline : base.showTagsInline,
    showParentName: typeof r.showParentName === 'boolean' ? r.showParentName : base.showParentName,
  }
}

function dedupeColumns(cols: ColumnSetting[]): ColumnSetting[] {
  const seen = new Set<ColumnKey>()
  const out: ColumnSetting[] = []
  for (const c of cols) { if (!seen.has(c.key)) { seen.add(c.key); out.push(c) } }
  // The name column is the row's identity; it is always there and always first.
  if (!seen.has('name')) out.unshift({ key: 'name' })
  return out
}

// ─── URL round-trip (group / sort only; the rest waits for saved views) ──────
export function listViewFromParams(params: URLSearchParams, base: ListViewConfig): ListViewConfig {
  const patch: Partial<ListViewConfig> = {}
  const g = params.get('group')
  if (g !== null) patch.groupBy = isGroupBy(g) ? g : base.groupBy
  const s = params.get('sort')
  if (s !== null) {
    if (s === '' || s === 'none') patch.sort = null
    else if (isColumnKey(s)) patch.sort = { key: s, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' }
  }
  return Object.keys(patch).length ? { ...base, ...patch } : base
}

export function listViewToParams(cfg: ListViewConfig, params: URLSearchParams, base: ListViewConfig = DEFAULT_LIST_VIEW): URLSearchParams {
  const next = new URLSearchParams(params)
  if (cfg.groupBy !== base.groupBy) next.set('group', cfg.groupBy); else next.delete('group')
  if ((cfg.sort?.key ?? null) !== (base.sort?.key ?? null) || (cfg.sort?.dir ?? null) !== (base.sort?.dir ?? null)) {
    if (cfg.sort) { next.set('sort', cfg.sort.key); if (cfg.sort.dir === 'desc') next.set('dir', 'desc'); else next.delete('dir') }
    else { next.set('sort', 'none'); next.delete('dir') }
  } else { next.delete('sort'); next.delete('dir') }
  return next
}

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ─── Row facts every column and every group agrees on ───────────────────────
export const PRIORITY_RANK: Record<TicketPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export function childProgress(t: Pick<Ticket, 'children'>) {
  const kids = t.children ?? []
  let done = 0, blocked = 0
  for (const k of kids) { if (isCompleteStatus(k.status_info)) done++; if (k.status_info?.category === 'blocked') blocked++ }
  return { total: kids.length, done, blocked }
}

export const commentCount = (t: Pick<Ticket, 'comments'>) => t.comments?.[0]?.count ?? 0

/** The extra deadline to show: the next one from today on, else the last past one. */
export function nextDeadline(t: Pick<Ticket, 'deadlines'>, now = new Date()): { date: string; past: boolean; total: number } | null {
  const ds = (t.deadlines ?? []).map((d) => d.date).sort()
  if (!ds.length) return null
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const up = ds.find((d) => d >= today)
  return { date: up ?? ds[ds.length - 1], past: !up, total: ds.length }
}

/** Reorder the column list; the name column always stays first. */
export function moveColumn(columns: ColumnSetting[], key: ColumnKey, to: number | 'start' | 'end'): ColumnSetting[] {
  const rest = columns.filter((c) => c.key !== 'name')
  const from = rest.findIndex((c) => c.key === key)
  if (from < 0) return columns
  const [col] = rest.splice(from, 1)
  const idx = to === 'start' ? 0 : to === 'end' ? rest.length : Math.max(0, Math.min(rest.length, to))
  rest.splice(idx, 0, col)
  const name = columns.find((c) => c.key === 'name') ?? { key: 'name' as const }
  return [name, ...rest]
}
export const attachmentCount = (t: Pick<Ticket, 'attachments'>) => t.attachments?.length ?? 0

/** The value a column sorts by. `null` sorts last in both directions. */
export function sortValue(t: Ticket, key: ColumnKey): string | number | null {
  switch (key) {
    case 'name': return t.title.trim().toLocaleLowerCase()
    case 'status': return t.status_info ? t.status_info.order_index : null
    case 'priority': return t.priority ? PRIORITY_RANK[t.priority] : null
    case 'assignees': { const a = (t.assignees ?? []).map((x) => (x.user?.full_name || '').toLocaleLowerCase()).sort(); return a.length ? a[0] : null }
    case 'due': return t.due_date ?? null
    case 'deadlines': return nextDeadline(t)?.date ?? null
    case 'tags': { const a = (t.tags ?? []).map((x) => x.tag.name.toLocaleLowerCase()).sort(); return a.length ? a[0] : null }
    case 'project': return t.project_id ?? null
    case 'created': return t.created_at
    case 'updated': return t.updated_at
    // Sıralama ada göre: kimliğe göre sıralamanın kullanıcıya bir anlamı yok.
    case 'creator': return (t.creator?.full_name || t.creator?.email || '').toLocaleLowerCase('tr')
    case 'children': { const p = childProgress(t); return p.total ? p.done / p.total : null }
    case 'checklist': { const p = checklistProgress(t.checklist); return p.total ? p.done / p.total : null }
    case 'activity': return commentCount(t) + attachmentCount(t)
    case 'id': return t.id
  }
}

/** Sort a list by a column; no sort = the manual order (`order_index`). Stable, nulls last. */
export function sortTickets(tickets: Ticket[], sort: ListViewConfig['sort']): Ticket[] {
  const arr = tickets.slice()
  if (!sort) return arr.sort((a, b) => a.order_index - b.order_index)
  const dir = sort.dir === 'desc' ? -1 : 1
  const vals = new Map<string, string | number | null>(arr.map((t) => [t.id, sortValue(t, sort.key)]))
  return arr.sort((a, b) => {
    const va = vals.get(a.id) ?? null, vb = vals.get(b.id) ?? null
    if (va === null && vb === null) return a.order_index - b.order_index
    if (va === null) return 1
    if (vb === null) return -1
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return c !== 0 ? c * dir : a.order_index - b.order_index
  })
}

// ─── Grouping ────────────────────────────────────────────────────────────────
export type GroupValue =
  | { kind: 'none' }
  | { kind: 'status'; status: TicketStatus | null }
  /** `users` holds every person of a combined group; `user` is the first (null = unassigned). */
  | { kind: 'assignee'; user: Profile | null; users: Profile[] }
  | { kind: 'priority'; priority: TicketPriority | null }
  | { kind: 'tags'; tag: Tag | null; tagList: Tag[] }
  | { kind: 'due'; bucket: DueBucket }
  | { kind: 'project'; projectId: string | null }

export interface Group {
  /** Stable id, e.g. `status:<id>`, `assignee:<userId>`, `due:today`, `assignee:` (unassigned). */
  key: string
  value: GroupValue
  tickets: Ticket[]
}

const DUE_ORDER: DueBucket[] = ['overdue', 'today', 'tomorrow', 'this_week', 'next_week', 'later', 'none']

export interface GroupContext {
  /** The list's statuses, so empty status groups can be offered and order follows the board. */
  statuses?: TicketStatus[]
  now?: Date
  /** Multi-value fields (assignee, tags): a row per matching group (default) or one group per distinct set. */
  multi?: GroupMulti
}

/**
 * Split tickets into groups. A ticket with several assignees or tags appears in
 * each matching group (same object, so a change shows everywhere at once); the
 * "none" group — unassigned, untagged, undated, no status — always comes last.
 * Empty groups are only produced for statuses (the board's columns), and only
 * when asked.
 */
export function groupTickets(tickets: Ticket[], groupBy: GroupBy, ctx: GroupContext = {}, showEmpty = false): Group[] {
  if (groupBy === 'none') return [{ key: 'all', value: { kind: 'none' }, tickets }]
  const groups = new Map<string, Group>()
  const push = (key: string, value: GroupValue, t: Ticket) => {
    let g = groups.get(key)
    if (!g) { g = { key, value, tickets: [] }; groups.set(key, g) }
    g.tickets.push(t)
  }
  if (groupBy === 'status' && showEmpty) {
    for (const s of ctx.statuses ?? []) groups.set(`status:${s.id}`, { key: `status:${s.id}`, value: { kind: 'status', status: s }, tickets: [] })
  }
  for (const t of tickets) {
    switch (groupBy) {
      case 'status': push(`status:${t.status_id ?? ''}`, { kind: 'status', status: t.status_info }, t); break
      case 'priority': push(`priority:${t.priority ?? ''}`, { kind: 'priority', priority: t.priority }, t); break
      case 'due': { const b = dueBucket(t.due_date, ctx.now); push(`due:${b}`, { kind: 'due', bucket: b }, t); break }
      case 'project': push(`project:${t.project_id ?? ''}`, { kind: 'project', projectId: t.project_id }, t); break
      case 'assignee': {
        const as = (t.assignees ?? []).filter((a) => a.user)
        if (!as.length) { push('assignee:', { kind: 'assignee', user: null, users: [] }, t); break }
        if (ctx.multi === 'combined') {
          const sorted = as.slice().sort((a, b) => a.user_id.localeCompare(b.user_id))
          push(`assignee:${sorted.map((a) => a.user_id).join('+')}`, { kind: 'assignee', user: sorted[0].user, users: sorted.map((a) => a.user) }, t)
        } else for (const a of as) push(`assignee:${a.user_id}`, { kind: 'assignee', user: a.user, users: [a.user] }, t)
        break
      }
      case 'tags': {
        const tags = t.tags ?? []
        if (!tags.length) { push('tags:', { kind: 'tags', tag: null, tagList: [] }, t); break }
        if (ctx.multi === 'combined') {
          const sorted = tags.slice().sort((a, b) => a.tag.id.localeCompare(b.tag.id))
          push(`tags:${sorted.map((x) => x.tag.id).join('+')}`, { kind: 'tags', tag: sorted[0].tag, tagList: sorted.map((x) => x.tag) }, t)
        } else for (const x of tags) push(`tags:${x.tag.id}`, { kind: 'tags', tag: x.tag, tagList: [x.tag] }, t)
        break
      }
    }
  }
  const out = Array.from(groups.values())
  const statusOrder = new Map((ctx.statuses ?? []).map((s, i) => [s.id, i]))
  const rank = (g: Group): [number, string | number] => {
    const v = g.value
    switch (v.kind) {
      case 'status': return v.status ? [0, statusOrder.get(v.status.id) ?? v.status.order_index] : [1, 0]
      case 'priority': return v.priority ? [0, PRIORITY_RANK[v.priority]] : [1, 0]
      case 'due': return [0, DUE_ORDER.indexOf(v.bucket)]
      case 'assignee': return v.user ? [0, v.users.map((u) => (u.full_name || u.email || '').toLocaleLowerCase()).join(', ')] : [1, 0]
      case 'tags': return v.tag ? [0, v.tagList.map((x) => x.name.toLocaleLowerCase()).join(', ')] : [1, 0]
      case 'project': return v.projectId ? [0, v.projectId] : [1, 0]
      default: return [0, 0]
    }
  }
  return out.sort((a, b) => {
    const [na, va] = rank(a), [nb, vb] = rank(b)
    if (na !== nb) return na - nb
    return typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
  })
}

// ─── Subtask tree ────────────────────────────────────────────────────────────
export interface Row {
  ticket: Ticket
  /** 0 = top level. */
  depth: number
  /** Children rows follow this one (already flattened); `hasChildren` says whether the arrow is drawn. */
  hasChildren: boolean
  /** A subtask whose parent is not in this list (other list, filtered out): shown at the root, parent named above. */
  orphan: boolean
}

/** The tickets that head a tree here: no parent, or a parent that is not in this list (orphans). */
export function rootTickets(tickets: Ticket[]): Ticket[] {
  const ids = new Set(tickets.map((t) => t.id))
  return tickets.filter((t) => !t.parent_id || !ids.has(t.parent_id))
}

/**
 * Flatten tickets into rows. In `separate` mode every ticket is its own row.
 * Otherwise `tickets` are the roots to walk and children are looked up in
 * `pool` (defaults to `tickets`), so a group can hold the parents while the
 * subtasks come from the whole list — a subtask stays under its parent even
 * when its own status would put it in another group. Children of a parent in
 * `hidden` are left out; in `collapse` mode the caller passes every parent
 * except the ones opened in place.
 */
export function buildRows(tickets: Ticket[], mode: SubtaskMode, hidden: ReadonlySet<string> = new Set(), pool: Ticket[] = tickets): Row[] {
  // Separate rows: a subtask still says it is one (arrow glyph + parent name above), like the classic list did.
  if (mode === 'separate') return tickets.map((ticket) => ({ ticket, depth: 0, hasChildren: false, orphan: !!ticket.parent_id }))
  const ids = new Set(pool.map((t) => t.id))
  const byParent = new Map<string, Ticket[]>()
  for (const t of pool) {
    if (t.parent_id && ids.has(t.parent_id)) {
      const arr = byParent.get(t.parent_id) ?? []
      arr.push(t); byParent.set(t.parent_id, arr)
    }
  }
  const out: Row[] = []
  const walk = (t: Ticket, depth: number) => {
    const kids = byParent.get(t.id) ?? []
    out.push({ ticket: t, depth, hasChildren: kids.length > 0, orphan: depth === 0 && !!t.parent_id })
    if (kids.length && !hidden.has(t.id)) for (const k of kids) walk(k, depth + 1)
  }
  for (const r of tickets) if (!(r.parent_id && ids.has(r.parent_id))) walk(r, 0)
  return out
}

// ─── Quick due dates (inline due cell, TL-06) ────────────────────────────────
export interface QuickDate { key: 'today' | 'tomorrow' | 'weekend' | 'nextWeek' | 'twoWeeks'; labelKey: 'board.list.due.today' | 'board.list.due.tomorrow' | 'board.list.due.weekend' | 'board.list.due.nextWeek' | 'board.list.due.twoWeeks'; date: string }

/** Today, tomorrow, this Saturday, next Monday, two weeks from today. */
export function dueQuickDates(now = new Date()): QuickDate[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const at = (days: number) => { const d = new Date(base); d.setDate(d.getDate() + days); return isoDate(d) }
  const dow = base.getDay()                       // 0 = Sunday
  const toSat = dow === 6 ? 7 : (6 - dow)         // this Saturday (next one if today is Saturday)
  const toMon = ((8 - dow) % 7) || 7              // next Monday
  return [
    { key: 'today', labelKey: 'board.list.due.today', date: at(0) },
    { key: 'tomorrow', labelKey: 'board.list.due.tomorrow', date: at(1) },
    { key: 'weekend', labelKey: 'board.list.due.weekend', date: at(toSat) },
    { key: 'nextWeek', labelKey: 'board.list.due.nextWeek', date: at(toMon) },
    { key: 'twoWeeks', labelKey: 'board.list.due.twoWeeks', date: at(14) },
  ]
}

// ─── What a task created inside a group inherits ─────────────────────────────
export interface GroupPreset {
  status_id?: string
  priority?: TicketPriority | null
  assignee_ids?: string[]
  tag_ids?: string[]
  due_date?: string | null
}

/**
 * A task added under a group header takes the group's value (ClickUp rule):
 * the status, the priority, the people, the tags, or a date inside the bucket.
 * Buckets without a sensible date (overdue, none) set nothing.
 */
export function groupPreset(v: GroupValue, now = new Date()): GroupPreset {
  switch (v.kind) {
    case 'status': return v.status ? { status_id: v.status.id } : {}
    case 'priority': return { priority: v.priority }
    case 'assignee': return { assignee_ids: v.users.map((u) => u.id) }
    case 'tags': return { tag_ids: v.tagList.map((t) => t.id) }
    case 'due': {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      switch (v.bucket) {
        case 'today': return { due_date: isoDate(d) }
        case 'tomorrow': d.setDate(d.getDate() + 1); return { due_date: isoDate(d) }
        case 'this_week': return { due_date: isoDate(d) }
        case 'next_week': d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return { due_date: isoDate(d) }
        case 'later': d.setDate(d.getDate() + 14); return { due_date: isoDate(d) }
        default: return { due_date: null }
      }
    }
    default: return {}
  }
}

/**
 * When the view is filtered to exactly one value, a task typed into it takes
 * that value (ClickUp rule) — otherwise it would vanish from the view the
 * moment it was saved. Multi-valued filters set nothing.
 */
export function presetFromFilters(f: TicketFilters | undefined, now = new Date()): GroupPreset {
  if (!f) return {}
  const out: GroupPreset = {}
  if (f.status_id?.length === 1) out.status_id = f.status_id[0]
  if (f.priority?.length === 1) out.priority = f.priority[0]
  if (f.assignee_ids?.length === 1 && f.assignee_ids[0] !== UNASSIGNED) out.assignee_ids = [f.assignee_ids[0]]
  if (f.tag_ids?.length === 1) out.tag_ids = [f.tag_ids[0]]
  if (f.due?.length === 1) Object.assign(out, groupPreset({ kind: 'due', bucket: f.due[0] }, now))
  return out
}

/** Group value first, then whatever the filters pin down. */
export function mergePresets(...presets: GroupPreset[]): GroupPreset {
  const out: GroupPreset = {}
  for (const p of presets) for (const [k, v] of Object.entries(p)) if (v !== undefined && (out as Record<string, unknown>)[k] === undefined) (out as Record<string, unknown>)[k] = v
  return out
}

/**
 * Shift-click selection: every id between the anchor and the target in the
 * visible order (inclusive, either direction). Unknown ids select just the target.
 */
export function rangeBetween(order: string[], anchor: string | null, target: string): string[] {
  const a = anchor ? order.indexOf(anchor) : -1, b = order.indexOf(target)
  if (a < 0 || b < 0) return [target]
  const [from, to] = a < b ? [a, b] : [b, a]
  return order.slice(from, to + 1)
}

// ─── Row drag-and-drop (TL-11) ───────────────────────────────────────────────
export type RowDropMode = 'before' | 'after' | 'nest'

/**
 * Where a dragged row would land on the row under the pointer: the upper
 * third puts it before, the lower third after; the middle band makes it a
 * subtask when the pointer is pulled to the right of the row's name (past
 * `nestX`, in px from the row's left edge). A row cannot be dropped on itself
 * or on its own descendants — the caller checks that.
 */
export function rowDropMode(rect: { top: number; height: number; left: number }, x: number, y: number, nestX = 48): RowDropMode {
  const rel = (y - rect.top) / Math.max(1, rect.height)
  if (rel < 1 / 3) return 'before'
  if (rel > 2 / 3) return 'after'
  return x - rect.left > nestX ? 'nest' : rel < 0.5 ? 'before' : 'after'
}

/** Ids of every ticket under `id` (children, grandchildren…) within the pool. */
export function descendantIds(pool: Ticket[], id: string): Set<string> {
  const out = new Set<string>()
  let frontier = [id]
  while (frontier.length) {
    const next: string[] = []
    for (const t of pool) if (t.parent_id && frontier.includes(t.parent_id) && !out.has(t.id)) { out.add(t.id); next.push(t.id) }
    frontier = next
  }
  return out
}

/** Insert `id` into `order` before/after `target` (removing it first). */
export function placeInOrder(order: string[], id: string, target: string, mode: 'before' | 'after'): string[] {
  const rest = order.filter((x) => x !== id)
  const idx = rest.indexOf(target)
  if (idx < 0) return [...rest, id]
  rest.splice(mode === 'before' ? idx : idx + 1, 0, id)
  return rest
}
