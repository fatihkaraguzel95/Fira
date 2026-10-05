import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../../../i18n'

/**
 * The whiteboard's floating chrome: Teams' layout — inking toolbar at the top,
 * the create panel on the left, zoom at the bottom right, the board menu at the
 * top right. Presentational only; WhiteboardCanvas owns the state.
 */

const P: Record<string, string> = {
  select: 'M6 3.5l12.5 6.8-5.6 1.7-2.6 5.8z',
  lasso: 'M7.2 16.6C4.8 15.5 3.5 13.7 3.5 11.6 3.5 7.9 7.3 5 12 5s8.5 2.9 8.5 6.6-3.8 6.6-8.5 6.6c-1.3 0-2.6-.2-3.7-.6M7.2 16.6c-.3 1.9.6 3.4 2.3 3.9',
  hand: 'M8 12.5V6a1.5 1.5 0 013 0v5.5m0-7a1.5 1.5 0 013 0v7m0-5.5a1.5 1.5 0 013 0v7.8A5.7 5.7 0 0111.3 20H11a5.7 5.7 0 01-4.9-2.8L3.8 13.4a1.5 1.5 0 012.6-1.5L8 14.3',
  eraser: 'M15.6 4.2l4.2 4.2a1.5 1.5 0 010 2.1L11.3 19H6.7l-2.5-2.5a1.5 1.5 0 010-2.1L13.5 4.2a1.5 1.5 0 012.1 0zM9 9.8l5.2 5.2M11.3 19H20',
  undo: 'M9 14L4 9l5-5M4.5 9H15a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M19.5 9H9a5 5 0 000 10h3',
  note: 'M4.5 4.5h15v10l-5 5h-10zM14.5 19.5v-5h5',
  text: 'M5.5 7V4.5h13V7M12 4.5v15M9 19.5h6',
  image: 'M4.5 5.5h15v13h-15zM4.5 15.5l4.5-4.5 4 4 2.5-2.5 4 4M15.2 9.2h.01',
  template: 'M4.5 4.5h6.5v6.5H4.5zM13 4.5h6.5v4H13zM13 10.5h6.5v9H13zM4.5 13h6.5v6.5H4.5z',
  zoomIn: 'M12 6v12M6 12h12',
  zoomOut: 'M6 12h12',
  fit: 'M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15',
  menu: 'M5 12h.01M12 12h.01M19 12h.01',
  trash: 'M5 7h14M10 11v6M14 11v6M6.5 7l.8 12a2 2 0 002 1.9h5.4a2 2 0 002-1.9l.8-12M9.5 7V4.5h5V7',
  duplicate: 'M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9',
  front: 'M8.5 8.5h11v11h-11zM4.5 15.5v-11h11',
  back: 'M4.5 4.5h11v11h-11zM19.5 8.5v11h-11',
  lock: 'M6.5 11h11v8.5h-11zM8.5 11V8a3.5 3.5 0 017 0v3',
  unlock: 'M6.5 11h11v8.5h-11zM8.5 11V8a3.5 3.5 0 016.8-1.2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bg: 'M4.5 4.5h15v15h-15zM8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
  download: 'M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14',
  upload: 'M12 15.5v-11M7.5 9L12 4.5 16.5 9M5 19.5h14',
  board: 'M4 5h16v11H4zM12 16v3M9 21l3-2 3 2',
  cursor: 'M6 3.5l12.5 6.8-5.6 1.7-2.6 5.8z',
  alignLeft: 'M4.5 6h15M4.5 10h9M4.5 14h15M4.5 18h9',
  alignCenter: 'M4.5 6h15M7.5 10h9M4.5 14h15M7.5 18h9',
  alignRight: 'M4.5 6h15M10.5 10h9M4.5 14h15M10.5 18h9',
  timer: 'M12 5.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM12 9v4l2.5 1.5M9.5 2.5h5',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 5.5v13l10.5-6.5z',
  close: 'M6 6l12 12M18 6L6 18',
  sound: 'M4.5 10v4h3l4.5 3.5v-11L7.5 10zM15.5 9.5a3.5 3.5 0 010 5M17.8 7a7 7 0 010 10',
  soundOff: 'M4.5 10v4h3l4.5 3.5v-11L7.5 10zM15.5 9.5l4.5 5M20 9.5l-4.5 5',
}

export function Icon({ name, className = 'w-5 h-5' }: { name: keyof typeof P | string; className?: string }) {
  if (name === 'shape') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3.5" y="11.5" width="8" height="8" rx="1" /><circle cx="16" cy="8" r="4.5" />
      </svg>
    )
  }
  if (name === 'reaction') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="8.5" /><path d="M8.5 14.3c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9.2 9.6h.01M14.8 9.6h.01" />
      </svg>
    )
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'menu' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? ''} />
    </svg>
  )
}

/** A pen in the tray, drawn in its own colour (rainbow / galaxy as their paint). */
export function PenGlyph({ color, kind, highlighter }: { color: string; kind?: string; highlighter?: boolean }) {
  const fill = kind === 'rainbow' ? 'url(#wb-ui-rainbow)' : kind === 'galaxy' ? '#3b2a9e' : color
  return (
    <svg className="w-6 h-7" viewBox="0 0 24 28" aria-hidden>
      <defs>
        <linearGradient id="wb-ui-rainbow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff3b3b" /><stop offset="0.3" stopColor="#ffe13b" /><stop offset="0.6" stopColor="#3bd16f" /><stop offset="1" stopColor="#7a5cff" />
        </linearGradient>
      </defs>
      {highlighter
        // Outline in the theme's text colour: a black pen stays visible on the dark toolbar.
        ? <path d="M8 26V13l2-4h4l2 4v13z" fill={fill} style={{ stroke: 'rgb(var(--c-fg-muted) / 0.7)' }} strokeWidth="1" />
        : <path d="M9 26V11l3-8 3 8v15z" fill={fill} style={{ stroke: 'rgb(var(--c-fg-muted) / 0.7)' }} strokeWidth="1" />}
      {kind === 'galaxy' && <><circle cx="11" cy="17" r="0.8" fill="#fff" /><circle cx="13" cy="21" r="0.6" fill="#fff" /></>}
      {kind === 'arrow' && <path d="M10 8l2-3 2 3" fill="none" stroke="#fff" strokeWidth="1.2" />}
    </svg>
  )
}

export function ToolButton({ label, active, onClick, children, disabled, badge, testId }: {
  label: string; active?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; badge?: ReactNode; testId?: string
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      data-wb-tool={testId}
      onClick={onClick}
      className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors disabled:opacity-35 disabled:pointer-events-none ${active ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-200' : 'text-fg-2 hover:bg-raised hover:text-fg'}`}
    >
      {children}
      {badge}
    </button>
  )
}

/** A floating panel (the popovers of the tray and the menu). Closes on outside click and Escape. */
export function Popover({ onClose, className = '', children, label }: { onClose: () => void; className?: string; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node) && !(e.target as Element)?.closest?.('[data-wb-popover-anchor]')) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true) }
  }, [onClose])
  return (
    <div ref={ref} role="dialog" aria-label={label} className={`absolute z-30 rounded-xl border border-line bg-surface shadow-lg p-2 ${className}`} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

export function Swatches({ colors, value, onPick, round = true, size = 'w-6 h-6', label }: { colors: string[]; value?: string | null; onPick: (c: string) => void; round?: boolean; size?: string; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {colors.map((c) => (
        <button key={c} type="button" onClick={() => onPick(c)} title={c} aria-label={c} aria-pressed={value?.toLowerCase() === c.toLowerCase()}
          className={`${size} ${round ? 'rounded-full' : 'rounded-md'} border transition-transform hover:scale-110 ${value?.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-surface border-transparent' : 'border-black/15'}`}
          style={{ background: c }} />
      ))}
    </div>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint mb-1.5 mt-1">{children}</p>
}

export function MenuItem({ icon, label, onClick, hint, danger }: { icon?: string; label: string; onClick: () => void; hint?: string; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={hint}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${danger ? 'text-danger hover:bg-danger/10' : 'text-fg-2 hover:bg-raised hover:text-fg'}`}>
      {icon && <Icon name={icon} className="w-4 h-4 flex-shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  )
}

export function useWbT() {
  return useT()
}
