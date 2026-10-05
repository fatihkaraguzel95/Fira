import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Icon } from '../ui/Icon'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ChecklistItem, Ticket } from '../../types'
import { useT } from '../../i18n'
import { useAddChecklistItems, useChecklist, useDeleteChecklistItem, useReorderChecklist, useSetChecklistOnBoard, useUpdateChecklistItem } from '../../hooks/useChecklist'
import { useCreateChild } from '../../hooks/useChildren'
import { CHECKLIST_TITLE_MAX, checklistProgress, parseChecklistPaste } from '../../lib/checklist'
import { MenuIcons, rowMenuSlot, useRowMenu, type RowMenuItem } from '../ui/RowMenu'
import { SectionHide } from './SectionHide'

/**
 * Görevin yapılacaklar listesi (#7c54fb70, ClickUp'taki Checklist): alt görev
 * olacak kadar büyük olmayan işler — bir satır ve bir işaret. Başlıkta
 * tamamlanan/toplam ve yüzde; "Panoda göster" maddeleri pano kartına da koyar.
 * Enter bir madde ekleyip kutuda kalır, birden çok satır yapıştırmak her satırı
 * ayrı madde yapar (ipucu kutuda değil, tanıtım turunda). Madde menüsünde
 * düzenle, alt göreve çevir, sil. Boşken görev penceresinde gizli; aksiyon
 * listesindeki "Yapılacak madde ekle" açar ve kutuya odaklar, ✕ geri gizler.
 */
export function TicketChecklist({ ticket, canEdit, canConvert, onHide, autoFocus = false }: {
  ticket: Ticket; canEdit: boolean; canConvert: boolean; onHide?: () => void; autoFocus?: boolean
}) {
  const t = useT()
  const { data: items = [] } = useChecklist(ticket.id)
  const add = useAddChecklistItems()
  const update = useUpdateChecklistItem()
  const remove = useDeleteChecklistItem()
  const reorder = useReorderChecklist()
  const setOnBoard = useSetChecklistOnBoard()
  const createChild = useCreateChild()
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { done, total, pct } = checklistProgress(items)
  const onBoard = !!ticket.checklist_on_board
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = items.findIndex((i) => i.id === active.id)
    const to = items.findIndex((i) => i.id === over.id)
    if (from < 0 || to < 0) return
    reorder.mutate({ ticketId: ticket.id, ordered: arrayMove(items, from, to) })
  }

  const addDraft = () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    add.mutate({ ticketId: ticket.id, items: [{ title }] })
    inputRef.current?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); addDraft() }
    if (e.key === 'Escape') {
      if (!draft && total === 0 && onHide) { onHide(); return }
      setDraft(''); inputRef.current?.blur()
    }
  }
  // Birden çok satır: her satır bir madde (madde işaretleri ve [x] anlaşılır).
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const lines = parseChecklistPaste(e.clipboardData.getData('text/plain'))
    if (!lines?.length) return
    e.preventDefault()
    add.mutate({ ticketId: ticket.id, items: lines })
  }
  const convert = async (item: ChecklistItem) => {
    await createChild.mutateAsync({ parent: ticket, title: item.title })
    remove.mutate({ ticketId: ticket.id, id: item.id })
  }

  return (
    <div data-ticket-checklist>
      <div className="group/sec flex items-center justify-between gap-2 mb-1.5 min-h-[1.25rem]">
        <h4 className="text-xs font-semibold text-fg-faint uppercase tracking-wider">
          {t('ticket.checklist.title')}{' '}
          {total > 0 && <span className="font-normal normal-case tabular-nums" title={t('ticket.checklist.progressHint', { done, total, pct })}>{done}/{total} · %{pct}</span>}
        </h4>
        {/* Boş listede anlamı yok; açıksa kapatılabilsin diye yine görünür. */}
        {canEdit && (total > 0 || onBoard) && (
          <button type="button" aria-pressed={onBoard} onClick={() => setOnBoard.mutate({ ticketId: ticket.id, on: !onBoard })}
            title={onBoard ? t('ticket.checklist.onBoardOffHint') : t('ticket.checklist.onBoardHint')} data-checklist-onboard
            className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors ${onBoard ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 font-medium' : 'text-fg-faint hover:text-fg-2 hover:bg-raised'}`}>
            <Icon name="checklist" />
            {onBoard ? t('ticket.checklist.onBoardOn') : t('ticket.checklist.onBoard')}
          </button>
        )}
        {total === 0 && onHide && <SectionHide name={t('ticket.checklist.title')} onHide={onHide} />}
      </div>
      {total > 0 && (
        <div className="h-1 rounded-full bg-line overflow-hidden mb-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('ticket.checklist.progressHint', { done, total, pct })}>
          <div className={`h-full rounded-full transition-all ${done === total ? 'bg-success' : 'bg-primary-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} canEdit={canEdit} canConvert={canEdit && canConvert}
                onToggle={() => update.mutate({ ticketId: ticket.id, id: item.id, patch: { done: !item.done } })}
                onRename={(title) => update.mutate({ ticketId: ticket.id, id: item.id, patch: { title } })}
                onDelete={() => remove.mutate({ ticketId: ticket.id, id: item.id })}
                onConvert={() => void convert(item)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!canEdit && total === 0 && <p className="text-xs text-fg-faint">{t('ticket.checklist.empty')}</p>}

      {canEdit && (
        <div className={`flex items-center gap-2 ${total > 0 ? 'mt-1' : ''}`}>
          <span className="w-6 h-6 flex items-center justify-center text-fg-faint flex-shrink-0" aria-hidden>
            <Icon name="plus" />
          </span>
          <input ref={inputRef} value={draft} maxLength={CHECKLIST_TITLE_MAX} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
            placeholder={t('ticket.checklist.addPlaceholder')} aria-label={t('ticket.checklist.addAria')} data-checklist-add
            className="flex-1 min-w-0 text-sm py-1.5 px-1 rounded-md bg-transparent border border-transparent text-fg-2 placeholder-fg-faint focus:outline-none focus:bg-field focus:border-line focus:px-2.5 transition-all" />
          {draft.trim() && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addDraft}
              className="text-xs bg-primary-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-primary-700 flex-shrink-0">{t('common.add')}</button>
          )}
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, canEdit, canConvert, onToggle, onRename, onDelete, onConvert }: {
  item: ChecklistItem; canEdit: boolean; canConvert: boolean
  onToggle: () => void; onRename: (title: string) => void; onDelete: () => void; onConvert: () => void
}) {
  const t = useT()
  // Sunucudan kimliği gelmemiş madde (eklenirken) değişmez.
  const pending = item.id.startsWith('tmp-')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !canEdit || pending })
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!editing) setTitle(item.title) }, [item.title, editing])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])
  const commit = () => {
    setEditing(false)
    const next = title.trim()
    if (next && next !== item.title) onRename(next); else setTitle(item.title)
  }

  const menuItems: RowMenuItem[] = canEdit && !pending ? [
    { key: 'edit', label: t('ticket.checklist.edit'), icon: MenuIcons.edit, onSelect: () => setEditing(true) },
    ...(canConvert ? [{ key: 'subtask', label: t('ticket.checklist.toSubtask'), icon: MenuIcons.list, onSelect: onConvert }] : []),
    { key: 'delete', label: t('common.delete'), icon: MenuIcons.trash, onSelect: onDelete, danger: true, separated: true },
  ] : []
  const menu = useRowMenu(menuItems, { title: item.title, label: t('board.menu.more', { name: item.title }) })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : pending ? 0.6 : 1 }

  return (
    <li ref={setNodeRef} style={style} onContextMenu={menu.onContextMenu} data-checklist-item={item.id}
      className={`group/item relative flex items-center gap-2 rounded-lg -mx-2 px-2 py-0.5 hover:bg-raised/60 transition-colors ${isDragging ? 'bg-surface shadow-lg ring-1 ring-primary-300 z-10' : ''}`}>
      {canEdit && !pending && (
        <span {...attributes} {...listeners} title={t('ticket.checklist.reorder')} aria-label={t('ticket.checklist.reorderAria', { name: item.title })}
          className="absolute -left-3 top-1/2 -translate-y-1/2 w-4 h-6 flex items-center justify-center text-fg-faint cursor-move opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 transition-opacity select-none text-sm leading-none">⠿</span>
      )}
      <button type="button" role="checkbox" aria-checked={item.done} disabled={!canEdit || pending} onClick={onToggle}
        aria-label={item.done ? t('ticket.checklist.uncheck', { name: item.title }) : t('ticket.checklist.check', { name: item.title })}
        className="tap w-6 h-6 flex items-center justify-center flex-shrink-0 rounded-md disabled:cursor-default group/box">
        <span className={`w-4 h-4 rounded-md border-2 flex items-center justify-center transition-colors ${item.done ? 'bg-success border-success text-white' : 'border-fg-faint group-hover/box:border-primary-500'}`}>
          {item.done && <Icon name="check" size={12} />}
        </span>
      </button>
      {editing ? (
        <input ref={inputRef} value={title} maxLength={CHECKLIST_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setTitle(item.title) } }}
          aria-label={t('ticket.checklist.edit')}
          className="flex-1 min-w-0 text-sm bg-field border border-primary-500 rounded-md px-1.5 py-0.5 outline-none text-fg" />
      ) : (
        <span onDoubleClick={() => { if (canEdit && !pending) setEditing(true) }} title={canEdit ? t('ticket.checklist.editHint') : undefined}
          className={`flex-1 min-w-0 text-sm py-1 break-words ${item.done ? 'line-through text-fg-muted' : 'text-fg-2'}`}>{item.title}</span>
      )}
      {menu.trigger && !editing && <div className={rowMenuSlot('group-hover/item:opacity-100', menu.open)}>{menu.trigger}</div>}
      {menu.menu}
    </li>
  )
}
