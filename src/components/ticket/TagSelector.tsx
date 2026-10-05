import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, useAssignTag, useUnassignTag } from '../../hooks/useTags'
import type { Tag } from '../../types'

import { TeamHexPicker } from '../ui/ColorPalettePicker'
import { useProjectRole } from '../../hooks/useTeams'
import { useT } from '../../i18n'

// Tag colours come from the team palette, like statuses and lists.
const DEFAULT_TAG_HEX = '#3b82f6'

interface Props {
  ticketId: string
  projectId: string
  assignedTags: Tag[]
}

export function TagSelector({ ticketId, projectId, assignedTags }: Props) {
  const t = useT()
  const { data: allTags } = useTags(projectId)
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const deleteTag = useDeleteTag()
  const assignTag = useAssignTag()
  const unassignTag = useUnassignTag()

  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_TAG_HEX)
  const { teamId, perms } = useProjectRole(projectId)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  const assignedIds = new Set(assignedTags.map((tag) => tag.id))

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
            className="chip-dyn border inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer"
            style={{ '--c': tag.color } as React.CSSProperties}
            onClick={() => unassignTag.mutate({ ticketId, tagId: tag.id })}
          >
            {tag.name} <span className="opacity-60">✕</span>
          </span>
        ))}
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center h-6 text-xs text-fg-faint hover:text-blue-500 px-2 border border-dashed border-gray-300 rounded-full hover:border-blue-400 transition-colors"
        >
          {t('ticketExtra.tag.add')}
        </button>
      </div>

      {/* Kutu z-40: açıklama editörünün yapışkan araç çubuğu da z-20 ve DOM'da
          sonra geldiği için bu kutunun üstüne biniyordu (#493652b6). */}
      {open && (
        <div className="absolute left-0 top-7 z-40 bg-surface border border-line rounded-xl shadow-lg p-3 w-72">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-fg-2">{t('ticketExtra.tag.manage')}</p>
            <button onClick={() => setOpen(false)} aria-label={t('common.close')} className="text-fg-faint hover:text-fg-2 text-xs">✕</button>
          </div>

          <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
            {allTags?.map((tag) => (
              <div key={tag.id} className="group flex items-center gap-2 hover:bg-raised rounded-lg px-1.5 py-1">
                {editingId === tag.id ? (
                  <div className="flex-1 space-y-1">
                    <TeamHexPicker teamId={teamId} canCreate={perms.canManage} value={editColor} onChange={setEditColor} />
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(tag)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 text-xs border border-line rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-field text-fg"
                      />
                      <button
                        onClick={() => handleSaveEdit(tag)}
                        className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-md hover:bg-blue-700"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-fg-faint px-1 py-0.5"
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
                      className="rounded-md flex-shrink-0"
                    />
                    <span
                      className="chip-dyn border flex-1 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer"
                      style={{ '--c': tag.color } as React.CSSProperties}
                      onClick={() => toggle(tag)}
                    >
                      {tag.name}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(tag)}
                        title={t('common.edit')}
                        className="w-5 h-5 flex items-center justify-center rounded-md text-fg-faint hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        onClick={() => handleDelete(tag)}
                        title={t('common.delete')}
                        className="w-5 h-5 flex items-center justify-center rounded-md text-fg-faint hover:text-danger hover:bg-danger/10 transition-colors"
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {!allTags?.length && <p className="text-xs text-fg-faint px-1.5">{t('ticketExtra.tag.empty')}</p>}
          </div>

          <div className="border-t border-line-soft pt-2">
            {creating ? (
              <div className="space-y-2">
                <TeamHexPicker teamId={teamId} canCreate={perms.canManage} value={newColor} onChange={setNewColor} />
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
                  placeholder={t('ticketExtra.tag.namePlaceholder')}
                  className="w-full text-xs border border-line rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-field text-fg"
                />
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={createTag.isPending} className="text-xs bg-blue-600 text-white px-2 py-1 rounded-md hover:bg-blue-700 flex-1">{t('ticketExtra.create')}</button>
                  <button onClick={() => setCreating(false)} className="text-xs text-fg-faint px-2 py-1">{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="text-xs text-fg-faint hover:text-fg-2 w-full text-left">{t('ticketExtra.tag.createNew')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
