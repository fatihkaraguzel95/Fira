import { useUsers } from '../../hooks/useUsers'
import { useAddAssignee, useRemoveAssignee } from '../../hooks/useTicketAssignees'
import type { Profile } from '../../types'
import { UserAvatar } from './UserAvatar'

interface Props {
  ticketId: string
  assignees: Profile[]
  teamMembers?: Profile[]
}

export function MultiAssigneeSelector({ ticketId, assignees, teamMembers }: Props) {
  const { data: allUsers } = useUsers()
  const addAssignee = useAddAssignee()
  const removeAssignee = useRemoveAssignee()

  const users = teamMembers ?? allUsers ?? []
  const assignedIds = new Set(assignees.map((u) => u.id))

  const toggle = (user: Profile) => {
    if (assignedIds.has(user.id)) {
      removeAssignee.mutate({ ticketId, userId: user.id })
    } else {
      addAssignee.mutateAsync({ ticketId, userId: user.id })
        .then(() => {
          // Send notification email (mailto fallback)
          if (user.email) {
            // In production: trigger Edge Function for email
            // For now: open mailto so the user can send manually
          }
        })
    }
  }

  return (
    <div className="space-y-2">
      {users.map((user) => (
        <label key={user.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded-lg px-2 py-1.5">
          <input
            type="checkbox"
            checked={assignedIds.has(user.id)}
            onChange={() => toggle(user)}
            className="rounded"
          />
          <UserAvatar user={user} size="sm" showName />
        </label>
      ))}
      {users.length === 0 && (
        <p className="text-xs text-gray-400">Kullanıcı bulunamadı</p>
      )}
    </div>
  )
}
