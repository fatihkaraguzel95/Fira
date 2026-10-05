import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { Icon } from '../ui/Icon'
import { isOverdue } from '../../lib/due'
import { useNavigate } from 'react-router-dom'
import { openTicket } from '../../lib/nav'
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Ticket, TicketStatus } from '../../types'
import { isCompleteStatus } from '../../types'
import { useChildTickets, useCreateChild, useReorderChildren, useSetParent } from '../../hooks/useChildren'
import { useUpdateTicket, useDeleteTicket } from '../../hooks/useTickets'
import { useTicketLinks, useIncomingLinks, useRemoveLink, useSetLinkKind, useFlipLink } from '../../hooks/useLinks'
import { LINK_KIND_LABELS, type LinkKind, type TicketLink } from '../../types'
import { useT, type TranslationKey } from '../../i18n'
import { displayDate, useDateFormat } from '../../lib/time'
import { StatusIndicator } from './StatusIndicator'
import { StatusPicker } from './StatusPicker'
import { celebrateTicket } from '../../lib/celebrate'
import { AssigneeStack } from './AssigneeStack'
import { PriorityFlagBadge } from './PriorityPicker'
import { LinkTicketBar } from './LinkTicketBar'
import { usePrefs } from '../../hooks/usePrefs'
import { SectionHide } from './SectionHide'

interface Props {
  parent: Ticket
  statuses: TicketStatus[]
  teamId: string | null
  canEdit: boolean
  canDelete: (createdBy: string) => boolean
  /**
   * Which half to render. The ticket window shows subtasks and linked tasks in
   * different places, so each asks for just its section; 'both' keeps the old
   * stacked behaviour for any other caller.
   */
  section?: 'subtasks' | 'links' | 'both'
  /** Hide the section's own heading (when the surrounding layout already labels it). */
  embedded?: boolean
  /** This task is at the deepest allowed level (3rd) — subtasks can't be added under it. */
  atMaxDepth?: boolean
  /**
   * Görev penceresinin aksiyon listesi (#7c54fb70): bölüm boşken başlıktaki ✕
   * onu yeniden gizler. Verilmezse ✕ yok.
   */
  onHide?: () => void
  /** Aksiyon listesinden açıldı: ekleme kutusuna (alt görevler) ya da bağlama çubuğuna (bağlı görevler) odaklan. */
  autoFocus?: boolean
}

/**
 * The link kinds, in the order they are offered. Keys rather than words: the
 * label table in `types` is built at import time and would freeze the language,
 * so the wording is looked up at the point of use. (That table is still what
 * `LinkTicketPicker` reads, and it is the same order.)
 */
/** The outgoing wording of each link kind, from the shared table in types. */
const LINK_KIND_KEYS = Object.fromEntries(
  (Object.entries(LINK_KIND_LABELS) as [LinkKind, { out: TranslationKey }][]).map(([k, v]) => [k, v.out]),
) as Record<LinkKind, TranslationKey>


// ─── Row ─────────────────────────────────────────────────────────────────────
function ChildRow({ t, statuses, teamId, canEdit, canDelete, onOpen, onStatus, onRename, onDelete, onDetach }: {
  t: Ticket; statuses: TicketStatus[]; teamId: string | null; canEdit: boolean; canDelete: boolean
  onOpen: () => void; onStatus: (s: TicketStatus, origin?: Element | null) => void; onRename: (title: string) => void; onDelete: () => void; onDetach: () => void
}) {
  // `t` is the ticket here, so the translator is `tr`.
  const tr = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: !canEdit })
  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(t.title)
  const [confirming, setConfirming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!editing) setTitle(t.title) }, [t.title, editing])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const complete = isCompleteStatus(t.status_info)
  const overdue = isOverdue(t.due_date, new Date(), complete)
  const kids = t.children ?? []
  const kidsDone = kids.filter((k) => isCompleteStatus(k.status_info)).length
  const blocked = kids.filter((k) => k.status_info?.category === 'blocked').length
  const attachments = t.attachments?.length ?? 0
  const comments = t.comments?.[0]?.count ?? 0
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  const commit = () => {
    setEditing(false)
    const next = title.trim()
    if (next && next !== t.title) onRename(next); else setTitle(t.title)
  }

  return (
    <li
      ref={setNodeRef}
      data-ticket-id={t.id}
      style={style}
      role="button"
      tabIndex={0}
      onClick={() => { if (!editing && !confirming) onOpen() }}
      onKeyDown={(e) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen() } }}
      className={`relative flex items-center gap-2.5 group rounded-lg -mx-2 px-2 py-1.5 cursor-pointer hover:bg-raised/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${isDragging ? 'bg-surface shadow-lg ring-1 ring-primary-300 z-10' : ''} ${t.status_info?.category === 'blocked' ? 'ring-1 ring-inset ring-warning/40' : ''}`}
    >
      {canEdit && (
        <span {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} title={tr('ticket.subtask.reorder')} aria-label={tr('ticket.subtask.reorderAria')}
          className="absolute -left-3 top-1/2 -translate-y-1/2 w-4 h-6 flex items-center justify-center text-fg-faint cursor-move opacity-0 group-hover:opacity-100 transition-opacity select-none text-sm leading-none">⠿</span>
      )}

      {/* Status indicator → picker */}
      <button
        type="button"
        disabled={!canEdit}
        onClick={(e) => { e.stopPropagation(); setStatusAnchor(statusAnchor ? null : e.currentTarget) }}
        onPointerDown={(e) => e.stopPropagation()}
        title={t.status_info ? tr('ticket.statusNamed', { name: t.status_info.name }) : tr('ticket.prop.status')}
        className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-raised flex-shrink-0 disabled:cursor-default"
      >
        <StatusIndicator status={t.status_info} size={16} />
      </button>
      {statusAnchor && <StatusPicker statuses={statuses} value={t.status_id} onChange={(s) => onStatus(s, statusAnchor)} anchor={statusAnchor} onClose={() => setStatusAnchor(null)} />}

      {/* Title */}
      {editing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setTitle(t.title) } }}
          className="flex-1 min-w-0 text-sm bg-field border border-primary-500 rounded-md px-1.5 py-0.5 outline-none text-fg"
        />
      ) : (
        <span
          className={`flex-1 min-w-0 text-sm break-words ${complete ? 'text-fg-muted' : 'text-fg'}`}
          onDoubleClick={(e) => { if (canEdit) { e.stopPropagation(); setEditing(true) } }}
          title={canEdit ? tr('ticket.subtask.openHint') : undefined}
        >
          {t.title}
          <span className="ml-1.5 font-mono text-2xs text-fg-faint tabular-nums">#{t.id.slice(0, 6).toUpperCase()}</span>
        </span>
      )}

      {/* Meta */}
      <span className="flex items-center gap-2 text-xs text-fg-faint flex-shrink-0">
        {kids.length > 0 && (
          <span className={`tabular-nums ${kidsDone === kids.length ? 'text-success' : ''}`} title={tr('ticket.subtasks')}>{kidsDone}/{kids.length}</span>
        )}
        {blocked > 0 && <span className="text-warning font-medium" title={tr('ticket.subtask.blocked')}>⏸ {blocked}</span>}
        {attachments > 0 && <span title={tr('ticket.files')}>📎{attachments}</span>}
        {comments > 0 && <span title={tr('ticket.comments')}>💬{comments}</span>}
        {t.due_date && (
          <span className={overdue ? 'text-danger font-medium' : ''}>{displayDate(t.due_date)}</span>
        )}
      </span>
      <PriorityFlagBadge priority={t.priority} size="sm" />
      <AssigneeStack ticketId={t.id} assignees={(t.assignees ?? []).map((a) => a.user)} teamId={teamId} canEdit={canEdit} max={2} />

      {/* Row actions */}
      {canEdit && (
        <span className={`flex items-center gap-0.5 flex-shrink-0 ${confirming ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'} transition-opacity`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {confirming ? (
            <>
              <button onClick={onDelete} className="text-2xs px-2 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold">{tr('common.delete')}</button>
              <button onClick={() => setConfirming(false)} className="text-xs px-1.5 py-1 rounded-md text-fg-2 hover:bg-raised">{tr('common.giveUp')}</button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} title={tr('common.rename')} className="w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-fg-2 hover:bg-raised">
                <Icon name="edit" />
              </button>
              <button onClick={onDetach} title={tr('ticket.subtask.detach')} className="w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-fg-2 hover:bg-raised">
                <Icon name="open" />
              </button>
              {canDelete && (
                <button onClick={() => setConfirming(true)} title={tr('common.delete')} className="w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-danger hover:bg-raised">
                  <Icon name="close" />
                </button>
              )}
            </>
          )}
        </span>
      )}
    </li>
  )
}

// ─── List ────────────────────────────────────────────────────────────────────
export function ChildTicketList({ parent, statuses, teamId, canEdit, canDelete, section = 'both', embedded = false, atMaxDepth = false, onHide, autoFocus = false }: Props) {
  // `t` is a ticket in the callbacks below, so the translator is `tr`.
  const tr = useT()
  const navigate = useNavigate()
  // Pencere içi geçiş (#e2670088): geçmişe yeni kayıt eklemez, izi tutar.
  const goTicket = (id: string) => openTicket(navigate, id)
  const { data: children = [] } = useChildTickets(parent.id)
  const { data: links = [] } = useTicketLinks(parent.id)
  const { data: incoming = [] } = useIncomingLinks(parent.id)
  const setLinkKind = useSetLinkKind()
  const flipLink = useFlipLink()
  const createChild = useCreateChild()
  const reorder = useReorderChildren()
  const setParent = useSetParent()
  const updateTicket = useUpdateTicket()
  const deleteTicket = useDeleteTicket()
  const removeLink = useRemoveLink()

  const [newTitle, setNewTitle] = useState('')
  const ticketPrefs = usePrefs(`ticket:${parent.id}`)
  const hideDone = (ticketPrefs.prefs as { hideDone?: boolean }).hideDone === true
  const setHideDone = (v: boolean) => ticketPrefs.patch({ v: 1, hideDone: v ? true : null })
  const addInputRef = useRef<HTMLInputElement>(null)
  // Aksiyon listesinden gelindi: "Alt görev ekle" kutuya odaklanır (bağlama
  // çubuğu kendi odağını alır). Yalnız bölüm ilk kez görünürken.
  useEffect(() => { if (autoFocus && section !== 'links') addInputRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const total = children.length
  const done = children.filter((c) => isCompleteStatus(c.status_info)).length
  const blocked = children.filter((c) => c.status_info?.category === 'blocked').length
  const listed = hideDone ? children.filter((c) => !isCompleteStatus(c.status_info)) : children

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = children.findIndex((c) => c.id === active.id)
    const to = children.findIndex((c) => c.id === over.id)
    if (from < 0 || to < 0) return
    reorder.mutate({ parentId: parent.id, ordered: arrayMove(children, from, to) })
  }

  const handleAdd = async () => {
    const title = newTitle.trim()
    if (!title) return
    setNewTitle('')
    await createChild.mutateAsync({ parent, title })
    addInputRef.current?.focus()
  }
  const onAddKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
    if (e.key === 'Escape') {
      // Boş kutuda Esc, boş bölümü de kapatır (✕ ile aynı: vazgeçtim).
      if (!newTitle && total === 0 && onHide) { onHide(); return }
      setNewTitle(''); addInputRef.current?.blur()
    }
  }

  const setStatus = (t: Ticket, s: TicketStatus, origin?: Element | null) => {
    updateTicket.mutate({ id: t.id, input: { status_id: s.id, status: s.name } })
    if (isCompleteStatus(s) && !isCompleteStatus(t.status_info)) celebrateTicket(t.id, s.color, origin)
  }

  return (
    <div>
      {section !== 'links' && (
      <>
      {(!embedded || blocked > 0 || total > 0) && (
        <div className="group/sec flex items-center justify-between mb-1.5 min-h-[1.25rem]">
          <div className="flex items-center gap-2">
            {embedded ? (
              total > 0 && <span className="text-2xs font-medium text-fg-muted tabular-nums">{tr('ticket.subtask.doneCount', { done, total })}</span>
            ) : (
              <h4 className="text-xs font-semibold text-fg-faint uppercase tracking-wider">
                {tr('ticket.subtasks')} {total > 0 && <span className="font-normal normal-case">{done}/{total}</span>}
              </h4>
            )}
            {blocked > 0 && <span className="text-2xs font-semibold text-warning bg-warning/10 px-1.5 py-0.5 rounded-md">⏸ {tr('ticket.subtask.blockedCount', { n: blocked })}</span>}
          </div>
          {total > 0 && (
            <button onClick={() => setHideDone(!hideDone)} className="text-xs text-fg-faint hover:text-fg-2">
              {hideDone ? tr('ticket.subtask.showDone') : tr('ticket.subtask.hideDone')}
            </button>
          )}
          {total === 0 && onHide && <SectionHide name={tr('ticket.subtasks')} onHide={onHide} />}
        </div>
      )}
      {total > 0 && (
        <div className="h-1 rounded-full bg-line overflow-hidden mb-2">
          <div className={`h-full rounded-full transition-all ${done === total ? 'bg-success' : 'bg-primary-500'}`} style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={listed.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-line-soft">
            {listed.map((t) => (
              <ChildRow
                key={t.id}
                t={t}
                statuses={statuses}
                teamId={teamId}
                canEdit={canEdit}
                canDelete={canDelete(t.created_by)}
                onOpen={() => goTicket(t.id)}
                onStatus={(s, origin) => setStatus(t, s, origin)}
                onRename={(title) => updateTicket.mutate({ id: t.id, input: { title } })}
                onDelete={() => deleteTicket.mutate(t.id)}
                onDetach={() => setParent.mutate({ id: t.id, parentId: null, previousParentId: parent.id })}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {hideDone && listed.length === 0 && total > 0 && <p className="text-xs text-fg-faint py-2">{tr('ticket.subtask.allDoneHidden')}</p>}

      {/* Add row — hidden at the deepest level, where a subtask can't be created */}
      {canEdit && (atMaxDepth ? (
        total === 0 ? (
          <p className={`text-xs text-fg-faint ${total > 0 ? 'mt-1.5' : ''}`}>{tr('ticket.subtask.maxDepth')}</p>
        ) : null
      ) : (
        <div className={`flex items-center gap-2 ${total > 0 ? 'mt-1.5' : ''}`}>
          <span className="w-6 h-6 flex items-center justify-center text-fg-faint" aria-hidden>
            <Icon name="plus" />
          </span>
          <input
            ref={addInputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={onAddKey}
            placeholder={tr('ticket.subtask.addPlaceholder')}
            aria-label={tr('ticket.subtask.addAria')}
            className="flex-1 min-w-0 text-sm py-1.5 px-1 rounded-md bg-transparent border border-transparent text-fg-2 placeholder-fg-faint focus:outline-none focus:bg-field focus:border-line focus:px-2.5 transition-all"
          />
          {newTitle.trim() && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleAdd} disabled={createChild.isPending}
              className="text-xs bg-primary-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-primary-700 disabled:opacity-50 flex-shrink-0">{tr('common.add')}</button>
          )}
        </div>
      ))}
      </>
      )}
      {section !== 'subtasks' && (
      <>
      {/* Linked tickets, grouped by how they relate to this one (both directions).
          Görev penceresinde bölüm boşken gizli; aksiyon listesindeki "Görev bağla"
          onu açar (#7c54fb70). Boş hâlin açıklama cümlesi tanıtım turunda. */}
      {(() => {
        type Row = { link: TicketLink; other: NonNullable<TicketLink['linked']>; dir: 'out' | 'in' }
        const rows: Row[] = [
          ...links.filter((l) => l.linked).map((l) => ({ link: l, other: l.linked!, dir: 'out' as const })),
          ...incoming.filter((l) => l.source).map((l) => ({ link: l, other: l.source!, dir: 'in' as const })),
        ]
        const groups: { key: string; title: string; hint?: string; items: Row[]; danger?: boolean }[] = []
        const push = (key: string, title: string, items: Row[], danger = false) => { if (items.length) groups.push({ key, title, items, danger }) }
        push('blocked_by', tr('ticket.link.blockedBy'), rows.filter((r) => r.link.kind === 'blocks' && r.dir === 'in'), true)
        push('blocks', tr('ticket.link.blocks'), rows.filter((r) => r.link.kind === 'blocks' && r.dir === 'out'))
        push('waits_for', tr('ticket.link.waitsFor'), rows.filter((r) => r.link.kind === 'waits_for' && r.dir === 'out'))
        push('waited_by', tr('ticket.link.waitedBy'), rows.filter((r) => r.link.kind === 'waits_for' && r.dir === 'in'))
        push('relates', tr('ticket.link.relates'), rows.filter((r) => r.link.kind === 'relates'))
        push('duplicates', tr('ticket.link.duplicates'), rows.filter((r) => r.link.kind === 'duplicates'))
        const status = (o: Row['other']) => (o.status_info ? { name: o.status_info.name, color: o.status_info.color, category: o.status_info.category ?? 'active', is_cancelled: !!o.status_info.is_cancelled } : null)
        const done = (o: Row['other']) => isCompleteStatus(status(o))
        return (
          <div className={`${section === 'both' ? 'mt-4' : ''} space-y-3`} data-linked-section>
            {!embedded && (
              <div className="group/sec flex items-center justify-between gap-2 min-h-[1.25rem]">
                <h4 className="text-xs font-semibold text-fg-faint uppercase tracking-wider">{tr('ticket.links')} {rows.length > 0 && <span className="font-normal normal-case">{rows.length}</span>}</h4>
                {rows.length === 0 && onHide && <SectionHide name={tr('ticket.links')} onHide={onHide} />}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.key}>
                <p className={`text-xs font-medium mb-0.5 ${g.danger && g.items.some((r) => !done(r.other)) ? 'text-danger' : 'text-fg-muted'}`}>{g.title} <span className="text-fg-faint font-normal">{g.items.length}</span></p>
                <ul className="divide-y divide-line-soft">
                  {g.items.map(({ link: l, other: o, dir }) => (
                    <li key={l.id} role="button" tabIndex={0} onClick={() => goTicket(o.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') goTicket(o.id) }}
                      className={`group flex items-center gap-2.5 rounded-lg -mx-2 px-2 py-1.5 cursor-pointer hover:bg-raised/60 ${g.key === 'blocked_by' && done(o) ? 'opacity-60' : ''}`}>
                      <StatusIndicator status={status(o)} size={14} />
                      <span className="flex-1 min-w-0 text-sm text-fg break-words">
                        {o.title}
                        <span className="ml-1.5 font-mono text-2xs text-fg-faint tabular-nums">#{o.id.slice(0, 6).toUpperCase()}</span>
                      </span>
                      {o.status_info && (
                        <span className="chip-dyn border text-2xs px-1.5 py-0.5 rounded-md font-medium flex-shrink-0" style={{ '--c': o.status_info.color } as React.CSSProperties}>{o.status_info.name}</span>
                      )}
                      {canEdit && dir === 'out' && (
                        // The kind lives on the row; only the side that owns the row can change it.
                        <select
                          value={l.kind}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { e.stopPropagation(); setLinkKind.mutate({ id: l.id, kind: e.target.value as LinkKind, ticketId: parent.id, linkedTicketId: o.id }) }}
                          title={tr('ticket.link.kindTitle')}
                          aria-label={tr('ticket.link.kindTitle')}
                          className="text-2xs bg-field border border-line rounded-md px-1 py-0.5 text-fg-2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          {(Object.keys(LINK_KIND_KEYS) as LinkKind[]).map((k) => <option key={k} value={k}>{tr(LINK_KIND_KEYS[k])}</option>)}
                        </select>
                      )}
                      {canEdit && (l.kind === 'blocks' || l.kind === 'waits_for') && (
                        // Directional kinds can be turned around from either side; the row then belongs to this ticket.
                        <button onClick={(e) => { e.stopPropagation(); flipLink.mutate({ id: l.id, ticketId: l.ticket_id, linkedTicketId: l.linked_ticket_id }) }} disabled={flipLink.isPending} title={tr('ticket.link.flipHint')} aria-label={tr('ticket.link.flip')} data-link-flip={l.id}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 disabled:opacity-40">
                          <Icon name="sort" />
                        </button>
                      )}
                      {canEdit && dir === 'out' && (
                        <button onClick={(e) => { e.stopPropagation(); removeLink.mutate({ id: l.id, ticketId: parent.id, linkedTicketId: o.id }) }} title={tr('ticket.link.remove')} aria-label={tr('ticket.link.remove')}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-danger hover:bg-raised opacity-0 group-hover:opacity-100">
                          <Icon name="close" />
                        </button>
                      )}
                      {dir === 'in' && <span className="text-2xs text-fg-faint flex-shrink-0" title={tr('ticket.link.incoming')}>↤</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {/* Ekleme çubuğu, alt görev ve yapılacaklar kutusu gibi satır boyunca (#31b09040). */}
            {canEdit && teamId && parent.project_id && (
              <LinkTicketBar
                ticketId={parent.id}
                projectId={parent.project_id}
                teamId={teamId}
                exclude={[parent.id, ...links.map((l) => l.linked_ticket_id), ...children.map((c) => c.id)]}
                autoFocus={autoFocus}
                onGiveUp={rows.length === 0 ? onHide : undefined}
              />
            )}
          </div>
        )
      })()}
      </>
      )}
    </div>
  )
}
