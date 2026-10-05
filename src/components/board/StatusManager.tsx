import { useState } from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStatuses, useCreateStatus, useUpdateStatus, useDeleteStatus, useReorderStatuses, useStatusTicketCounts } from '../../hooks/useStatuses'
import type { TicketStatus, StatusCategory } from '../../types'
import { STATUS_CATEGORY_LABELS, STATUS_CATEGORY_HINTS, STATUS_CATEGORY_ORDER } from '../../types'
import { isCategorySorted, sortByCategory } from '../../lib/statusOrder'
import { StatusIndicator } from '../ticket/StatusIndicator'
import { TeamHexPicker } from '../ui/ColorPalettePicker'
import { useProjectRole } from '../../hooks/useTeams'
import { useT } from '../../i18n'

// Status colours come from the team palette (see TeamHexPicker) — the same
// named colours lists, folders and tags use, instead of a private preset list.
const DEFAULT_STATUS_HEX = '#6b7280'

export function CategorySelect({ value, cancelled, onChange }: { value: StatusCategory; cancelled: boolean; onChange: (c: StatusCategory, cancelled: boolean) => void }) {
  const t = useT()
  const v = value === 'closed' && cancelled ? 'cancelled' : value
  return (
    <select
      value={v}
      onChange={(e) => { const x = e.target.value; x === 'cancelled' ? onChange('closed', true) : onChange(x as StatusCategory, false) }}
      title={t(STATUS_CATEGORY_HINTS[value])}
      className="text-2xs bg-field border border-line rounded-md px-1.5 py-0.5 text-fg-2 outline-none focus:ring-1 focus:ring-primary-500"
    >
      {STATUS_CATEGORY_ORDER.map((c) => <option key={c} value={c}>{t(STATUS_CATEGORY_LABELS[c])}</option>)}
      <option value="cancelled">{t('board.status.cancelledOption')}</option>
    </select>
  )
}

function SortableStatusRow({ status, statuses, ticketCount, onUpdate, onDelete, teamId, canCreateColor }: {
  status: TicketStatus
  statuses: TicketStatus[]
  teamId: string | null
  canCreateColor: boolean
  /** Tickets currently in this status — 0 means nothing has to be moved anywhere. */
  ticketCount: number
  onUpdate: (patch: { name?: string; color?: string; category?: StatusCategory; isCancelled?: boolean }) => void
  onDelete: (moveTo: string | null) => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(status.name)
  const [showColors, setShowColors] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [moveTo, setMoveTo] = useState<string>('')
  const others = statuses.filter((s) => s.id !== status.id)
  const lastClosed = status.category === 'closed' && statuses.filter((s) => s.category === 'closed').length === 1
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style} className="group">
      <div className="flex items-center gap-2 py-1.5 px-1 rounded-lg hover:bg-raised">
        <span {...attributes} {...listeners} className="cursor-move text-fg-faint text-sm select-none" title={t('board.status.reorder')}>⠿</span>
        <div className="relative">
          <button onClick={() => setShowColors(!showColors)} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-line/60" title={t('board.status.color')}>
            <StatusIndicator status={status} size={16} />
          </button>
          {showColors && (
            <div className="absolute left-0 top-7 z-30 bg-surface border border-line rounded-xl shadow-lg p-3 w-64">
              <p className="text-xs text-fg-muted mb-2 font-medium">{t('board.status.palette')}</p>
              <TeamHexPicker teamId={teamId} canCreate={canCreateColor} value={status.color} onChange={(c) => { onUpdate({ color: c }); setShowColors(false) }} />
            </div>
          )}
        </div>
        {editing ? (
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name.trim() && name !== status.name) onUpdate({ name: name.trim() }) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setEditing(false); if (name.trim() && name !== status.name) onUpdate({ name: name.trim() }) } if (e.key === 'Escape') { setEditing(false); setName(status.name) } }}
            className="flex-1 text-sm border border-primary-400 bg-field text-fg rounded-md px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary-500" />
        ) : (
          <span className="flex-1 text-sm text-fg-2 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 truncate" onClick={() => setEditing(true)}>{status.name}</span>
        )}
        <CategorySelect value={status.category} cancelled={status.is_cancelled} onChange={(category, isCancelled) => onUpdate({ category, isCancelled })} />
        {lastClosed ? (
          <span className="text-2xs text-fg-faint w-4 text-center" title={t('board.status.locked')}>🔒</span>
        ) : confirming ? null : (
          <button onClick={() => setConfirming(true)} title={t('board.status.delete')} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-fg-faint hover:text-red-500 text-xs">✕</button>
        )}
      </div>
      {confirming && (
        <div className="ml-8 mb-2 p-2 rounded-lg bg-raised text-xs space-y-1.5">
          {ticketCount === 0 ? (
            /* Nothing to move: asking where to put zero tickets is just a hurdle. */
            <>
              <p className="text-fg-2">{t('board.status.confirmEmpty', { name: status.name })}</p>
              <div className="flex gap-1.5">
                <button onClick={() => { onDelete(null); setConfirming(false) }} className="px-2 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold">{t('common.delete')}</button>
                <button onClick={() => setConfirming(false)} className="px-2 py-1 rounded-md text-fg-2 hover:bg-line/60">{t('common.giveUp')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-fg-2">{t('board.status.moveWhere', { n: ticketCount })}</p>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="w-full text-xs bg-field border border-line rounded-md px-1.5 py-1 text-fg">
                <option value="">{t('board.status.choose')}</option>
                {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="flex gap-1.5">
                <button disabled={!moveTo} onClick={() => { onDelete(moveTo); setConfirming(false) }} className="px-2 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50">{t('board.status.moveAndDelete')}</button>
                <button onClick={() => setConfirming(false)} className="px-2 py-1 rounded-md text-fg-2 hover:bg-line/60">{t('common.giveUp')}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface Props { projectId: string }

export function StatusManager({ projectId }: Props) {
  const t = useT()
  const { data: statuses = [] } = useStatuses(projectId)
  const { data: counts = {} } = useStatusTicketCounts(projectId)
  const createStatus = useCreateStatus()
  const updateStatus = useUpdateStatus()
  const deleteStatus = useDeleteStatus()
  const reorderStatuses = useReorderStatuses()

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_STATUS_HEX)
  const { teamId, perms } = useProjectRole(projectId)
  const [newCat, setNewCat] = useState<StatusCategory>('active')
  const [newCancelled, setNewCancelled] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIdx = statuses.findIndex((s) => s.id === active.id)
    const newIdx = statuses.findIndex((s) => s.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    reorderStatuses.mutate(arrayMove(statuses, oldIdx, newIdx).map((s, i) => ({ id: s.id, order_index: i, projectId })))
  }
  const handleAdd = async () => {
    if (!newName.trim()) return
    await createStatus.mutateAsync({ projectId, name: newName.trim(), color: newColor, category: newCat, isCancelled: newCancelled })
    setNewName(''); setNewColor(DEFAULT_STATUS_HEX); setNewCat('active'); setNewCancelled(false); setAdding(false)
  }
  const hasClosed = statuses.some((s) => s.category === 'closed')

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {statuses.map((s) => (
            <SortableStatusRow key={s.id} status={s} statuses={statuses} ticketCount={counts[s.id] ?? 0} teamId={teamId} canCreateColor={perms.canManage}
              onUpdate={(patch) => updateStatus.mutate({ id: s.id, projectId, ...patch })}
              onDelete={(moveTo) => deleteStatus.mutate({ id: s.id, projectId, moveTo })} />
          ))}
        </SortableContext>
      </DndContext>
      {!hasClosed && <p className="text-xs text-warning mt-1 px-1">{t('board.status.noClosed')}</p>}
      {/* Sıra kategorilere uymuyorsa (#bc239e3c) tek tıkla düzeltilir; kendiliğinden değişmez. */}
      {!isCategorySorted(statuses) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-fg-muted" data-testid="status-unsorted">
          <span>{t('board.status.unsorted')}</span>
          <button type="button" disabled={reorderStatuses.isPending}
            onClick={() => reorderStatuses.mutate(sortByCategory(statuses).map((s, i) => ({ id: s.id, order_index: i, projectId })))}
            className="font-medium text-primary-600 dark:text-primary-300 hover:underline disabled:opacity-50">
            {t('board.status.sortByCategory')}
          </button>
        </div>
      )}

      {adding ? (
        <div className="mt-2 space-y-2 border-t border-line-soft pt-2">
          <TeamHexPicker teamId={teamId} canCreate={perms.canManage} value={newColor} onChange={setNewColor} />
          <div className="flex items-center gap-1.5">
            <StatusIndicator status={{ name: newName, color: newColor, category: newCat, is_cancelled: newCancelled }} size={16} />
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder={t('board.status.namePlaceholder')} className="flex-1 text-sm border border-line bg-field text-fg rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            <CategorySelect value={newCat} cancelled={newCancelled} onChange={(c, x) => { setNewCat(c); setNewCancelled(x) }} />
          </div>
          <p className="text-xs text-fg-faint">{t(STATUS_CATEGORY_HINTS[newCat])}</p>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={createStatus.isPending} className="flex-1 text-xs bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 disabled:opacity-50">{t('common.add')}</button>
            <button onClick={() => setAdding(false)} className="text-xs text-fg-faint px-2 py-1.5">{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-fg-faint hover:text-fg-2 flex items-center gap-1 mt-2 px-1"><span>+</span> {t('board.status.add')}</button>
      )}
    </div>
  )
}
