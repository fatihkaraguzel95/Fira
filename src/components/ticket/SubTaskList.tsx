import { useState, KeyboardEvent } from 'react'
import { useSubTasks, useCreateSubTask, useToggleSubTask, useDeleteSubTask } from '../../hooks/useSubTasks'

interface Props {
  ticketId: string
  canEdit: boolean
}

export function SubTaskList({ ticketId, canEdit }: Props) {
  const { data: subtasks = [] } = useSubTasks(ticketId)
  const createSubTask = useCreateSubTask()
  const toggleSubTask = useToggleSubTask()
  const deleteSubTask = useDeleteSubTask()
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

  const done = subtasks.filter((s) => s.is_done).length
  const total = subtasks.length

  const handleAdd = async () => {
    const title = newTitle.trim()
    if (!title) return
    await createSubTask.mutateAsync({ ticketId, title })
    setNewTitle('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') { setAdding(false); setNewTitle('') }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-700">
          Alt Görevler
          {total > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-400">{done}/{total}</span>
          )}
        </h4>
        {canEdit && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            + Ekle
          </button>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      )}

      {/* Subtask list */}
      <ul className="space-y-1">
        {subtasks.map((sub) => (
          <li key={sub.id} className="flex items-center gap-2 group">
            <input
              type="checkbox"
              checked={sub.is_done}
              onChange={(e) =>
                toggleSubTask.mutate({ id: sub.id, ticketId, is_done: e.target.checked })
              }
              className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer flex-shrink-0"
            />
            <span
              className={`flex-1 text-sm ${sub.is_done ? 'line-through text-gray-400' : 'text-gray-700'}`}
            >
              {sub.title}
            </span>
            {canEdit && (
              <button
                onClick={() => deleteSubTask.mutate({ id: sub.id, ticketId })}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-xs leading-none transition-opacity"
                title="Sil"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Add input */}
      {adding && canEdit && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Alt görev başlığı..."
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAdd}
            disabled={!newTitle.trim() || createSubTask.isPending}
            className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Ekle
          </button>
          <button
            onClick={() => { setAdding(false); setNewTitle('') }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            İptal
          </button>
        </div>
      )}

      {!adding && canEdit && total === 0 && (
        <button
          onClick={() => setAdding(true)}
          className="w-full text-left text-xs text-gray-400 hover:text-gray-600 py-1 rounded border border-dashed border-gray-200 px-2 hover:border-gray-300 transition-colors"
        >
          + Alt görev ekle
        </button>
      )}
    </div>
  )
}
