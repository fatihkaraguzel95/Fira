import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'
import { createPortal } from 'react-dom'
import { markHandled } from '../../lib/keys'

/**
 * One menu per tree row (team, folder, list, page — #1F44279C): the ⋯ button
 * and a right click open the same list of actions. It replaces the row's
 * hover icons and the "Liste ekle / Sayfa ekle" lines under each team.
 *
 * Rendered into <body> with fixed positioning: the sidebar clips overflow.
 * Keyboard: ↑/↓ move, Enter/Space run, Esc closes and returns focus to ⋯;
 * the context-menu key (Shift+F10) on a focused row opens it at the row.
 */
export interface RowMenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  danger?: boolean
  /** Draw a divider above this item. */
  separated?: boolean
}

export type MenuPos = { x: number; y: number; alignRight?: boolean }
type Pos = MenuPos

export function useRowMenu(items: RowMenuItem[], opts: { title?: string; label: string }) {
  const [pos, setPos] = useState<Pos | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const empty = items.length === 0
  const close = () => setPos(null)

  /**
   * Menü **tıklanan** düğmenin altında açılır, ref'in gösterdiğinin değil:
   * kenar çubuğu iki kez çiziliyor (masaüstü paneli + telefon çekmecesi), ref
   * son takılan kopyayı tutuyordu ve gizli kopyanın kutusu 0×0 olduğu için
   * menü ekranın sol üst köşesine düşüyordu (kullanıcı, 28 Eyl).
   */
  const openFrom = (el: HTMLButtonElement | null) => {
    const r = el?.getBoundingClientRect()
    if (!r || (!r.width && !r.height)) return
    triggerRef.current = el
    setPos({ x: r.right, y: r.bottom + 4, alignRight: true })
  }
  /** Menüyü başka bir elemanın altında aç (sütun başlığı gibi, #d8a62c6e). */
  const openAt = (el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect()
    if (!empty && r) setPos({ x: r.left, y: r.bottom + 4 })
  }
  const onContextMenu = (e: React.MouseEvent) => {
    if (empty) return
    e.preventDefault()
    e.stopPropagation()
    // The keyboard's menu key reports (0, 0): open at the row instead.
    if (e.clientX === 0 && e.clientY === 0) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setPos({ x: r.left + 24, y: r.bottom })
    } else setPos({ x: e.clientX, y: e.clientY })
  }

  const trigger = empty ? null : (
    <button
      ref={triggerRef}
      type="button"
      aria-label={opts.label}
      title={opts.label}
      aria-haspopup="menu"
      aria-expanded={!!pos}
      onClick={(e) => { e.stopPropagation(); pos ? close() : openFrom(e.currentTarget) }}
      // dnd-kit rows start a drag on pointer down; the button must not.
      onPointerDown={(e) => e.stopPropagation()}
      className={`tap w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-line/60 transition-colors ${pos ? 'bg-line/60 text-fg' : ''}`}
    >
      <Icon name="more" />
    </button>
  )

  const menu = pos && !empty ? (
    <MenuPopover pos={pos} items={items} title={opts.title} onClose={(refocus) => { close(); if (refocus) triggerRef.current?.focus() }} />
  ) : null

  // openFrom: kendi düğmesini çizen yer (görev penceresi başlığı) menüyü o düğmenin altında, sağa yaslı açar.
  return { open: !!pos, trigger, menu, openAt, openFrom, close, onContextMenu: empty ? undefined : onContextMenu }
}

/** Konumu verilen menü; `useRowMenu` ve konum çubuklarının menüsü (`treeMenus.tsx`) kullanır. */
export function MenuPopover({ pos, items, title, onClose }: { pos: Pos; items: RowMenuItem[]; title?: string; onClose: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  // Measure, then keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight, m = 8
    let left = pos.alignRight ? pos.x - w : pos.x
    let top = pos.y
    if (left + w > window.innerWidth - m) left = window.innerWidth - m - w
    if (top + h > window.innerHeight - m) top = Math.max(m, pos.y - h - (pos.alignRight ? 32 : 0))
    setPlace({ left: Math.max(m, left), top: Math.max(m, top) })
  }, [pos])

  // First item takes focus once the menu is placed (it is hidden while measured, and a hidden element cannot).
  useEffect(() => {
    if (place) ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [!!place]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); markHandled(e); onClose(true); return }
      if (e.key === 'Tab') { onClose(false); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
      const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      if (!list.length) return
      e.preventDefault(); e.stopPropagation()
      const i = list.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
      list[next].focus()
    }
    const onAway = () => onClose(false)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onAway)
    // Scrolling the tree would leave the menu floating next to the wrong row.
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(false) }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onAway)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: place?.left ?? pos.x, top: place?.top ?? pos.y, visibility: place ? 'visible' : 'hidden' }}
      className="fixed z-[95] min-w-[13rem] max-w-[18rem] bg-surface border border-line rounded-xl shadow-lg py-1 animate-fade-in"
    >
      {title && <p className="px-3 pt-1 pb-1.5 text-xs font-semibold text-fg-faint truncate">{title}</p>}
      {items.map((it) => (
        <div key={it.key}>
          {it.separated && <div className="h-px bg-line-soft my-1" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => { onClose(false); it.onSelect() }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors outline-none focus-visible:bg-raised hover:bg-raised ${it.danger ? 'text-danger' : 'text-fg-2 hover:text-fg'}`}
          >
            <span className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${it.danger ? '' : 'text-fg-muted'}`}>{it.icon}</span>
            <span className="truncate">{it.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

/**
 * Visibility of a row's ⋯: on hover/focus of the row, while open, and always on
 * touch screens (no hover there). `hoverClass` must be a literal like
 * 'group-hover/list:opacity-100' at the call site, so Tailwind sees it.
 */
export const rowMenuSlot = (hoverClass: string, open: boolean) =>
  `flex items-center transition-opacity ${open ? 'opacity-100' : `opacity-0 ${hoverClass} focus-within:opacity-100 [@media(hover:none)]:opacity-100`}`

// ── icons used by the tree menus ──
const icon = (name: IconName) => <Icon name={name} />
export const MenuIcons = {
  list: icon('list'),
  folder: icon('folder'),
  page: icon('pageAdd'),
  edit: icon('edit'),
  trash: icon('trash'),
  settings: icon('settings'),
  open: icon('open'),
  plus: icon('plus'),
  help: icon('help'),
  key: icon('key'),
  members: icon('users'),
  import: icon('import'),
  expand: icon('expandAll'),
  collapse: icon('collapseAll'),
  home: icon('home'),
  agent: icon('sparkle'),
  link: icon('link'),
  star: icon('star'),
}
