import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { isOverdue } from '../../lib/due'
import type { Ticket, TicketStatus, TicketPriority, UpdateTicketInput } from '../../types'
import { isCompleteStatus, openBlockers } from '../../types'
import { useT } from '../../i18n'
import { displayDate } from '../../lib/time'
import { dueQuickDates } from '../../lib/listView'
import { celebrateTicket } from '../../lib/celebrate'
import { StatusPicker } from '../ticket/StatusPicker'
import { StatusIndicator } from '../ticket/StatusIndicator'
import { PRIORITY_COLORS } from '../ticket/PriorityPicker'
import { PRIORITY_LABELS } from '../../types'
import { TagSelector } from '../ticket/TagSelector'
import { DateInput } from '../ui/DateInput'

/**
 * Editable cells of the new list (#883CF8 / TL-06): change status, priority,
 * due date and tags without opening the task. Every control stops the click so
 * the row's "open" does not fire; every write goes through the same
 * `useUpdateTicket` path as the ticket window (optimistic, rolled back on error,
 * toast from the mutation cache).
 */
export interface Updater { (id: string, input: UpdateTicketInput): void }


const stop = (e: React.SyntheticEvent) => e.stopPropagation()

// ─── Status ──────────────────────────────────────────────────────────────────
export function StatusCell({ ticket, statuses, update, variant = 'chip' }: { ticket: Ticket; statuses: TicketStatus[]; update: Updater; variant?: 'chip' | 'dot' }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [pending, setPending] = useState<TicketStatus | null>(null)
  const status = ticket.status_info
  const blockers = openBlockers(ticket)

  // The same rule as the ticket window's applyStatus (#CFF4ADB3): completing a
  // task that open tasks still block asks once; the celebration fires from the cell.
  const apply = (s: TicketStatus, origin: Element | null) => {
    if (isCompleteStatus(s) && !isCompleteStatus(status) && blockers.length > 0 && pending?.id !== s.id) { setPending(s); return }
    setPending(null)
    if (s.id === ticket.status_id) return
    update(ticket.id, { status_id: s.id, status: s.name })
    if (isCompleteStatus(s) && !isCompleteStatus(status)) celebrateTicket(ticket.id, s.color, origin)
  }
  return (
    <span className="relative inline-flex items-center gap-1 max-w-full" onClick={stop}>
      {variant === 'dot' ? (
        // The row's leading mark (ClickUp): just the indicator, the name says the rest.
        <button
          type="button"
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          aria-haspopup="listbox"
          aria-expanded={!!anchor}
          title={status ? t('ticket.statusNamed', { name: status.name }) : t('board.list.edit.status')}
          data-status-dot
          className="w-5 h-5 rounded-md inline-flex items-center justify-center flex-shrink-0 hover:bg-raised cursor-pointer"
        >
          <StatusIndicator status={status} size={14} />
        </button>
      ) : (
      <button
        type="button"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        aria-haspopup="listbox"
        aria-expanded={!!anchor}
        title={t('board.list.edit.status')}
        data-status-dot
        className={`chip-dyn border inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-md font-semibold max-w-full hover:ring-2 hover:ring-primary-500/30 cursor-pointer ${status ? '' : 'text-fg-faint'}`}
        style={status ? ({ '--c': status.color } as React.CSSProperties) : undefined}
      >
        <span className="truncate">{status?.name ?? ticket.status}</span>
      </button>
      )}
      {/* Focus comes back to the chip when the picker closes, so ←/→ keep walking the cells. */}
      {anchor && <StatusPicker statuses={statuses} value={ticket.status_id} onChange={(s) => { const a = anchor; setAnchor(null); apply(s, a); a.focus() }} anchor={anchor} onClose={() => { const a = anchor; setAnchor(null); a.focus() }} />}
      {pending && (
        <span role="alertdialog" className="absolute left-0 top-full z-30 mt-1 w-64 bg-surface border border-warning/40 rounded-xl shadow-2xl p-2.5 text-xs text-fg-2 normal-case">
          <p className="mb-2">{t('board.list.edit.blocked', { n: blockers.length })}</p>
          <span className="flex gap-1.5">
            <button type="button" onClick={(e) => apply(pending, e.currentTarget)} className="text-2xs px-2 py-1 rounded-md bg-warning text-white font-semibold">{t('board.list.edit.completeAnyway')}</button>
            <button type="button" onClick={() => setPending(null)} className="text-xs px-2 py-1 rounded-md text-fg-2 hover:bg-raised">{t('common.giveUp')}</button>
          </span>
        </span>
      )}
    </span>
  )
}

// ─── Priority ────────────────────────────────────────────────────────────────
const PRIORITIES: TicketPriority[] = ['critical', 'high', 'medium', 'low']

/** A flag and nothing else (the owner's call: the priority must not shout). Colour = priority; medium is quiet grey; none is an outline. */
export function PriorityFlag({ priority, className = '' }: { priority: TicketPriority | null; className?: string }) {
  const t = useT()
  const color = priority ? (priority === 'medium' ? 'currentColor' : PRIORITY_COLORS[priority]) : 'currentColor'
  return (
    <svg viewBox="0 0 16 16" className={`w-4 h-4 ${priority === 'medium' ? 'text-fg-faint' : !priority ? 'text-fg-faint/60' : ''} ${className}`} fill={priority ? color : 'none'} stroke={color} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <title>{priority ? t(PRIORITY_LABELS[priority]) : t('ticketExtra.priority.none')}</title>
      <path d="M3 1v14M3 3h9l-3 3.5 3 3.5H3V3z" />
    </svg>
  )
}

export function PriorityCell({ ticket, update }: { ticket: Ticket; update: Updater }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  usePopupLayer(open, box, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  const set = (p: TicketPriority | null) => { setOpen(false); if (p !== ticket.priority) update(ticket.id, { priority: p }) }
  return (
    <span ref={box} className="relative inline-flex" onClick={stop}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title={ticket.priority ? t(PRIORITY_LABELS[ticket.priority]) : t('ticketExtra.priority.none')} className="w-6 h-6 rounded-md inline-flex items-center justify-center hover:bg-raised cursor-pointer" data-priority-flag>
        <PriorityFlag priority={ticket.priority} />
      </button>
      {open && (
        <span role="listbox" aria-label={t('ticketExtra.priority.label')} className="absolute left-0 top-full z-30 mt-1 w-40 bg-surface border border-line rounded-xl shadow-2xl py-1 block text-left">
          {PRIORITIES.map((p) => (
            <button key={p} type="button" role="option" aria-selected={ticket.priority === p} onClick={() => set(p)} className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-raised ${ticket.priority === p ? 'text-fg font-medium' : 'text-fg-2'}`}>
              <PriorityFlag priority={p} />{t(PRIORITY_LABELS[p])}
            </button>
          ))}
          <button type="button" role="option" aria-selected={!ticket.priority} onClick={() => set(null)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-fg-muted hover:bg-raised"><PriorityFlag priority={null} />{t('ticketExtra.priority.none')}</button>
        </span>
      )}
    </span>
  )
}

// ─── Due date ────────────────────────────────────────────────────────────────
export function DueCell({ ticket, update, now }: { ticket: Ticket; update: Updater; now: Date }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  usePopupLayer(open, box, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  const set = (d: string | null) => { setOpen(false); if (d !== (ticket.due_date ?? null)) update(ticket.id, { due_date: d }) }
  const quick = dueQuickDates(now)
  return (
    <span ref={box} className="relative inline-block" onClick={stop}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('board.list.edit.due')}
        className={`inline-flex items-center gap-1 text-xs font-medium rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-raised cursor-pointer ${ticket.due_date ? (isOverdue(ticket.due_date, now, isCompleteStatus(ticket.status_info)) ? 'text-danger' : 'text-fg-muted') : 'text-fg-faint'}`}
      >
        {ticket.due_date ? displayDate(ticket.due_date) : (
          <Icon name="calendar" />
        )}
      </button>
      {open && (
        <span role="dialog" aria-label={t('board.list.edit.due')} className="absolute left-0 top-full z-30 mt-1 w-60 bg-surface border border-line rounded-xl shadow-2xl py-1 normal-case tracking-normal font-normal text-left block">
          {quick.map((q) => (
            <button key={q.key} type="button" onClick={() => set(q.date)} className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-fg-2 hover:bg-raised hover:text-fg">
              <span>{t(q.labelKey)}</span>
              <span className="text-xs text-fg-faint">{displayDate(q.date)}</span>
            </button>
          ))}
          <span className="block border-t border-line-soft my-1" />
          <span className="block px-3 py-1.5"><DateInput value={ticket.due_date} onChange={set} className="w-full text-sm bg-field border border-line rounded-lg px-2 py-1 text-fg" aria-label={t('board.list.due')} /></span>
          {ticket.due_date && <button type="button" onClick={() => set(null)} className="w-full text-left px-3 py-1.5 text-xs text-fg-muted hover:bg-raised hover:text-danger">{t('board.list.edit.dueClear')}</button>}
        </span>
      )}
    </span>
  )
}

// ─── Tags ────────────────────────────────────────────────────────────────────
export function TagsCell({ ticket, projectId }: { ticket: Ticket; projectId: string }) {
  return (
    <span className="block" onClick={stop}>
      <TagSelector ticketId={ticket.id} projectId={projectId} assignedTags={(ticket.tags ?? []).map((x) => x.tag)} />
    </span>
  )
}

// ─── Title ───────────────────────────────────────────────────────────────────
export function TitleEditor({ ticket, update, onDone }: { ticket: Ticket; update: Updater; onDone: () => void }) {
  const t = useT()
  const [title, setTitle] = useState(ticket.title)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.select() }, [])
  const commit = () => {
    const next = title.trim()
    if (next && next !== ticket.title) update(ticket.id, { title: next })
    onDone()
  }
  return (
    <input
      ref={ref}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onClick={stop}
      onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { e.preventDefault(); onDone() } }}
      aria-label={t('board.list.edit.title')}
      className="flex-1 min-w-0 text-sm bg-field border border-primary-500 rounded-md px-1.5 py-0.5 outline-none text-fg font-medium"
    />
  )
}
