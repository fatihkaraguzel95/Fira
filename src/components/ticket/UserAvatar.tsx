import type { Profile } from '../../types'

interface Props {
  user: Profile | null
  size?: 'sm' | 'md' | 'lg'
  showName?: boolean
}

const sizes = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-10 h-10 text-base',
}

function getInitials(user: Profile): string {
  const name = user.full_name || user.email
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getColor(id: string): string {
  const colors = [
    'bg-blue-500',
    'bg-purple-500',
    'bg-green-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
  ]
  const idx = id.charCodeAt(0) % colors.length
  return colors[idx]
}

export function UserAvatar({ user, size = 'md', showName = false }: Props) {
  if (!user) return null

  return (
    <div className="flex items-center gap-2">
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt={user.full_name || user.email}
          className={`${sizes[size]} rounded-full object-cover flex-shrink-0`}
        />
      ) : (
        <div
          className={`${sizes[size]} ${getColor(user.id)} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}
        >
          {getInitials(user)}
        </div>
      )}
      {showName && (
        <span className="text-sm text-gray-700">{user.full_name || user.email}</span>
      )}
    </div>
  )
}
