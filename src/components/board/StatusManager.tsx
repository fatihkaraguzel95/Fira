import { useState } from 'react'
import { useStatuses, useCreateStatus, useUpdateStatus, useDeleteStatus } from '../../hooks/useStatuses'

const PRESET_COLORS = ['#6b7280', '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#f97316']

interface Props { projectId: string }

export function StatusManager({ projectId }: Props) {
  const { data: statuses } = useStatuses(projectId)
  const createStatus = useCreateStatus()
  const updateStatus = useUpdateStatus()
  const deleteStatus = useDeleteStatus()

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleAdd = async () => {
    if (!newName.trim()) return
    await createStatus.mutateAsync({ projectId, name: newName.trim(), color: newColor })
    setNewName('')
    setNewColor('#6b7280')
    setAdding(false)
  }

  const handleRename = async (id: string) => {
    if (!editName.trim()) return
    await updateStatus.mutateAsync({ id, projectId, name: editName.trim() })
    setEditingId(null)
  }

  const handleColorChange = async (id: string, color: string) => {
    await updateStatus.mutateAsync({ id, projectId, color })
  }

  return (
    <div className="space-y-2">
      {statuses?.map((s) => (
        <div key={s.id} className="flex items-center gap-2 group">
          {/* Color dot (clickable for color picker) */}
          <div className="relative">
            <span
              className="w-4 h-4 rounded-full cursor-pointer flex-shrink-0 block"
              style={{ backgroundColor: s.color }}
              title="Renk seç"
            />
            <select
              className="absolute inset-0 opacity-0 cursor-pointer w-4"
              value={s.color}
              onChange={(e) => handleColorChange(s.id, e.target.value)}
            >
              {PRESET_COLORS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {editingId === s.id ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleRename(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(s.id)
                if (e.key === 'Escape') setEditingId(null)
              }}
              className="flex-1 text-sm border border-blue-400 rounded px-2 py-0.5 outline-none"
            />
          ) : (
            <span
              className="flex-1 text-sm text-gray-700 cursor-pointer hover:text-blue-600"
              onClick={() => { setEditingId(s.id); setEditName(s.name) }}
            >
              {s.name}
            </span>
          )}

          <button
            onClick={() => {
              if (confirm(`"${s.name}" sütununu sil?`)) {
                deleteStatus.mutate({ id: s.id, projectId })
              }
            }}
            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-xs transition-all"
          >
            ✕
          </button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className="w-4 h-4 rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: c, outline: newColor === c ? `2px solid ${c}` : undefined, outlineOffset: 1 }}
              />
            ))}
          </div>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
            placeholder="Durum adı..."
            className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={handleAdd} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">Ekle</button>
          <button onClick={() => setAdding(false)} className="text-xs text-gray-400">İptal</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 mt-1"
        >
          <span>+</span> Durum ekle
        </button>
      )}
    </div>
  )
}
