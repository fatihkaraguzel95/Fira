import { useIsFavorite, useToggleFavorite, type FavKind } from '../../lib/favorites'
import { Icon } from './Icon'
import { useT } from '../../i18n'

/** A star that pins the thing to the sidebar's Favoriler (#D6B3097E); filled when it is there. */
export function FavoriteStar({ kind, id, className = '', shortcut }: { kind: FavKind; id: string; className?: string; /** `data-shortcut` (açık görev/sayfa: "favorite"). */ shortcut?: string }) {
  const t = useT()
  const on = useIsFavorite(kind, id)
  const toggle = useToggleFavorite()
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggle(kind, id) }}
      aria-pressed={on}
      data-shortcut={shortcut}
      aria-label={on ? t('board.fav.remove') : t('board.fav.add')}
      title={on ? t('board.fav.remove') : t('board.fav.add')}
      className={`tap inline-flex items-center justify-center min-w-6 h-6 px-1 rounded-md transition-colors flex-shrink-0 ${on ? 'text-warning' : 'text-fg-faint hover:text-warning'} ${className}`}
    >
      <Icon name="star" />
    </button>
  )
}
