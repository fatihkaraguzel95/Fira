import type { CSSProperties } from 'react'
import { thumbUrl } from '../../lib/image'
import type { TranslationKey } from '../../i18n'
import { Icon, type IconName } from './Icon'

/**
 * Preset marks a list or folder can carry. A list stores the KEY, so keys never change; the drawing
 * comes from the interface icon set (`Icon`, same key). The label is a translation key, not a word:
 * this map is built once at import, so a translated string here would freeze the language for the session.
 */
export const LIST_ICONS = {
  list: { labelKey: 'team.listIcon.list' },
  clipboard: { labelKey: 'team.listIcon.clipboard' },
  folder: { labelKey: 'team.listIcon.folder' },
  code: { labelKey: 'team.listIcon.code' },
  bug: { labelKey: 'team.listIcon.bug' },
  rocket: { labelKey: 'team.listIcon.rocket' },
  star: { labelKey: 'team.listIcon.star' },
  flag: { labelKey: 'team.listIcon.flag' },
  bolt: { labelKey: 'team.listIcon.bolt' },
  briefcase: { labelKey: 'team.listIcon.briefcase' },
  chart: { labelKey: 'team.listIcon.chart' },
  chat: { labelKey: 'team.listIcon.chat' },
  cog: { labelKey: 'team.listIcon.cog' },
  globe: { labelKey: 'team.listIcon.globe' },
  heart: { labelKey: 'team.listIcon.heart' },
  home: { labelKey: 'team.listIcon.home' },
  layers: { labelKey: 'team.listIcon.layers' },
  bulb: { labelKey: 'team.listIcon.bulb' },
  lock: { labelKey: 'team.listIcon.lock' },
  mail: { labelKey: 'team.listIcon.mail' },
  shield: { labelKey: 'team.listIcon.shield' },
  tag: { labelKey: 'team.listIcon.tag' },
  users: { labelKey: 'team.listIcon.users' },
  wrench: { labelKey: 'team.listIcon.wrench' },
  calendar: { labelKey: 'team.listIcon.calendar' },
  book: { labelKey: 'team.listIcon.book' },
  cart: { labelKey: 'team.listIcon.cart' },
  cloud: { labelKey: 'team.listIcon.cloud' },
  database: { labelKey: 'team.listIcon.database' },
  gift: { labelKey: 'team.listIcon.gift' },
  megaphone: { labelKey: 'team.listIcon.megaphone' },
  palette: { labelKey: 'team.listIcon.palette' },
  puzzle: { labelKey: 'team.listIcon.puzzle' },
  truck: { labelKey: 'team.listIcon.truck' },
  beaker: { labelKey: 'team.listIcon.beaker' },
} satisfies Partial<Record<IconName, { labelKey: TranslationKey }>>
export const ICON_KEYS = Object.keys(LIST_ICONS) as (keyof typeof LIST_ICONS)[]
export const DEFAULT_LIST_ICON = 'list' as const
export const DEFAULT_FOLDER_ICON = 'folder' as const

const isListIcon = (name: string): name is keyof typeof LIST_ICONS => name in LIST_ICONS

export function ListIcon({ name, size = 16, className = '' }: { name?: string | null; size?: number; className?: string }) {
  return <Icon name={name && isListIcon(name) ? name : DEFAULT_LIST_ICON} size={size} className={className} />
}

interface AvatarProps {
  icon?: string | null
  iconUrl?: string | null
  color?: string | null   // hex from the team palette
  size?: 'sm' | 'md' | 'lg'
  fallbackIcon?: string
  className?: string
}

/** Square avatar for a list/folder: uploaded logo, or preset icon on a tinted background. */
export function ListAvatar({ icon, iconUrl, color, size = 'sm', fallbackIcon = DEFAULT_LIST_ICON, className = '' }: AvatarProps) {
  const box = size === 'lg' ? 'w-10 h-10 rounded-xl' : size === 'md' ? 'w-7 h-7 rounded-lg' : 'w-5 h-5 rounded-md'
  // 16 px even in the smallest box: the 12 px glyph it had was the least legible icon in the tree.
  const glyph = size === 'lg' ? 20 : 16
  const style: CSSProperties | undefined = color ? ({ '--c': color } as CSSProperties) : undefined
  return (
    <span
      className={`${box} flex-shrink-0 flex items-center justify-center overflow-hidden ${color ? 'list-avatar-dyn' : 'bg-raised text-fg-muted'} ${className}`}
      style={style}
    >
      {iconUrl ? (
        <img
          src={thumbUrl(iconUrl, 96)}
          alt=""
          // Not lazy (#20c4ed37): a 7 kB thumbnail the browser already holds should be
          // there in the same frame as the row, not pop in after it.
          decoding="async"
          // Fall back to the original if this install has no image transform.
          onError={(e) => { const img = e.currentTarget; if (img.src !== iconUrl) img.src = iconUrl }}
          className="w-full h-full object-cover"
        />
      ) : (
        <ListIcon name={icon ?? fallbackIcon} size={glyph} />
      )}
    </span>
  )
}
