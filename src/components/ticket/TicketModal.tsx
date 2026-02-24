import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useTicket, useUpdateTicket, useDeleteTicket } from '../../hooks/useTickets'
import { useStatuses } from '../../hooks/useStatuses'
import { useAuth } from '../../hooks/useAuth'
import type { TicketPriority } from '../../types'
import { PriorityBadge } from './PriorityBadge'
import { UserAvatar } from './UserAvatar'
import { AttachmentUpload } from './AttachmentUpload'
import { CommentSection } from './CommentSection'
import { TagSelector } from './TagSelector'
import { MultiAssigneeSelector } from './MultiAssigneeSelector'

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

  const [editTitle, setEditTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [editDesc, setEditDesc] = useState(false)
  const [descValue, setDescValue] = useState('')
  const [showAssignees, setShowAssignees] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (ticket) {
      setTitleValue(ticket.title)
      setDescValue(ticket.description ?? '')
    }
  }, [ticket])

  useEffect(() => {
    if (editTitle) titleRef.current?.focus()
    if (editDesc) descRef.current?.focus()
  }, [editTitle, editDesc])

  const close = () => navigate(-1)

  const canEdit = !!user && (
    user.id === ticket?.created_by ||
    ticket?.assignees?.some((a) => a.user_id === user.id)
  )

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

  const assignees = ticket?.assignees?.map((a) => a.user) ?? []
  const tags = ticket?.tags?.map((t) => t.tag) ?? []

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 gap-4">
          {isLoading ? (
            <div className="h-6 w-48 bg-gray-200 rounded animate-pulse" />
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
              className="flex-1 text-lg font-semibold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent"
            />
          ) : (
            <h2
              className={`flex-1 text-lg font-semibold text-gray-900 ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`}
              onClick={() => canEdit && setEditTitle(true)}
            >
              {ticket?.title}
            </h2>
          )}

          <div className="flex items-center gap-2 flex-shrink-0">
            {canEdit && ticket && (
              <button
                onClick={handleDelete}
                className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
              >
                Sil
              </button>
            )}
            <button onClick={close} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 p-6 space-y-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : ticket ? (
          <div className="flex-1 overflow-y-auto scrollbar-thin flex">
            {/* Main */}
            <div className="flex-1 p-6 space-y-6 min-w-0 border-r border-gray-100">
              {/* Description */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Açıklama</h4>
                {editDesc && canEdit ? (
                  <textarea
                    ref={descRef}
                    value={descValue}
                    onChange={(e) => setDescValue(e.target.value)}
                    onBlur={() => {
                      setEditDesc(false)
                      if (descValue !== (ticket.description ?? ''))
                        handleUpdate({ description: descValue || null })
                    }}
                    rows={5}
                    className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                ) : (
                  <div
                    onClick={() => canEdit && setEditDesc(true)}
                    className={`text-sm text-gray-600 min-h-[60px] rounded-lg px-3 py-2 ${canEdit ? 'cursor-pointer hover:bg-gray-50' : ''} ${!ticket.description ? 'text-gray-300 italic' : ''}`}
                  >
                    {ticket.description || (canEdit ? 'Açıklama eklemek için tıklayın...' : 'Açıklama yok')}
                  </div>
                )}
              </div>

              {/* Tags */}
              {projectId && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Taglar</h4>
                  <TagSelector ticketId={ticket.id} projectId={projectId} assignedTags={tags} />
                </div>
              )}

              <AttachmentUpload ticketId={ticket.id} />
              <CommentSection ticketId={ticket.id} />
            </div>

            {/* Sidebar */}
            <div className="w-56 flex-shrink-0 p-4 space-y-5">
              {/* Status */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Durum</p>
                {canEdit && statuses ? (
                  <select
                    value={ticket.status_id ?? ''}
                    onChange={(e) => handleUpdate({ status_id: e.target.value || null })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Seçiniz —</option>
                    {statuses.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 text-sm px-2 py-1 rounded-lg font-medium"
                    style={{
                      backgroundColor: (ticket.status_info?.color ?? '#6b7280') + '22',
                      color: ticket.status_info?.color ?? '#6b7280',
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ticket.status_info?.color ?? '#6b7280' }} />
                    {ticket.status_info?.name ?? ticket.status}
                  </span>
                )}
              </div>

              {/* Priority */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Öncelik</p>
                {canEdit ? (
                  <select
                    value={ticket.priority}
                    onChange={(e) => handleUpdate({ priority: e.target.value as TicketPriority })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="low">Düşük</option>
                    <option value="medium">Orta</option>
                    <option value="high">Yüksek</option>
                    <option value="critical">Kritik</option>
                  </select>
                ) : (
                  <PriorityBadge priority={ticket.priority} size="md" />
                )}
              </div>

              {/* Assignees */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Atananlar</p>
                {assignees.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {assignees.map((u) => <UserAvatar key={u.id} user={u} size="sm" showName />)}
                  </div>
                )}
                <button
                  onClick={() => setShowAssignees(!showAssignees)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {showAssignees ? 'Kapat' : 'Düzenle'}
                </button>
                {showAssignees && (
                  <div className="mt-2">
                    <MultiAssigneeSelector ticketId={ticket.id} assignees={assignees} />
                  </div>
                )}
              </div>

              {/* Due Date */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Bitiş Tarihi</p>
                {canEdit ? (
                  <input
                    type="date"
                    value={ticket.due_date?.slice(0, 10) ?? ''}
                    onChange={(e) => handleUpdate({ due_date: e.target.value || null })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ) : ticket.due_date ? (
                  <span className="text-sm text-gray-700">{new Date(ticket.due_date).toLocaleDateString('tr-TR')}</span>
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </div>

              {/* Creator */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Oluşturan</p>
                {ticket.creator ? <UserAvatar user={ticket.creator} size="sm" showName /> : <span className="text-sm text-gray-400">—</span>}
              </div>

              {/* Created At */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Oluşturulma</p>
                <span className="text-xs text-gray-400">
                  {new Date(ticket.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">Ticket bulunamadı</div>
        )}
      </div>
    </div>
  )
}
