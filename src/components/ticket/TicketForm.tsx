import { FormEvent, useRef, useState } from 'react'
import type { CreateTicketInput, TicketPriority, TicketStatus } from '../../types'
import { useCreateTicket } from '../../hooks/useTickets'
import { useUsers } from '../../hooks/useUsers'
import { DescriptionEditor } from './DescriptionEditor'

interface Props {
  onClose: () => void
  statuses: TicketStatus[]
  projectId: string
}

export function TicketForm({ onClose, statuses, projectId }: Props) {
  const { mutateAsync: createTicket, isPending } = useCreateTicket()
  const { data: users } = useUsers()

  // Temp id for image uploads before ticket exists
  const uploadId = useRef(crypto.randomUUID())

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusId, setStatusId] = useState(statuses[0]?.id ?? '')
  const [priority, setPriority] = useState<TicketPriority>('medium')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const input: CreateTicketInput = {
      title: title.trim(),
      description: description || undefined,
      status: statuses.find((s) => s.id === statusId)?.name ?? 'Yapılacak',
      status_id: statusId || null,
      priority,
      project_id: projectId,
      assignee_ids: assigneeIds,
      due_date: dueDate || null,
    }
    await createTicket(input)
    onClose()
  }

  const toggleAssignee = (uid: string) => {
    setAssigneeIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10 rounded-t-2xl">
          <h2 className="text-lg font-semibold text-gray-900">Yeni Ticket</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="flex">
            {/* Main column */}
            <div className="flex-1 p-6 space-y-5 border-r border-gray-100">
              {/* Title */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Başlık <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ticket başlığı..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Açıklama</label>
                <DescriptionEditor
                  value={description}
                  onChange={setDescription}
                  ticketId={uploadId.current}
                  placeholder="Detayları yazın… (Ctrl+V ile ekran görüntüsü ekleyebilirsiniz)"
                  minHeight="180px"
                />
              </div>
            </div>

            {/* Sidebar */}
            <div className="w-56 flex-shrink-0 p-5 space-y-5">
              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Durum</label>
                <select
                  value={statusId}
                  onChange={(e) => setStatusId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Öncelik</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">Düşük</option>
                  <option value="medium">Orta</option>
                  <option value="high">Yüksek</option>
                  <option value="critical">Kritik</option>
                </select>
              </div>

              {/* Assignees */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Atananlar</label>
                <div className="border border-gray-200 rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                  {users?.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={assigneeIds.includes(u.id)}
                        onChange={() => toggleAssignee(u.id)}
                        className="rounded accent-blue-500"
                      />
                      <span className="text-sm text-gray-700">{u.full_name || u.email}</span>
                    </label>
                  ))}
                  {!users?.length && <p className="text-xs text-gray-400">Kullanıcı yok</p>}
                </div>
              </div>

              {/* Due Date */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Bitiş Tarihi</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Oluşturuluyor…' : 'Oluştur'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
