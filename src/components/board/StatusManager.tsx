import { useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStatuses, useCreateStatus, useUpdateStatus, useDeleteStatus, useReorderStatuses } from '../../hooks/useStatuses'
import type { TicketStatus } from '../../types'

const COLORS = [
  { hex: '#6b7280', label: 'Gri' },
  { hex: '#3b82f6', label: 'Mavi' },
  { hex: '#10b981', label: 'Yeşil' },
  { hex: '#f59e0b', label: 'Sarı' },
  { hex: '#ef4444', label: 'Kırmızı' },
  { hex: '#8b5cf6', label: 'Mor' },
  { hex: '#ec4899', label: 'Pembe' },
  { hex: '#f97316', label: 'Turuncu' },
  { hex: '#14b8a6', label: 'Turkuaz' },
  { hex: '#0ea5e9', label: 'Açık Mavi' },
]

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {COLORS.map((c) => (
        <button
          key={c.hex}
          title={c.label}
          onClick={() => onChange(c.hex)}
          className="w-5 h-5 rounded-full transition-transform hover:scale-110 flex-shrink-0"
          style={{
            backgroundColor: c.hex,
            outline: value === c.hex ? `2px solid ${c.hex}` : undefined,
            outlineOffset: 2,
            boxShadow: value === c.hex ? '0 0 0 1px white inset' : undefined,
          }}
        />
      ))}
    </div>
  )
}

function SortableStatusRow({
  status,
  onUpdate,
  onDelete,
}: {
  status: TicketStatus
  onUpdate: (id: string, name?: string, color?: string) => void
  onDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(status.name)
  const [showColors, setShowColors] = useState(false)

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style} className="group">
      <div className="flex items-center gap-2 py-1.5 px-1 rounded-lg hover:bg-gray-50">
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab text-gray-300 hover:text-gray-500 text-sm select-none"
          title="Sırala"
        >
          ⠿
        </span>

        {/* Color dot */}
        <div className="relative">
          <button
            onClick={() => setShowColors(!showColors)}
            className="w-4 h-4 rounded-full flex-shrink-0 hover:ring-2 hover:ring-offset-1 transition-all"
            style={{ backgroundColor: status.color, outlineColor: status.color }}
          />
          {showColors && (
            <div className="absolute left-0 top-6 z-30 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-44">
              <p className="text-xs text-gray-500 mb-2 font-medium">Renk Seç</p>
              <ColorPicker
                value={status.color}
                onChange={(c) => { onUpdate(status.id, undefined, c); setShowColors(false) }}
              />
            </div>
          )}
        </div>

        {/* Name */}
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name.trim() && name !== status.name) onUpdate(status.id, name.trim()) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { setEditing(false); if (name.trim() && name !== status.name) onUpdate(status.id, name.trim()) }
              if (e.key === 'Escape') { setEditing(false); setName(status.name) }
            }}
            className="flex-1 text-sm border border-blue-400 rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <span
            className="flex-1 text-sm text-gray-700 cursor-pointer hover:text-blue-600 truncate"
            onClick={() => setEditing(true)}
          >
            {status.name}
          </span>
        )}

        <button
          onClick={() => { if (confirm(`"${status.name}" durumu silinsin mi?`)) onDelete(status.id) }}
          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-xs transition-all"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

interface Props { projectId: string }

export function StatusManager({ projectId }: Props) {
  const { data: statuses = [] } = useStatuses(projectId)
  const createStatus = useCreateStatus()
  const updateStatus = useUpdateStatus()
  const deleteStatus = useDeleteStatus()
  const reorderStatuses = useReorderStatuses()

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIdx = statuses.findIndex((s) => s.id === active.id)
    const newIdx = statuses.findIndex((s) => s.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(statuses, oldIdx, newIdx)
    reorderStatuses.mutate(reordered.map((s, i) => ({ id: s.id, order_index: i, projectId })))
  }

  const handleAdd = async () => {
    if (!newName.trim()) return
    await createStatus.mutateAsync({ projectId, name: newName.trim(), color: newColor })
    setNewName('')
    setNewColor('#6b7280')
    setAdding(false)
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {statuses.map((s) => (
            <SortableStatusRow
              key={s.id}
              status={s}
              onUpdate={(id, name, color) => updateStatus.mutate({ id, projectId, name, color })}
              onDelete={(id) => deleteStatus.mutate({ id, projectId })}
            />
          ))}
        </SortableContext>
      </DndContext>

      {adding ? (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
          <ColorPicker value={newColor} onChange={setNewColor} />
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: newColor }} />
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="Durum adı..."
              className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={createStatus.isPending} className="flex-1 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              Ekle
            </button>
            <button onClick={() => setAdding(false)} className="text-xs text-gray-400 px-2 py-1.5">İptal</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 mt-2 px-1"
        >
          <span>+</span> Durum ekle
        </button>
      )}
    </div>
  )
}
