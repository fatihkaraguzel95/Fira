import { createElement } from 'react'
import { ICON_BOLD, type IconName } from './iconBold'
import { useFineIcons, useIconSet, type IconSet } from '../../hooks/useIconSet'

export type { IconName }

/**
 * The one way to draw an interface icon (#e8d26977).
 *
 * Icons used to be 24 px outlines from several hands shrunk to 12–14 px, each with its own
 * stroke width: at that size the lines fall between pixels and the detail closes up. Now every
 * icon comes from one of two sets, and the person picks which (Ayarlar › Görünüm › İkonlar):
 *  - `bold` (default): Lucide outlines, drawn with a 1.5 px line whatever the size;
 *  - `fine`: Fluent, drawn for the pixel grid it is shown on (16 px, and a separate 20 px
 *    drawing for the rail), with a 1 px line. Its drawings are a chunk of their own, fetched
 *    only by those who choose it; until it has arrived the bold drawing shows.
 * Use them at **16 or 20**; smaller is not legible. The one exception is a tick inside a small
 * box (a checkbox, a menu's "chosen" mark), which may be 12.
 *
 * `size` is in pixels at the default text size and is applied in rem, so icons grow with
 * Görünüm › Yazı boyutu like the text beside them. The colour is the text colour (`currentColor`):
 * give the icon a `text-*` class or let it inherit; do not dim it with opacity.
 * `set` forces one set (the picker's previews); everywhere else leave it out.
 * New icon: add it to scripts/gen-ui-icons.mjs (both sets) and run the script.
 */
export function Icon({ name, size = 16, className = '', set }: { name: IconName; size?: number; className?: string; set?: IconSet }) {
  const chosen = useIconSet()
  const fine = useFineIcons()
  const rem = `${size / 16}rem`
  const style = { width: rem, height: rem }
  const icon = (set ?? chosen) === 'fine' ? fine?.[name] : undefined
  if (!icon) {
    // 1.5 px at the size shown (2 px from 24 px up), expressed in the drawing's 24 units.
    const line = (Math.max(1.5, size / 12) * 24) / size
    return (
      <svg className={`flex-shrink-0 ${className}`} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={line} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICON_BOLD[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
      </svg>
    )
  }
  const large = size >= 20 && icon.d20 !== undefined
  const grid = large ? 20 : icon.g
  return (
    <svg className={`flex-shrink-0 ${className}`} style={style} viewBox={`0 0 ${grid} ${grid}`} fill="currentColor" aria-hidden>
      <path d={large ? icon.d20 : icon.d} />
    </svg>
  )
}
