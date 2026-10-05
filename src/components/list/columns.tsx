import type { ReactNode } from 'react'
import { isOverdue } from '../../lib/due'
import type { Ticket } from '../../types'
import { isCompleteStatus } from '../../types'
import type { TranslationKey } from '../../i18n'
import type { FilterSection } from '../layout/FilterOptions'
import { type ColumnKey, childProgress, commentCount, attachmentCount, nextDeadline } from '../../lib/listView'
import { displayDate, displayTime } from '../../lib/time'
import { AssigneeStack } from '../ticket/AssigneeStack'
import { UserAvatar } from '../ticket/UserAvatar'
import { ListAvatar } from '../ui/ListIcon'
import { CopyId } from '../ui/CopyId'
import { StatusCell, PriorityCell, DueCell, TagsCell, PriorityFlag, type Updater } from './InlineCells'
import { MetaIcon } from './MetaIcons'
import type { TicketStatus } from '../../types'
import { checklistProgress } from '../../lib/checklist'

/**
 * The column catalogue (#883CF8 / TL-01): everything a list can show, in one
 * table. A column is a label, a default width, a cell and — from `listView` —
 * a sort value. Adding a column means adding one entry here; the view, the
 * header, the sort and (later) the column picker read the catalogue.
 *
 * Cells are pure draws: they get the ticket and a small context and return
 * nodes. Inline editing (TL-06) will add an `edit` slot next to `cell`.
 */
export interface CellContext {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  teamId: string | null
  canWrite: boolean
  /** Resolves a project id to its name/icon (for lists that span several projects). */
  project: (id: string | null) => { name: string; icon?: string | null; icon_url?: string | null } | undefined
  now: Date
  /** Present for a single-list source: what the editable cells need (TL-06). */
  projectId: string | null
  statuses: TicketStatus[]
  update: Updater
}

export interface ColumnDef {
  key: ColumnKey
  labelKey: TranslationKey
  /** Default width in px; the name column is fluid. */
  width: number
  sortable: boolean
  /** The header offers the same filter as the header menu for this section. */
  filter?: FilterSection
  align?: 'left' | 'right'
  cell: (ticket: Ticket, ctx: CellContext) => ReactNode
  /** Drawn instead of `cell` when the viewer may write and the source is a single list (TL-06). */
  edit?: (ticket: Ticket, ctx: CellContext) => ReactNode
}

const dash = <span className="text-fg-faint text-xs">—</span>


export const COLUMNS: Record<ColumnKey, ColumnDef> = {
  name: {
    key: 'name', labelKey: 'board.list.title', width: 0, sortable: true,
    // The name cell is drawn by the row itself (indent, arrow, title, indicators) — see TicketListView.
    cell: (t) => t.title,
  },
  status: {
    key: 'status', labelKey: 'board.list.status', width: 120, sortable: true, filter: 'status',
    cell: (t) => t.status_info
      ? (
        <span className="chip-dyn border inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-md font-semibold max-w-full" style={{ '--c': t.status_info.color } as React.CSSProperties}>
          <span className="truncate">{t.status_info.name}</span>
        </span>
      )
      : <span className="text-fg-faint text-xs">{t.status}</span>,
    edit: (t, ctx) => <StatusCell ticket={t} statuses={ctx.statuses} update={ctx.update} />,
  },
  priority: {
    key: 'priority', labelKey: 'board.list.priority', width: 80, sortable: true, filter: 'priority',
    cell: (t) => <span className="inline-flex w-6 h-6 items-center justify-center"><PriorityFlag priority={t.priority} /></span>,
    edit: (t, ctx) => <PriorityCell ticket={t} update={ctx.update} />,
  },
  assignees: {
    key: 'assignees', labelKey: 'board.list.assignees', width: 104, sortable: true, filter: 'assignee',
    cell: (t, ctx) => <AssigneeStack ticketId={t.id} assignees={(t.assignees ?? []).map((a) => a.user)} teamId={ctx.teamId} canEdit={ctx.canWrite} />,
  },
  due: {
    key: 'due', labelKey: 'board.list.due', width: 96, sortable: true, filter: 'due',
    cell: (t, ctx) => t.due_date
      ? <span className={`text-xs font-medium ${isOverdue(t.due_date, ctx.now, isCompleteStatus(t.status_info)) ? 'text-danger' : 'text-fg-muted'}`}>{displayDate(t.due_date)}</span>
      : dash,
    edit: (t, ctx) => <DueCell ticket={t} update={ctx.update} now={ctx.now} />,
  },
  deadlines: {
    key: 'deadlines', labelKey: 'board.col.deadlines', width: 110, sortable: true,
    cell: (t, ctx) => {
      const d = nextDeadline(t, ctx.now)
      if (!d) return dash
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className={`text-xs font-medium ${d.past ? 'text-fg-faint' : isOverdue(d.date, ctx.now, isCompleteStatus(t.status_info)) ? 'text-danger' : 'text-fg-muted'}`}>{displayDate(d.date)}</span>
          {d.total > 1 && <span className="text-2xs tabular-nums px-1 rounded-md bg-raised text-fg-faint" title={ctx.t('board.col.deadlinesCount', { n: d.total })}>{d.total}</span>}
        </span>
      )
    },
  },
  tags: {
    key: 'tags', labelKey: 'board.col.tags', width: 140, sortable: true, filter: 'tags',
    cell: (t) => {
      const tags = t.tags ?? []
      if (!tags.length) return dash
      return (
        <span className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map(({ tag }) => (
            <span key={tag.id} className="chip-dyn border text-2xs px-1.5 py-0.5 rounded-full font-medium leading-tight" style={{ '--c': tag.color } as React.CSSProperties}>{tag.name}</span>
          ))}
          {tags.length > 3 && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-raised text-fg-faint font-medium leading-tight">+{tags.length - 3}</span>}
        </span>
      )
    },
    edit: (t, ctx) => (ctx.projectId ? <TagsCell ticket={t} projectId={ctx.projectId} /> : null),
  },
  project: {
    key: 'project', labelKey: 'board.col.project', width: 140, sortable: true,
    cell: (t, ctx) => {
      const p = ctx.project(t.project_id)
      if (!p) return dash
      return (
        <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
          <ListAvatar icon={p.icon ?? null} iconUrl={p.icon_url ?? null} color={null} size="sm" />
          <span className="text-xs text-fg-2 truncate">{p.name}</span>
        </span>
      )
    },
  },
  created: {
    key: 'created', labelKey: 'board.list.created', width: 92, sortable: true,
    cell: (t) => <span className="text-xs text-fg-faint">{displayTime(t.created_at)}</span>,
  },
  /** Görevi kim açtı (#a7a86db5): avatar + ad, atananlar sütunuyla aynı dil. */
  creator: {
    key: 'creator', labelKey: 'board.col.creator', width: 130, sortable: true,
    cell: (t) => {
      const u = t.creator
      if (!u) return dash
      return (
        <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full" title={u.full_name || u.email || ''}>
          <UserAvatar user={u} size="sm" />
          <span className="text-xs text-fg-2 truncate">{u.full_name || u.email}</span>
        </span>
      )
    },
  },
  updated: {
    key: 'updated', labelKey: 'board.col.updated', width: 92, sortable: true,
    cell: (t) => <span className="text-xs text-fg-faint">{displayTime(t.updated_at)}</span>,
  },
  children: {
    key: 'children', labelKey: 'board.col.children', width: 96, sortable: true,
    cell: (t, ctx) => {
      const p = childProgress(t)
      if (!p.total) return dash
      return (
        <span className="inline-flex items-center gap-1.5" title={ctx.t('board.card.subtasks', { done: p.done, total: p.total })}>
          <span className="w-12 h-1 rounded-full bg-line overflow-hidden"><span className={`block h-full rounded-full ${p.done === p.total ? 'bg-success' : 'bg-primary-500'}`} style={{ width: `${(p.done / p.total) * 100}%` }} /></span>
          <span className={`text-2xs tabular-nums ${p.done === p.total ? 'text-success' : 'text-fg-muted'}`}>{p.done}/{p.total}</span>
          {p.blocked > 0 && <span className="inline-flex items-center gap-0.5 text-xs text-warning font-medium" title={ctx.t('board.card.blockedSubtasks', { n: p.blocked })}><MetaIcon kind="blocked" />{p.blocked}</span>}
        </span>
      )
    },
  },
  // Yapılacaklar (#7c54fb70): alt görev sütunu gibi tamamlanan/toplam, yüzde ipucunda.
  checklist: {
    key: 'checklist', labelKey: 'board.col.checklist', width: 104, sortable: true,
    cell: (t, ctx) => {
      const p = checklistProgress(t.checklist)
      if (!p.total) return dash
      return (
        <span className="inline-flex items-center gap-1.5" title={ctx.t('board.card.checklist', { done: p.done, total: p.total, pct: p.pct })}>
          <span className="w-12 h-1 rounded-full bg-line overflow-hidden"><span className={`block h-full rounded-full ${p.done === p.total ? 'bg-success' : 'bg-primary-500'}`} style={{ width: `${p.pct}%` }} /></span>
          <span className={`text-2xs tabular-nums ${p.done === p.total ? 'text-success' : 'text-fg-muted'}`}>{p.done}/{p.total}</span>
        </span>
      )
    },
  },
  activity: {
    key: 'activity', labelKey: 'board.col.activity', width: 90, sortable: true,
    cell: (t, ctx) => {
      const c = commentCount(t), a = attachmentCount(t)
      if (!c && !a) return dash
      return (
        <span className="inline-flex items-center gap-2 text-2xs text-fg-muted tabular-nums">
          {c > 0 && <span className="inline-flex items-center gap-0.5" title={ctx.t('board.card.comments', { n: c })}><MetaIcon kind="comments" />{c}</span>}
          {a > 0 && <span className="inline-flex items-center gap-0.5" title={ctx.t('board.card.files', { n: a })}><MetaIcon kind="files" />{a}</span>}
        </span>
      )
    },
  },
  id: {
    key: 'id', labelKey: 'board.col.id', width: 88, sortable: true,
    cell: (t) => <CopyId id={t.id} />,
  },
}

export const columnDef = (key: ColumnKey): ColumnDef => COLUMNS[key]
