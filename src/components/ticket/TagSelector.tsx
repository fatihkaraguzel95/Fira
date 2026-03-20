import { useState } from 'react'
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, useAssignTag, useUnassignTag } from '../../hooks/useTags'
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
  const updateTag = useUpdateTag()
  const deleteTag = useDeleteTag()
  const assignTag = useAssignTag()
  const unassignTag = useUnassignTag()

  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

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

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
  }

  const handleSaveEdit = async (tag: Tag) => {
    if (!editName.trim()) return
    await updateTag.mutateAsync({ id: tag.id, projectId, name: editName.trim(), color: editColor })
    setEditingId(null)
  }

  const handleDelete = async (tag: Tag) => {
    await deleteTag.mutateAsync({ id: tag.id, projectId })
  }

  return (
    <div className="relative">
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

      {open && (
        <div className="absolute left-0 top-7 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-3 w-72">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">Tag Yönetimi</p>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs">✕</button>
          </div>

          <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
            {allTags?.map((tag) => (
              <div key={tag.id} className="group flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-1.5 py-1">
                {editingId === tag.id ? (
                  <div className="flex-1 space-y-1">
                    <div className="flex gap-1 flex-wrap">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: c, outline: editColor === c ? `2px solid ${c}` : undefined, outlineOffset: 1 }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(tag)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
                      />
                      <button
                        onClick={() => handleSaveEdit(tag)}
                        className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded hover:bg-blue-700"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-400 px-1 py-0.5"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <input
                      type="checkbox"
                      checked={assignedIds.has(tag.id)}
                      onChange={() => toggle(tag)}
                      className="rounded flex-shrink-0"
                    />
                    <span
                      className="flex-1 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer"
                      style={{ backgroundColor: tag.color + '22', color: tag.color }}
                      onClick={() => toggle(tag)}
                    >
                      {tag.name}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(tag)}
                        title="Düzenle"
                        className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(tag)}
                        title="Sil"
                        className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {!allTags?.length && <p className="text-xs text-gray-400 dark:text-gray-500 px-1.5">Henüz tag yok</p>}
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
            {creating ? (
              <div className="space-y-2">
                <div className="flex gap-1 flex-wrap">
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
                  className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
                />
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={createTag.isPending} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 flex-1">Oluştur</button>
                  <button onClick={() => setCreating(false)} className="text-xs text-gray-400 px-2 py-1">İptal</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 w-full text-left">+ Yeni tag oluştur</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
