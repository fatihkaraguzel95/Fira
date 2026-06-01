import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateSubTask, useDeleteSubTask } from '../../hooks/useSubTasks'
import { useAuth } from '../../hooks/useAuth'
import type { SubTask, TicketPriority } from '../../types'
import { DescriptionEditor } from './DescriptionEditor'

interface Props {
  subtask: SubTask
  parentTicketTitle: string
  onClose: () => void
  canEdit: boolean
}

export function SubTaskModal({ subtask, parentTicketTitle, onClose, canEdit }: Props) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const updateSubTask = useUpdateSubTask()
  const deleteSubTask = useDeleteSubTask()

  const [editTitle, setEditTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(subtask.title)
  const [descValue, setDescValue] = useState(subtask.description ?? '')
  const descSaved = useRef(subtask.description ?? '')

  const titleRef = useRef<HTMLInputElement>(null)
  const canEditThis = canEdit || (!!user && user.id === subtask.created_by)

  useEffect(() => {
    setTitleValue(subtask.title)
    setDescValue(subtask.description ?? '')
    descSaved.current = subtask.description ?? ''
  }, [subtask.id])

  useEffect(() => {
    if (editTitle) titleRef.current?.focus()
  }, [editTitle])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  const handleUpdate = (input: Partial<{
    title: string; description: string | null
    priority: TicketPriority; due_date: string | null; is_done: boolean
  }>) => {
    updateSubTask.mutate({ id: subtask.id, ticketId: subtask.ticket_id, input })
  }

  const handleDescBlur = () => {
    if (descValue !== descSaved.current) {
      handleUpdate({ description: descValue || null })
      descSaved.current = descValue
    }
  }

  const handleDelete = async () => {
    if (!confirm(t('subtask.deleteConfirm'))) return
    await deleteSubTask.mutateAsync({ id: subtask.id, ticketId: subtask.ticket_id })
    onClose()
  }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const priority: TicketPriority = (subtask.priority as TicketPriority) ?? 'medium'
  const dueDate = subtask.due_date ? subtask.due_date.slice(0, 10) : ''

  const PRIORITY_OPTIONS: { value: TicketPriority; color: string }[] = [
    { value: 'low',      color: '#3b82f6' },
    { value: 'medium',   color: '#f59e0b' },
    { value: 'high',     color: '#f97316' },
    { value: 'critical', color: '#ef4444' },
  ]

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-3"
      onClick={handleBackdrop}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: '90vw', maxWidth: '1100px', height: '88vh' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 gap-4 flex-shrink-0">
          <div className="flex-1 min-w-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 flex-shrink-0">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                {t('subtask.label')}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate">↳ {parentTicketTitle}</span>
            </div>

            {/* Title */}
            {editTitle && canEditThis ? (
              <input
                ref={titleRef}
                value={titleValue}
                onChange={e => setTitleValue(e.target.value)}
                onBlur={() => {
                  setEditTitle(false)
                  if (titleValue.trim() && titleValue !== subtask.title)
                    handleUpdate({ title: titleValue.trim() })
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') titleRef.current?.blur()
                  if (e.key === 'Escape') { setEditTitle(false); setTitleValue(subtask.title) }
                }}
                className="w-full text-xl font-semibold text-gray-900 dark:text-gray-100 border-b-2 border-blue-500 outline-none bg-transparent"
              />
            ) : (
              <h2
                className={`text-xl font-semibold text-gray-900 dark:text-gray-100 leading-snug ${canEditThis ? 'cursor-pointer hover:text-blue-600' : ''}`}
                onClick={() => canEditThis && setEditTitle(true)}
              >
                {subtask.title}
              </h2>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {canEditThis && (
              <button onClick={handleDelete}
                className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                {t('common.delete')}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex">
          {/* Main */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 border-r border-gray-100 dark:border-gray-800 scrollbar-thin">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">{t('subtask.description')}</h4>
              {canEditThis ? (
                <DescriptionEditor
                  key={subtask.id}
                  value={descValue}
                  onChange={setDescValue}
                  onBlur={handleDescBlur}
                  ticketId={subtask.id}
                  minHeight="240px"
                  placeholder={t('subtask.descriptionPlaceholder')}
                />
              ) : (
                <DescriptionEditor
                  key={`ro-${subtask.id}`}
                  value={subtask.description ?? ''}
                  onChange={() => {}}
                  ticketId={subtask.id}
                  readOnly
                  minHeight="120px"
                  placeholder={t('subtask.noDescription')}
                />
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-68 flex-shrink-0 overflow-y-auto p-6 space-y-6 scrollbar-thin" style={{ width: '272px' }}>

            {/* Status */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">{t('subtask.status')}</p>
              <button
                onClick={() => canEditThis && handleUpdate({ is_done: !subtask.is_done })}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                  subtask.is_done
                    ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                } ${canEditThis ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
              >
                {subtask.is_done ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {t('subtask.done')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="9" strokeWidth={2} />
                    </svg>
                    {t('subtask.inProgress')}
                  </>
                )}
              </button>
            </div>

            {/* Priority */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">{t('subtask.priority')}</p>
              <div className="space-y-1.5">
                {PRIORITY_OPTIONS.map(p => {
                  const isSelected = priority === p.value
                  return (
                    <button
                      key={p.value}
                      type="button"
                      disabled={!canEditThis}
                      onClick={() => canEditThis && handleUpdate({ priority: p.value })}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                        isSelected
                          ? 'border-current shadow-sm'
                          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                      } ${!canEditThis ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
                      style={isSelected ? {
                        backgroundColor: p.color + '18',
                        borderColor: p.color + '60',
                        color: p.color,
                      } : {}}
                    >
                      <svg viewBox="0 0 16 16" className="w-4 h-4 flex-shrink-0"
                        fill={isSelected ? p.color : 'none'}
                        stroke={isSelected ? p.color : 'currentColor'}
                        strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 1v14M3 3h9l-3 3.5 3 3.5H3V3z" />
                      </svg>
                      {t(`ticket.priority.${p.value}`)}
                      {isSelected && (
                        <svg className="w-3.5 h-3.5 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Due Date */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">{t('subtask.dueDate')}</p>
              {canEditThis ? (
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => handleUpdate({ due_date: e.target.value || null })}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
                />
              ) : subtask.due_date ? (
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {new Date(subtask.due_date).toLocaleDateString(i18n.language)}
                </span>
              ) : (
                <span className="text-sm text-gray-400">—</span>
              )}
            </div>

            {/* Created At */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">{t('subtask.createdAt')}</p>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {new Date(subtask.created_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
