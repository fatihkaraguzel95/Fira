import type { Profile } from '../../types'
import { displayUrl } from '../../lib/storage'
import { useT } from '../../i18n'
import { useImageOk } from '../../hooks/useImageOk'
import { useAvatarColor } from '../../lib/avatarTone'

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
  const name = user.full_name || user.email || '?'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function UserAvatar({ user, size = 'md', showName = false }: Props) {
  const t = useT()
  const photo = useImageOk(user?.avatar_url)
  const tone = useAvatarColor(user?.id)
  if (!user) return null
  // Someone who only exists because their work was imported: dashed ring, so it
  // is obvious at a glance that this person has no account here (yet).
  const imported = user.source === 'import'
  const name = user.full_name || user.email || t('ticketExtra.unknownPerson')
  const title = imported
    ? user.imported_from
      ? t('ticketExtra.avatar.importedTitleFrom', { name, source: user.imported_from })
      : t('ticketExtra.avatar.importedTitle', { name })
    : undefined

  return (
    <div className="flex items-center gap-2" title={title}>
      {photo.ok ? (
        <img
          src={displayUrl(user.avatar_url) ?? ''}
          alt={user.full_name || user.email || ''}
          onError={photo.onError}
          className={`${sizes[size]} rounded-full object-cover flex-shrink-0 ${imported ? 'ring-1 ring-dashed ring-fg-faint opacity-80' : ''}`}
        />
      ) : (
        <div
          style={imported ? undefined : { backgroundColor: tone }}
          className={`${sizes[size]} ${imported ? 'bg-line text-fg-muted border border-dashed border-fg-faint' : 'text-white'} rounded-full flex items-center justify-center font-semibold flex-shrink-0`}
        >
          {getInitials(user)}
        </div>
      )}
      {showName && (
        <span className="text-sm text-fg-2">
          {user.full_name || user.email}
          {imported && <span className="text-fg-faint"> · {t('ticketExtra.avatar.noAccount')}</span>}
        </span>
      )}
    </div>
  )
}
