import { Icon } from '../ui/Icon'

/**
 * The small indicator glyphs of the new list (TL-13): description, files,
 * comments, blocked. From the interface icon set (#089a79f7); before that one
 * stroke set of their own instead of ≡ / 📎 / 💬 / ⏸, which rendered as emoji
 * at different sizes per platform.
 */
const NAMES = { desc: 'text', files: 'attach', comments: 'comment', blocked: 'ban' } as const

export type MetaKind = keyof typeof NAMES

export function MetaIcon({ kind, className = '' }: { kind: MetaKind; className?: string }) {
  return <Icon name={NAMES[kind]} className={className} />
}
