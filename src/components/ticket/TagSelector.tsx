import { useState } from 'react'
import { useTags, useCreateTag, useAssignTag, useUnassignTag } from '../../hooks/useTags'
import type { Tag } from '../../types'

const PRESET_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#f97316', '#6b7280']

interface Props {
  ticketId: string
  projectId: string
  assignedTags: Tag[]
}

export function TagSelector({ ticketId, projectId, assignedTags }: Props) {
  const { data: allTags } = useTags(projectId)
  const createTag = useCreateTag()
  const assignTag = useAssignTag()
  const unassignTag = useUnassignTag()

  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [creating, setCreating] = useState(false)

  const assignedIds = new Set(assignedTags.map((t) => t.id))

  const toggle = async (tag: Tag) => {
    if (assignedIds.has(tag.id)) {
      await unassignTag.mutateAsync({ ticketId, tagId: tag.id })
    } else {
      await assignTag.mutateAsync({ ticketId, tagId: tag.id })
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    const tag = await createTag.mutateAsync({ projectId, name: newName.trim(), color: newColor })
    await assignTag.mutateAsync({ ticketId, tagId: tag.id })
    setNewName('')
    setCreating(false)
  }

  return (
    <div className="relative">
      {/* Assigned tags + open button */}
      <div className="flex flex-wrap gap-1 items-center">
        {assignedTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer"
            style={{ backgroundColor: tag.color + '22', color: tag.color }}
            onClick={() => unassignTag.mutate({ ticketId, tagId: tag.id })}
          >
            {tag.name} <span className="opacity-60">✕</span>
          </span>
        ))}
        <button
          onClick={() => setOpen(!open)}
          className="text-xs text-gray-400 hover:text-blue-500 px-1.5 py-0.5 border border-dashed border-gray-300 rounded-full hover:border-blue-400 transition-colors"
        >
          + Tag
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-7 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-56">
          <p className="text-xs font-medium text-gray-500 mb-2">Tag Seç</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {allTags?.map((tag) => (
              <label key={tag.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                <input
                  type="checkbox"
                  checked={assignedIds.has(tag.id)}
                  onChange={() => toggle(tag)}
                  className="rounded"
                />
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: tag.color + '22', color: tag.color }}
                >
                  {tag.name}
                </span>
              </label>
            ))}
            {!allTags?.length && <p className="text-xs text-gray-400">Henüz tag yok</p>}
          </div>

          <div className="border-t border-gray-100 mt-2 pt-2">
            {creating ? (
              <div className="space-y-2">
                <div className="flex gap-1">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: c, outline: newColor === c ? `2px solid ${c}` : undefined, outlineOffset: 1 }}
                    />
                  ))}
                </div>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
                  placeholder="Tag adı..."
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={createTag.isPending} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 flex-1">Oluştur</button>
                  <button onClick={() => setCreating(false)} className="text-xs text-gray-400 px-2 py-1">İptal</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="text-xs text-gray-400 hover:text-gray-700 w-full text-left">+ Yeni tag oluştur</button>
            )}
          </div>

          <button onClick={() => setOpen(false)} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
        </div>
      )}
    </div>
  )
}
