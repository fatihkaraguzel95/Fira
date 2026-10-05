import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { createPortal } from 'react-dom'
import type { Ticket, TicketStatus, TicketPriority, LinkKind } from '../../types'
import { LINK_KIND_LABELS } from '../../types'
import { useT } from '../../i18n'
import { displayDate } from '../../lib/time'
import { dueQuickDates } from '../../lib/listView'
import { useBulkTickets, BULK_LIMIT } from '../../hooks/useBulkTickets'
import { useTeamMemberProfiles } from '../../hooks/useTeams'
import { useTags } from '../../hooks/useTags'
import { usePrefs, GLOBAL_SCOPE } from '../../hooks/usePrefs'
import { UserAvatar } from '../ticket/UserAvatar'
import { StatusIndicator } from '../ticket/StatusIndicator'
import { PriorityFlag } from './InlineCells'
import { PRIORITY_LABELS } from '../../types'
import { DateInput } from '../ui/DateInput'
import { MoveToListDialog } from '../ticket/MoveToListDialog'

/**
 * The bar under a multi-selection (#883CF8 / TL-08): one click applies a
 * change to every selected task. Lives in a portal at the bottom of the
 * viewport, like ClickUp's Bulk Action Toolbar. "Notify" decides whether the
 * people involved hear about it (off = the bulk header, nobody is told).
 */
interface Props {
  tickets: Ticket[]
  statuses: TicketStatus[]
  teamId: string | null
  projectId: string | null
  /** Tickets the viewer cannot write (they are skipped and named in the hint). */
  readOnlyCount?: number
  onClear: () => void
}

function Pop({ label, icon, children, disabled, testId }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode; disabled?: boolean; testId?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  return (
    <div ref={box} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" data-bulk={testId} className="h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40 disabled:cursor-default transition-colors">
        {icon}<span className="hidden sm:inline">{label}</span>
      </button>
      {open && (
        <div role="dialog" aria-label={label} className="absolute bottom-full left-0 z-[310] mb-2 w-64 max-h-80 overflow-y-auto scrollbar-thin bg-surface border border-line rounded-xl shadow-2xl py-1 text-left">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

const item = 'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-fg-2 hover:bg-raised hover:text-fg'

export function BulkActionBar({ tickets, statuses, teamId, projectId, readOnlyCount = 0, onClear }: Props) {
  const t = useT()
  const bulk = useBulkTickets()
  const members = useTeamMemberProfiles(teamId)
  const { data: tags = [] } = useTags(projectId)
  const prefs = usePrefs(GLOBAL_SCOPE)
  const notify = (prefs.prefs as { bulkNotify?: unknown }).bulkNotify !== false
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [moveDlg, setMoveDlg] = useState<'move' | 'copy' | null>(null)
  const ids = tickets.map((x) => x.id)
  const n = ids.length
  const busy = Object.values(bulk).some((m) => m.isPending)
  const over = n > BULK_LIMIT
  // Convert to subtasks: the first selected becomes the parent of the others —
  // only when it is not itself deep and the others have no children of their own.
  const [first, ...rest] = tickets
  const canNest = n > 1 && !!first && !first.parent_id && rest.every((x) => !(x.children?.length) && x.project_id === first.project_id)
  const canWriteHere = !!projectId

  useEffect(() => { setConfirmDelete(false) }, [n])

  const quick = dueQuickDates()
  const bar = (
    <div role="toolbar" aria-label={t('board.list.bulk.aria')} data-bulk-bar className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] max-w-[calc(100vw-2rem)] flex items-center gap-1 bg-surface border border-line rounded-xl shadow-2xl px-2 py-1.5 animate-fade-in">
      <span className="inline-flex items-center gap-1.5 pl-2 pr-2 text-sm font-semibold text-fg border-r border-line-soft mr-1 whitespace-nowrap">
        <span data-bulk-count className="inline-flex items-center gap-1.5"><span className="min-w-[1.5rem] h-6 px-1.5 rounded-md bg-primary-600 text-white text-xs inline-flex items-center justify-center tabular-nums">{n}</span>{t('board.list.bulk.selected', { n }).replace(/^\d+\s*/, '')}</span>
        <button type="button" onClick={onClear} aria-label={t('board.list.bulk.clear')} title={t('board.list.bulk.clear')} className="w-6 h-6 rounded-md inline-flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised">✕</button>
      </span>
      {over && <span className="text-xs text-danger px-2">{t('board.list.bulk.limit', { n: BULK_LIMIT })}</span>}
      {!over && (
        <>
          <Pop label={t('board.list.status')} icon={<Icon name="half" />} disabled={!canWriteHere || busy} testId="status">
            {(close) => statuses.map((s) => (
              <button key={s.id} type="button" onClick={() => { bulk.update.mutate({ ids, patch: { status_id: s.id, status: s.name }, notify }); close() }} className={item}>
                <StatusIndicator status={s} size={14} /><span className="truncate">{s.name}</span>
              </button>
            ))}
          </Pop>
          <Pop label={t('board.list.assignees')} icon={<Icon name="userAdd" />} disabled={!teamId || busy} testId="assignees">
            {(close) => (
              <>
                {members.length === 0 && <span className="block px-3 py-1.5 text-xs text-fg-faint">{t('board.quickAdd.noMembers')}</span>}
                {members.map((m) => (
                  <span key={m.id} className="flex items-center gap-2 px-3 py-1 text-sm">
                    <UserAvatar user={m} size="sm" /><span className="flex-1 truncate text-fg-2">{m.full_name || m.email}</span>
                    <button type="button" onClick={() => { bulk.assign.mutate({ ids, userId: m.id, mode: 'add', notify }); close() }} className="text-2xs px-1.5 py-0.5 rounded-md bg-primary-600 text-white hover:bg-primary-700">{t('board.list.bulk.add')}</button>
                    <button type="button" onClick={() => { bulk.assign.mutate({ ids, userId: m.id, mode: 'remove', notify }); close() }} className="text-2xs px-1.5 py-0.5 rounded-md text-fg-muted hover:bg-raised hover:text-danger">{t('board.list.bulk.remove')}</button>
                  </span>
                ))}
              </>
            )}
          </Pop>
          <Pop label={t('board.list.due')} icon={<Icon name="calendar" />} disabled={busy} testId="due">
            {(close) => (
              <>
                {quick.map((q) => <button key={q.key} type="button" onClick={() => { bulk.update.mutate({ ids, patch: { due_date: q.date }, notify }); close() }} className={`${item} justify-between`}><span>{t(q.labelKey)}</span><span className="text-xs text-fg-faint">{displayDate(q.date)}</span></button>)}
                <span className="block border-t border-line-soft my-1" />
                <span className="block px-3 py-1.5"><DateInput value={null} onChange={(v) => { if (v) { bulk.update.mutate({ ids, patch: { due_date: v }, notify }); close() } }} className="w-full text-sm bg-field border border-line rounded-lg px-2 py-1 text-fg" aria-label={t('board.list.due')} /></span>
                <button type="button" onClick={() => { bulk.update.mutate({ ids, patch: { due_date: null }, notify }); close() }} className={`${item} text-xs text-fg-muted hover:text-danger`}>{t('board.list.edit.dueClear')}</button>
              </>
            )}
          </Pop>
          <Pop label={t('board.list.priority')} icon={<Icon name="flag" />} disabled={busy} testId="priority">
            {(close) => (
              <>
                {(['critical', 'high', 'medium', 'low'] as TicketPriority[]).map((p) => (
                  <button key={p} type="button" onClick={() => { bulk.update.mutate({ ids, patch: { priority: p }, notify }); close() }} className={item}>
                    <PriorityFlag priority={p} />{t(PRIORITY_LABELS[p])}
                  </button>
                ))}
                <button type="button" onClick={() => { bulk.update.mutate({ ids, patch: { priority: null }, notify }); close() }} className={`${item} text-xs text-fg-muted`}>{t('ticketExtra.priority.none')}</button>
              </>
            )}
          </Pop>
          <Pop label={t('board.col.tags')} icon={<Icon name="tag" />} disabled={!projectId || busy} testId="tags">
            {(close) => (
              <>
                {tags.length === 0 && <span className="block px-3 py-1.5 text-xs text-fg-faint">—</span>}
                {tags.map((x) => (
                  <span key={x.id} className="flex items-center gap-2 px-3 py-1 text-sm">
                    <span className="chip-dyn border text-2xs px-1.5 py-0.5 rounded-full flex-1 truncate" style={{ '--c': x.color } as React.CSSProperties}>{x.name}</span>
                    <button type="button" onClick={() => { bulk.tag.mutate({ ids, tagId: x.id, mode: 'add' }); close() }} className="text-2xs px-1.5 py-0.5 rounded-md bg-primary-600 text-white hover:bg-primary-700">{t('board.list.bulk.add')}</button>
                    <button type="button" onClick={() => { bulk.tag.mutate({ ids, tagId: x.id, mode: 'remove' }); close() }} className="text-2xs px-1.5 py-0.5 rounded-md text-fg-muted hover:bg-raised hover:text-danger">{t('board.list.bulk.remove')}</button>
                  </span>
                ))}
              </>
            )}
          </Pop>
          <button type="button" disabled={!teamId || busy} onClick={() => setMoveDlg('move')} data-bulk="move" className="h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40"><Icon name="moveTo" /><span className="hidden lg:inline">{t('board.card.moveTitle')}</span></button>
          <button type="button" disabled={busy} onClick={() => setMoveDlg('copy')} data-bulk="copy" className="h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40"><Icon name="copy" /><span className="hidden lg:inline">{t('board.card.copy')}</span></button>
          <button type="button" disabled={!canNest || busy} title={canNest ? t('board.list.bulk.nestHint') : t('board.list.bulk.nestDisabled')} onClick={() => bulk.setParent.mutate({ ids: rest.map((x) => x.id), parentId: first.id, notify })} data-bulk="nest" className="h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40"><Icon name="chevronRight" /><span className="hidden lg:inline">{t('board.list.bulk.nest')}</span></button>
          <Pop label={t('ticket.link.add')} icon={<Icon name="link" />} disabled={n < 2 || busy} testId="link">
            {(close) => (Object.keys(LINK_KIND_LABELS) as LinkKind[]).map((k) => (
              <button key={k} type="button" onClick={() => { bulk.link.mutate({ ids, kind: k }); close() }} className={item}>{t(LINK_KIND_LABELS[k].out)}</button>
            ))}
          </Pop>
          <button type="button" disabled={busy} onClick={() => bulk.archive.mutate({ ids, notify }, { onSuccess: onClear })} data-bulk="archive" className="h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40"><Icon name="archive" /><span className="hidden lg:inline">{t('board.card.archive')}</span></button>
          {confirmDelete ? (
            <span className="inline-flex items-center gap-1 pl-1">
              <button type="button" onClick={() => bulk.remove.mutate({ ids }, { onSuccess: onClear })} data-bulk="delete-yes" className="text-xs px-2.5 h-8 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold">{t('board.list.bulk.deleteYes', { n })}</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs px-2 h-8 rounded-lg text-fg-2 hover:bg-raised">{t('common.giveUp')}</button>
            </span>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} data-bulk="delete" className="h-9 px-2.5 ml-1 rounded-lg inline-flex items-center gap-1.5 text-sm text-danger hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"><Icon name="trash" /><span className="hidden lg:inline">{t('common.delete')}</span></button>
          )}
          <label className="inline-flex items-center gap-1.5 pl-2 ml-1 border-l border-line-soft text-xs text-fg-muted cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" className="rounded-md" checked={notify} onChange={(e) => prefs.patch({ v: 1, bulkNotify: e.target.checked ? null : false })} />
            {t('board.list.bulk.notify')}
          </label>
        </>
      )}
      {readOnlyCount > 0 && <span className="text-xs text-warning px-2" title={t('board.list.bulk.readOnlyHint')}>{t('board.list.bulk.readOnly', { n: readOnlyCount })}</span>}
      {busy && <span className="w-4 h-4 ml-1 rounded-full border-2 border-primary-600 border-t-transparent animate-spin" aria-label={t('common.saving')} />}
    </div>
  )
  return createPortal(
    <>
      {bar}
      {moveDlg && (
        <MoveToListDialog
          teamId={teamId}
          currentProjectId={projectId}
          busy={busy}
          onPick={(project) => { if (moveDlg === 'move') bulk.move.mutate({ ids, projectId: project.id }, { onSuccess: onClear }); else bulk.copy.mutate({ ids, projectId: project.id }); setMoveDlg(null) }}
          onClose={() => setMoveDlg(null)}
        />
      )}
    </>,
    document.body,
  )
}
