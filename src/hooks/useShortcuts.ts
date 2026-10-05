import { useEffect, useMemo } from 'react'
import { usePrefs } from './usePrefs'
import { SHORTCUTS, defaultBindings, comboFromEvent, emitShortcut, type Bindings, type ShortcutAction } from '../lib/shortcuts'
import { isEditableTarget, wasHandled } from '../lib/keys'

/** The user's bindings (defaults overlaid with what they remapped). */
export function useShortcutBindings() {
  const prefs = usePrefs('global')
  const stored = (prefs.prefs as { shortcuts?: Partial<Record<ShortcutAction, string>> }).shortcuts
  const bindings = useMemo<Bindings>(() => ({ ...defaultBindings(), ...(stored ?? {}) }), [stored])

  const set = (action: ShortcutAction, keys: string | null) => {
    const next: Record<string, string | null> = { ...(stored ?? {}) }
    if (keys === null || keys === defaultBindings()[action]) next[action] = null // null deletes the key server-side
    else next[action] = keys
    prefs.patch({ v: 1, shortcuts: next })
  }
  const resetAll = () => prefs.patch({ v: 1, shortcuts: null })

  return { bindings, set, resetAll, loaded: prefs.loaded }
}

/**
 * One document-level listener for the whole app. Ignores keystrokes typed
 * into inputs and editors (a "/" in a comment must stay a "/"), anything a
 * component already handled, and modifier-only presses.
 */
export function useShortcuts() {
  const { bindings } = useShortcutBindings()

  useEffect(() => {
    const byCombo = new Map<string, ShortcutAction>()
    for (const s of SHORTCUTS) if (bindings[s.id]) byCombo.set(bindings[s.id], s.id)
    const anywhere = new Set(SHORTCUTS.filter((s) => s.anywhere).map((s) => s.id))

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || wasHandled(e) || e.repeat) return
      // Plain single-key shortcuts must never hijack browser combos like Ctrl+F.
      const combo = comboFromEvent(e)
      if (!combo) return
      const action = byCombo.get(combo)
      if (!action) return
      // In a field only the modifier combos flagged `anywhere` fire (the palette); a remapped bare key never does.
      if (isEditableTarget(e.target) && !(anywhere.has(action) && (e.ctrlKey || e.metaKey || e.altKey))) return
      if (emitShortcut(action)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [bindings])
}
