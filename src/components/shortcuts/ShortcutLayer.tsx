import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { useShortcutBindings } from '../../hooks/useShortcuts'
import { SHORTCUTS, formatCombo, isShownAndOnTop, type ShortcutAction } from '../../lib/shortcuts'
import { KeyChip } from './KeyChip'

interface Mark { rect: DOMRect; keys: { action: ShortcutAction; combo: string; label: string }[] }

/**
 * Hold F1 (#75dc7a96): a see-through layer over the whole window marks every
 * visible control that has a shortcut and shows its keys; letting go of F1
 * brings the screen back. Where a control sits is read from its
 * `data-shortcut` mark — the same mark the shortcut clicks — so the layer
 * never shows a key for something the key would not reach (covered by a
 * dialog, hidden, disabled). Each action is shown once, at its first visible
 * control. While it is up the layer takes the pointer (modal), not the keys.
 */
export function ShortcutLayer() {
  const t = useT()
  const { bindings } = useShortcutBindings()
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings
  const [marks, setMarks] = useState<Mark[] | null>(null)
  const chipRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const collect = (): Mark[] => {
      const byEl = new Map<HTMLElement, Mark>()
      const seen = new Set<ShortcutAction>()
      const els = [...document.querySelectorAll<HTMLElement>('[data-shortcut]')].filter((el) => isShownAndOnTop(el))
      for (const el of els) {
        for (const action of el.dataset.shortcut!.split(' ') as ShortcutAction[]) {
          const combo = bindingsRef.current[action]
          const def = SHORTCUTS.find((s) => s.id === action)
          if (!combo || !def || seen.has(action)) continue
          seen.add(action)
          const m = byEl.get(el) ?? { rect: el.getBoundingClientRect(), keys: [] }
          m.keys.push({ action, combo, label: t(def.labelKey) })
          byEl.set(el, m)
        }
      }
      return [...byEl.values()]
    }
    const hide = () => setMarks(null)
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== 'F1') return
      // Chrome would open its help page.
      e.preventDefault()
      if (!e.repeat) setMarks(collect())
    }
    const onUp = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); hide() } }
    const onVisibility = () => { if (document.hidden) hide() }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    // The key-up is lost when the window loses focus while F1 is held.
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [t])

  // Place the keys once their size is known, inside the window and clear of the
  // keys already placed (two small buttons side by side — the star and the link —
  // would otherwise hide each other's keys): under the control, above it, to its
  // right, to its left, then further down. The narrow rail on the left gets them beside it.
  useLayoutEffect(() => {
    if (!marks) return
    const vw = window.innerWidth, vh = window.innerHeight
    const placed: { l: number; t: number; r: number; b: number }[] = []
    const clash = (a: { l: number; t: number; r: number; b: number }) => placed.some((p) => a.l < p.r + 4 && p.l < a.r + 4 && a.t < p.b + 3 && p.t < a.b + 3)
    marks.forEach((m, i) => {
      const el = chipRefs.current[i]
      if (!el) return
      const w = el.offsetWidth, h = el.offsetHeight, r = m.rect
      const cx = r.left + r.width / 2 - w / 2, cy = r.top + r.height / 2 - h / 2
      const below = r.bottom + 4, above = r.top - 4 - h
      const tries: [number, number][] = r.right < 120
        ? [[r.right + 6, cy], [r.right + 6, r.bottom + 2], [r.right + 6, r.top - h - 2]]
        : [[cx, below], [cx, above], [r.right + 6, cy], [r.left - w - 6, cy], [cx, below + h + 4], [cx, below + 2 * (h + 4)]]
      const box = ([x, y]: [number, number]) => {
        const l = Math.min(Math.max(8, x), vw - w - 8), t = Math.min(Math.max(8, y), vh - h - 8)
        return { l, t, r: l + w, b: t + h }
      }
      const spot = tries.map(box).find((b) => !clash(b)) ?? box(tries[0])
      placed.push(spot)
      el.style.left = `${spot.l}px`
      el.style.top = `${spot.t}px`
      el.style.visibility = 'visible'
    })
  }, [marks])

  if (!marks) return null
  return createPortal(
    <div className="fixed inset-0 z-[400] bg-black/30 select-none" data-shortcut-layer role="presentation"
      onPointerDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
      {marks.map((m, i) => (
        <div key={i}>
          <div className="absolute rounded-lg ring-2 ring-primary-400 bg-primary-400/10" style={{ left: m.rect.left - 3, top: m.rect.top - 3, width: m.rect.width + 6, height: m.rect.height + 6 }} aria-hidden />
          <div ref={(el) => { chipRefs.current[i] = el }} className="absolute flex items-center gap-1" style={{ left: 0, top: 0, visibility: 'hidden' }}>
            {m.keys.map((k) => (
              <span key={k.action} title={k.label} className="shadow-lg rounded-full ring-1 ring-primary-400/70" data-layer-key={k.action}>
                <KeyChip combo={k.combo} compact />
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-surface/95 border border-line shadow-lg text-xs text-fg-2 whitespace-nowrap">
        {t('settings.shortcut.layerTitle', { key: formatCombo('f1') })}
        {bindings.shortcuts && <span className="text-fg-muted"> · {t('settings.shortcut.layerAll', { key: formatCombo(bindings.shortcuts) })}</span>}
      </div>
    </div>,
    document.body,
  )
}
