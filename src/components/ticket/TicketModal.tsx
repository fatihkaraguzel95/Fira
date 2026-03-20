import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useTicket, useUpdateTicket, useDeleteTicket } from '../../hooks/useTickets'
import { useStatuses } from '../../hooks/useStatuses'
import { useAuth } from '../../hooks/useAuth'
import { useIsTeamOwner } from '../../hooks/useTeams'
import { useTicketDeadlines, useAddDeadline, useDeleteDeadline } from '../../hooks/useTicketDeadlines'
import type { TicketPriority } from '../../types'
import { PriorityPicker, PriorityFlagBadge } from './PriorityPicker'
import { UserAvatar } from './UserAvatar'
import { AttachmentUpload } from './AttachmentUpload'
import { CommentSection } from './CommentSection'
import { TagSelector } from './TagSelector'
import { MultiAssigneeSelector } from './MultiAssigneeSelector'
import { DescriptionEditor } from './DescriptionEditor'
import { SubTaskList } from './SubTaskList'

interface Props {
  projectId: string | null
}

export function TicketModal({ projectId }: Props) {
  const navigate = useNavigate()
  const { ticketId } = useParams<{ ticketId: string }>()
  const { user } = useAuth()
  const { data: ticket, isLoading } = useTicket(ticketId ?? '')
  const { data: statuses } = useStatuses(projectId)
  const updateTicket = useUpdateTicket()
  const deleteTicket = useDeleteTicket()
  const { data: isTeamOwner = false } = useIsTeamOwner(projectId)

  const { data: deadlines = [] } = useTicketDeadlines(ticketId ?? '')
  const addDeadline = useAddDeadline()
  const deleteDeadline = useDeleteDeadline()

  const [editTitle, setEditTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [descValue, setDescValue] = useState('')
  const descSaved = useRef('')
  const [showAssignees, setShowAssignees] = useState(false)
  const [addingDeadline, setAddingDeadline] = useState(false)
  const [dlDate, setDlDate] = useState('')
  const [dlDesc, setDlDesc] = useState('')

  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ticket) {
      setTitleValue(ticket.title)
      setDescValue(ticket.description ?? '')
      descSaved.current = ticket.description ?? ''
    }
  }, [ticket?.id])

  useEffect(() => {
    if (editTitle) titleRef.current?.focus()
  }, [editTitle])

  const close = () => navigate(-1)

  const canEdit = !!user

  const handleUpdate = (input: Parameters<typeof updateTicket.mutate>[0]['input']) => {
    if (!ticket) return
    updateTicket.mutate({ id: ticket.id, input })
  }

  const handleDelete = async () => {
    if (!ticket) return
    if (!confirm('Bu ticket silinsin mi?')) return
    await deleteTicket.mutateAsync(ticket.id)
    navigate(-1)
  }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  const handleAddDeadline = async () => {
    if (!dlDate || !ticket) return
    await addDeadline.mutateAsync({ ticketId: ticket.id, date: dlDate, description: dlDesc })
    setDlDate(''); setDlDesc(''); setAddingDeadline(false)
  }

  const handleDescBlur = () => {
    if (descValue !== descSaved.current) {
      handleUpdate({ description: descValue || null })
      descSaved.current = descValue
    }
  }

  const assignees = ticket?.assignees?.map((a) => a.user) ?? []
  const tags = ticket?.tags?.map((t) => t.tag) ?? []

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-3"
      onClick={handleBackdrop}
    >
      <div className="bg-white dark:bg-gray-900 sm:rounded-2xl rounded-t-2xl shadow-modal flex flex-col w-full sm:w-[95vw] sm:max-w-[1400px] h-[92dvh] sm:h-[94vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-4 md:px-7 py-3 md:py-4 border-b border-slate-100 dark:border-gray-800 gap-4 flex-shrink-0">
          {isLoading ? (
            <div className="h-6 w-48 bg-slate-200 dark:bg-gray-700 rounded animate-pulse" />
          ) : editTitle && canEdit ? (
            <input
              ref={titleRef}
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={() => {
                setEditTitle(false)
                if (titleValue.trim() && titleValue !== ticket?.title)
                  handleUpdate({ title: titleValue.trim() })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') titleRef.current?.blur()
                if (e.key === 'Escape') { setEditTitle(false); setTitleValue(ticket?.title ?? '') }
              }}
              className="flex-1 text-xl font-bold text-slate-900 dark:text-gray-100 border-b-2 border-primary-500 outline-none bg-transparent"
            />
          ) : (
            <h2
              className={`flex-1 text-xl font-bold text-slate-900 dark:text-gray-100 leading-snug ${canEdit ? 'cursor-pointer hover:text-primary-600' : ''}`}
              onClick={() => canEdit && setEditTitle(true)}
            >
              {ticket?.title}
            </h2>
          )}

          <div className="flex items-center gap-2 flex-shrink-0">
            {canEdit && ticket && (
              <button
                onClick={handleDelete}
                className="text-xs text-red-500 hover:text-red-700 px-2.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors min-h-[32px]"
              >
                Sil
              </button>
            )}
            <button
              onClick={close}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 p-7 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-8 bg-slate-100 dark:bg-gray-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : ticket ? (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">

            {/* ── Main content ── */}
            <div className="flex-1 overflow-y-auto p-4 md:p-7 space-y-5 md:space-y-7 md:border-r border-slate-100 dark:border-gray-800 scrollbar-thin">

              {/* Mobile metadata strip — visible only on mobile */}
              <div className="flex md:hidden gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
                {/* Status chip */}
                {ticket.status_info && (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full flex-shrink-0 whitespace-nowrap"
                    style={{
                      backgroundColor: (ticket.status_info.color ?? '#6b7280') + '20',
                      color: ticket.status_info.color ?? '#6b7280',
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: ticket.status_info.color ?? '#6b7280' }} />
                    {ticket.status_info.name ?? ticket.status}
                  </span>
                )}
                {/* Priority chip */}
                <span className="inline-flex items-center flex-shrink-0">
                  <PriorityFlagBadge priority={ticket.priority} size="sm" />
                </span>
                {/* Due date chip */}
                {ticket.due_date && (
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full flex-shrink-0 whitespace-nowrap ${
                    new Date(ticket.due_date) < new Date()
                      ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                      : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400'
                  }`}>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {new Date(ticket.due_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                  </span>
                )}
                {/* Assignee avatars chip */}
                {assignees.length > 0 && (
                  <span className="inline-flex items-center gap-1 flex-shrink-0">
                    <div className="flex -space-x-1.5">
                      {assignees.slice(0, 3).map(u => (
                        <div key={u.id} className="ring-1 ring-white dark:ring-gray-900 rounded-full">
                          <UserAvatar user={u} size="sm" />
                        </div>
                      ))}
                    </div>
                  </span>
                )}
              </div>

              {/* Tags */}
              {projectId && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Taglar</h4>
                  <TagSelector ticketId={ticket.id} projectId={projectId} assignedTags={tags} />
                </div>
              )}

              {/* Description */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Açıklama</h4>
                {canEdit ? (
                  <DescriptionEditor
                    key={ticket.id}
                    value={descValue}
                    onChange={setDescValue}
                    onBlur={handleDescBlur}
                    ticketId={ticket.id}
                    minHeight="260px"
                    placeholder="Açıklama yazın… (Ctrl+B kalın, Ctrl+I italik, Ctrl+V ekran görüntüsü)"
                  />
                ) : (
                  <DescriptionEditor
                    key={`ro-${ticket.id}`}
                    value={ticket.description ?? ''}
                    onChange={() => {}}
                    ticketId={ticket.id}
                    readOnly
                    minHeight="120px"
                    placeholder="Açıklama yok"
                  />
                )}
              </div>

              {/* Subtasks */}
              <SubTaskList ticketId={ticket.id} ticketTitle={ticket.title} canEdit={canEdit} />

              <AttachmentUpload ticketId={ticket.id} />
              <CommentSection ticketId={ticket.id} />
            </div>

            {/* ── Sidebar — hidden on mobile, visible on desktop ── */}
            <div className="hidden md:flex w-72 flex-shrink-0 flex-col overflow-y-auto p-5 space-y-5 scrollbar-thin">

              {/* Status */}
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Durum</p>
                {canEdit && statuses ? (
                  <select
                    value={ticket.status_id ?? ''}
                    onChange={(e) => handleUpdate({ status_id: e.target.value || null })}
                    className="w-full border border-slate-200 dark:border-gray-700 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 dark:text-gray-200 transition-shadow"
                  >
                    <option value="">— Seçiniz —</option>
                    {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg font-medium"
                    style={{ backgroundColor: (ticket.status_info?.color ?? '#6b7280') + '22', color: ticket.status_info?.color ?? '#6b7280' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ticket.status_info?.color ?? '#6b7280' }} />
                    {ticket.status_info?.name ?? ticket.status}
                  </span>
                )}
              </div>

              {/* Priority */}
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Öncelik</p>
                {canEdit ? (
                  <PriorityPicker value={ticket.priority} onChange={(p) => handleUpdate({ priority: p as TicketPriority })} />
                ) : (
                  <PriorityFlagBadge priority={ticket.priority} size="md" />
                )}
              </div>

              {/* Assignees */}
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Atananlar</p>
                {assignees.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {assignees.map(u => <UserAvatar key={u.id} user={u} size="sm" showName />)}
                  </div>
                )}
                <button
                  onClick={() => setShowAssignees(!showAssignees)}
                  className="text-xs text-primary-600 hover:text-primary-700 hover:underline font-medium"
                >
                  {showAssignees ? 'Kapat' : 'Düzenle'}
                </button>
                {showAssignees && <div className="mt-2"><MultiAssigneeSelector ticketId={ticket.id} assignees={assignees} /></div>}
              </div>

              {/* Due Date */}
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Bitiş Tarihi</p>
                {canEdit ? (
                  <input
                    type="date"
                    value={ticket.due_date?.slice(0, 10) ?? ''}
                    onChange={(e) => handleUpdate({ due_date: e.target.value || null })}
                    className="w-full border border-slate-200 dark:border-gray-700 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 dark:text-gray-200"
                  />
                ) : ticket.due_date ? (
                  <span className="text-sm text-slate-700 dark:text-gray-300">{new Date(ticket.due_date).toLocaleDateString('tr-TR')}</span>
                ) : (
                  <span className="text-sm text-slate-400">—</span>
                )}

                {/* Extra deadlines */}
                {deadlines.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {deadlines.map(dl => (
                      <li key={dl.id} className="group flex items-start gap-1.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 dark:text-gray-300">{new Date(dl.date).toLocaleDateString('tr-TR')}</p>
                          {dl.description && <p className="text-xs text-slate-400 truncate">{dl.description}</p>}
                        </div>
                        {canEdit && (
                          <button
                            onClick={() => deleteDeadline.mutate({ id: dl.id, ticketId: ticket.id })}
                            className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 text-xs transition-opacity flex-shrink-0"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canEdit && !addingDeadline && (
                  <button
                    onClick={() => setAddingDeadline(true)}
                    className="mt-2 text-xs text-primary-600 hover:text-primary-700 hover:underline font-medium"
                  >
                    + Ekstra deadline ekle
                  </button>
                )}
                {canEdit && addingDeadline && (
                  <div className="mt-2 space-y-1.5">
                    <input
                      type="date"
                      value={dlDate}
                      onChange={e => setDlDate(e.target.value)}
                      className="w-full border border-slate-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 dark:text-gray-200"
                    />
                    <input
                      type="text"
                      value={dlDesc}
                      onChange={e => setDlDesc(e.target.value)}
                      placeholder="Açıklama (isteğe bağlı)"
                      className="w-full border border-slate-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 dark:text-gray-200"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleAddDeadline}
                        disabled={!dlDate || addDeadline.isPending}
                        className="flex-1 text-xs bg-primary-600 text-white px-2 py-2 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
                      >
                        Ekle
                      </button>
                      <button
                        onClick={() => { setAddingDeadline(false); setDlDate(''); setDlDesc('') }}
                        className="text-xs text-slate-400 hover:text-slate-600 px-2 py-2"
                      >
                        İptal
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Creator + Created At */}
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Oluşturan</p>
                <div className="flex items-start gap-2">
                  <UserAvatar user={ticket.creator} size="sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700 dark:text-gray-300 truncate">
                      {ticket.creator?.full_name || ticket.creator?.email || '—'}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">
                      {new Date(ticket.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}
                      {new Date(ticket.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Last Modified */}
              {ticket.updater && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Son Değişiklik</p>
                  <div className="flex items-start gap-2">
                    <UserAvatar user={ticket.updater} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-700 dark:text-gray-300 truncate">
                        {ticket.updater.full_name || ticket.updater.email}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">
                        {new Date(ticket.updated_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}
                        {new Date(ticket.updated_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">Ticket bulunamadı</div>
        )}
      </div>
    </div>
  )
}
