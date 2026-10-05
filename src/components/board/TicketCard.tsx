import { useState } from 'react'
import { AgentWorkBadge } from '../agents/AgentWorkBadge'
import { Icon } from '../ui/Icon'
import { isOverdue as isOverdueDate } from '../../lib/due'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import { openTicket } from '../../lib/nav'
import type { Ticket } from '../../types'
import { PriorityFlagBadge } from '../ticket/PriorityPicker'
import { ContextMenu } from './ContextMenu'
import { useDeleteTicket, useCopyTicket, useMoveTicket } from '../../hooks/useTickets'
import { MoveToListDialog } from '../ticket/MoveToListDialog'
import { CopyId } from '../ui/CopyId'
import { ShareLinkButton } from '../ui/ShareLinkButton'
import { copyTicketLink } from '../../lib/shareLink'
import { useIsFavorite, useToggleFavorite } from '../../lib/favorites'
import { AssigneeStack } from '../ticket/AssigneeStack'
import { isCompleteStatus, openBlockers } from '../../types'
import { useT } from '../../i18n'
import { displayDate, useDateFormat } from '../../lib/time'
import { thumbUrl } from '../../lib/image'
import { checklistProgress } from '../../lib/checklist'
import { CardChecklist } from './CardChecklist'

interface Props {
  ticket: Ticket
  /** On its way off the board after its celebration: fade, do not vanish (#6228C4EB). */
  leaving?: boolean
  onArchive?: (id: string, archived: boolean) => void
  canDelete?: boolean
  canDrag?: boolean
  teamId?: string | null
  canAssign?: boolean
}

export function TicketCard({ ticket, onArchive, canDelete = true, canDrag = true, teamId = null, canAssign = false, leaving = false }: Props) {
  const t = useT()
  useDateFormat()   // repaint when the date format changes
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ticket.id, disabled: !canDrag })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteTicket = useDeleteTicket()
  const isFav = useIsFavorite('ticket', ticket.id)
  const toggleFav = useToggleFavorite()
  const copyTicket = useCopyTicket()
  const moveTicket = useMoveTicket()
  const [moveOpen, setMoveOpen] = useState(false)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return
    e.stopPropagation()
    openTicket(navigate, ticket.id)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  // Bitmiş görev gecikmiş sayılmaz; kıyas günün başına göre (src/lib/due.ts).
  const isOverdue = isOverdueDate(ticket.due_date, new Date(), isCompleteStatus(ticket.status_info))
  const assignees = ticket.assignees ?? []
  const tags = ticket.tags ?? []

  // Card indicators — shown only when there is something to show
  const subtasks = ticket.children ?? []
  const subDone = subtasks.filter(s => isCompleteStatus(s.status_info)).length
  const subBlocked = subtasks.filter(s => s.status_info?.category === 'blocked').length
  const blockedBy = openBlockers(ticket).length
  const attachments = ticket.attachments ?? []
  const imageCount = attachments.filter(a => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(a.file_url)).length
  const commentCount = ticket.comments?.[0]?.count ?? 0
  // `has_description` is a generated column (063): the list query no longer
  // downloads the text just to draw a dot.
  const hasDescription = ticket.has_description ?? !!ticket.description?.trim()
  // Yapılacaklar (#7c54fb70): alt görevler gibi kendi sayacı ve çubuğu.
  const checklist = checklistProgress(ticket.checklist)
  const hasMeta = subtasks.length > 0 || checklist.total > 0 || attachments.length > 0 || commentCount > 0 || hasDescription || blockedBy > 0 || !!ticket.parent_id


  // Built conditionally rather than filtered afterwards: the old filter matched
  // on the Turkish label, which a translated label would silently break.
  const contextItems: { label: string; danger?: boolean; icon: React.ReactNode; onClick: () => void }[] = [
    {
      label: t('common.open'),
      icon: (
        <Icon name="open" />
      ),
      onClick: () => openTicket(navigate, ticket.id),
    },
    {
      label: t('common.copyLink'),
      icon: (
        <Icon name="link" />
      ),
      onClick: () => { void copyTicketLink(ticket.id, ticket.title) },
    },
    {
      label: isFav ? t('board.fav.remove') : t('board.fav.add'),
      icon: (
        <Icon name="star" />
      ),
      onClick: () => toggleFav('ticket', ticket.id),
    },
    ...(canDrag ? [{
      label: t('board.card.copy'),
      icon: (
        <Icon name="copy" />
      ),
      onClick: () => copyTicket.mutate({ ticketId: ticket.id }),
    }, {
      label: t('board.card.move'),
      icon: (
        <Icon name="moveTo" />
      ),
      onClick: () => setMoveOpen(true),
    }] : []),
    ...(onArchive ? [{
      label: t('board.card.archive'),
      icon: (
        <Icon name="archive" />
      ),
      onClick: () => onArchive(ticket.id, true),
    }] : []),
    ...(canDelete ? [{
      label: t('common.delete'),
      danger: true,
      icon: (
        <Icon name="trash" />
      ),
      onClick: () => setConfirmingDelete(true), // inline confirmation on the card, no window.confirm()
    }] : []),
  ]

  const moveDialog = moveOpen ? (
    <MoveToListDialog teamId={teamId} currentProjectId={ticket.project_id ?? null} busy={moveTicket.isPending}
      onPick={(p) => moveTicket.mutate({ ticketId: ticket.id, projectId: p.id }, { onSettled: () => setMoveOpen(false) })}
      onClose={() => setMoveOpen(false)} />
  ) : null

  return (
    <>
      {moveDialog}
      <div
        ref={setNodeRef}
        data-ticket-id={ticket.id}
        data-board-card
        style={style}
        {...attributes}
        {...listeners}
        aria-label={`${ticket.title}${ticket.status_info?.name ? ` · ${ticket.status_info.name}` : ''}`}
        onClick={handleClick}
        // Enter opens the ticket; Space (the sensor's own key) picks it up to move.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isDragging) { e.preventDefault(); e.stopPropagation(); openTicket(navigate, ticket.id); return }
          listeners?.onKeyDown?.(e)
        }}
        onContextMenu={handleContextMenu}
        className={`
          group relative bg-surface rounded-xl border border-line
          p-3.5 cursor-pointer select-none transition-all duration-150
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1
          hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-card-hover
          ${isDragging ? 'shadow-lg ring-2 ring-primary-400 ring-offset-1' : 'shadow-sm'}
          ${leaving ? 'animate-fade-out pointer-events-none' : ''}
        `}
      >
        {/* Inline delete confirmation (replaces window.confirm) */}
        {confirmingDelete && (
          <div
            className="absolute inset-0 z-10 rounded-xl bg-surface/95 flex flex-col items-center justify-center gap-2 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="text-xs font-medium text-fg-2">{t('board.card.confirmDelete')}</span>
            <span className="flex gap-2">
              <button
                onClick={() => deleteTicket.mutate(ticket.id)}
                disabled={deleteTicket.isPending}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {t('board.card.confirmDeleteYes')}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-xs px-3 py-1.5 rounded-lg text-fg-2 hover:bg-raised"
              >
                {t('common.giveUp')}
              </button>
            </span>
          </div>
        )}

        {/* Optional cover image (061): one of the task's own attachments, chosen
            from the file menu. Bleeds to the card edges above the title —
            max-w-none because preflight's `img { max-width: 100% }` would clamp
            the bleed back to the padding box and leave a gap on the right. */}
        {ticket.cover_url && (
          <img
            // A card cover is 96 px tall in a ~285 px card; the stored original
            // can be megabytes. Falls back to it if the transform is missing.
            src={thumbUrl(ticket.cover_url, 600)}
            onError={(e) => { const img = e.currentTarget; if (img.src !== ticket.cover_url) img.src = ticket.cover_url! }}
            alt=""
            loading="lazy"
            draggable={false}
            data-card-cover
            className="-mt-3.5 -mx-3.5 mb-2.5 w-[calc(100%+1.75rem)] max-w-none h-24 object-cover rounded-t-xl bg-raised"
          />
        )}

        {/* Top row: title + short ID */}
        <div className="flex items-start justify-between gap-2 mb-2.5">
          {/* Henüz kimseye atanmamış görev bir ton soluk (#41cb2a2a): gözle
              hızlı ayırt edilsin, ama okunaklılık için yalnız başlığın tonu
              düşüyor — durum, öncelik ve tarih renkleri olduğu gibi kalıyor. */}
          <p className={`text-[13px] font-medium leading-snug line-clamp-2 flex-1 ${
            !ticket.title.trim() ? 'text-fg-faint italic' : assignees.length === 0 ? 'text-fg-muted' : 'text-fg'}`}>
            {ticket.title.trim() || t('common.unnamedTask')}
          </p>
          <span className="flex items-start flex-shrink-0">
            <ShareLinkButton
              id={ticket.id}
              title={ticket.title}
              className="mt-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
            />
            <CopyId id={ticket.id} className="mt-0.5 -mr-1" />
          </span>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2.5">
            {tags.slice(0, 3).map(({ tag }) => (
              <span
                key={tag.id}
                className="chip-dyn border text-2xs px-1.5 py-0.5 rounded-full font-medium leading-tight"
                style={{ '--c': tag.color } as React.CSSProperties}
              >
                {tag.name}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-2xs px-1.5 py-0.5 rounded-full bg-raised text-fg-faint font-medium leading-tight">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}

        <CardChecklist ticket={ticket} canEdit={canDrag} />

        {/* An agent is on this task now: who, and at which step (phase 5). One query per team, shared by every card. */}
        <AgentWorkBadge ticketId={ticket.id} teamId={teamId} className="mb-2" />

        {/* Indicators: subtasks / to-dos / description / attachments / comments */}
        {hasMeta && (
          <div className="flex items-center gap-3 mb-2.5 text-xs text-fg-faint">
            {/* This card is itself a subtask — say so, it is otherwise invisible
                on the board (subtasks only show with "Alt görevleri de göster").
                The glyph carries it alone: the word cost a third of the meta row
                on every subtask card, and the other indicators here are already
                read as icons. The label stays in the tooltip and for screen
                readers, so nothing is lost that was not decoration. */}
            {ticket.parent_id && (
              <span title={t('board.card.isSubtask')} className="flex items-center text-fg-faint" role="img" aria-label={t('board.card.subtask')}>
                <Icon name="subtask" />
              </span>
            )}
            {subtasks.length > 0 && (
              <span
                title={t('board.card.subtasks', { done: subDone, total: subtasks.length })}
                className={`flex items-center gap-1 tabular-nums ${subDone === subtasks.length ? 'text-success' : ''}`}
              >
                <Icon name="ticket" />
                {subDone}/{subtasks.length}
                <span className="w-8 h-1 rounded-full bg-line overflow-hidden" aria-hidden>
                  <span
                    className={`block h-full rounded-full ${subDone === subtasks.length ? 'bg-success' : 'bg-primary-500'}`}
                    style={{ width: `${(subDone / subtasks.length) * 100}%` }}
                  />
                </span>
                {subBlocked > 0 && <span className="text-warning font-semibold" title={t('board.card.blockedSubtasks', { n: subBlocked })}>⏸{subBlocked}</span>}
              </span>
            )}
            {checklist.total > 0 && (
              <span
                title={t('board.card.checklist', { done: checklist.done, total: checklist.total, pct: checklist.pct })}
                data-card-checklist-count
                className={`flex items-center gap-1 tabular-nums ${checklist.done === checklist.total ? 'text-success' : ''}`}
              >
                <Icon name="checklist" />
                {checklist.done}/{checklist.total}
                <span className="w-8 h-1 rounded-full bg-line overflow-hidden" aria-hidden>
                  <span className={`block h-full rounded-full ${checklist.done === checklist.total ? 'bg-success' : 'bg-primary-500'}`} style={{ width: `${checklist.pct}%` }} />
                </span>
              </span>
            )}
            {blockedBy > 0 && (
              <span className="text-danger font-semibold" title={t('board.card.blockedBy', { n: blockedBy })}>⛔{blockedBy}</span>
            )}
            {hasDescription && (
              <span title={t('board.card.hasDescription')} className="flex items-center">
                <Icon name="text" />
              </span>
            )}
            {attachments.length > 0 && (
              <span title={imageCount > 0 ? t('board.card.imagesAndFiles', { images: imageCount, files: attachments.length }) : t('board.card.files', { n: attachments.length })} className="flex items-center gap-1 tabular-nums">
                {imageCount > 0 ? (
                  <Icon name="image" />
                ) : (
                  <Icon name="attach" />
                )}
                {attachments.length}
              </span>
            )}
            {commentCount > 0 && (
              <span title={t('board.card.comments', { n: commentCount })} className="flex items-center gap-1 tabular-nums">
                <Icon name="comment" />
                {commentCount}
              </span>
            )}
          </div>
        )}

        {/* Bottom row: priority + due date (left), assignees (right) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <PriorityFlagBadge priority={ticket.priority} size="sm" />
            {ticket.due_date && (
              <span
                className={`text-xs font-medium flex-shrink-0 flex items-center gap-0.5 ${isOverdue ? 'text-danger' : 'text-fg-faint'}`}
              >
                {isOverdue && (
                  <Icon name="warning" size={12} />
                )}
                {displayDate(ticket.due_date!)}
              </span>
            )}
          </div>

          <AssigneeStack
            ticketId={ticket.id}
            assignees={assignees.map((a) => a.user)}
            teamId={teamId}
            canEdit={canAssign}
          />
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          items={contextItems}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
