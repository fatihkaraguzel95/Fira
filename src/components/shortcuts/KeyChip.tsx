import { comboParts } from '../../lib/shortcuts'

/**
 * A key combination as a pill (#75dc7a96, like Teams' shortcut list):
 * "ctrl+shift+1" → Ctrl + Shift + 1. Several combos separated by spaces
 * ("arrowup arrowdown enter") are shown side by side, without a "+".
 */
export function KeyChip({ combo, compact = false }: { combo: string; compact?: boolean }) {
  const combos = combo.split(' ').filter(Boolean)
  return (
    <span className={`inline-flex items-center justify-center gap-1 rounded-full bg-raised text-fg-2 whitespace-nowrap ${compact ? 'h-6 px-2 text-2xs font-semibold' : 'h-7 px-3 min-w-[7.5rem] text-xs font-medium'}`}>
      {combos.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="w-1" aria-hidden />}
          {comboParts(c).map((p, j) => (
            <span key={j} className="inline-flex items-center gap-1">
              {j > 0 && <span className="text-fg-faint" aria-hidden>+</span>}
              <span>{p}</span>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}
