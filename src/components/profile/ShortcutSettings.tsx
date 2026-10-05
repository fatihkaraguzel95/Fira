import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { SHORTCUTS, comboFromEvent, formatCombo, defaultBindings, type ShortcutAction } from '../../lib/shortcuts'
import { useShortcutBindings } from '../../hooks/useShortcuts'
import { useIsAdmin } from '../../hooks/useAdmin'
import { useT } from '../../i18n'
import { KeyChip } from '../shortcuts/KeyChip'
import { shortcutSections } from '../shortcuts/sections'

/**
 * Every shortcut, by section (the same list as the Ctrl+. dialog, #75dc7a96),
 * with a way to change it. "Change" listens for the next key press; Esc
 * cancels, Backspace clears. Conflicts are shown before they are saved.
 *
 * The registry only stores translation keys (see lib/shortcuts.ts); the labels
 * are resolved here, so switching language repaints the table.
 */
export function ShortcutSettings() {
  const t = useT()
  const { bindings, set, resetAll } = useShortcutBindings()
  const { data: isAdmin = false } = useIsAdmin()
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const defaults = defaultBindings()
  const sections = shortcutSections(bindings, { withUnbound: true, isAdmin: !!isAdmin, query })

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setCapturing(null); return }
      if (e.key === 'Backspace' || e.key === 'Delete') { set(capturing, ''); setCapturing(null); setMessage(t('settings.shortcut.removed')); return }
      const combo = comboFromEvent(e)
      if (!combo) return
      if (combo === 'f1') { setMessage(t('settings.shortcut.reservedF1')); return }
      const taken = SHORTCUTS.find((s) => s.id !== capturing && bindings[s.id] === combo)
      if (taken) { setMessage(t('settings.shortcut.taken', { combo: formatCombo(combo), label: t(taken.labelKey) })); return }
      set(capturing, combo)
      setCapturing(null)
      setMessage(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [capturing, bindings, set, t])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">{t('settings.shortcut.title')}</h3>
          <p className="text-xs text-fg-muted mt-0.5">{t('settings.shortcut.subtitle', { f1: formatCombo('f1') })}</p>
        </div>
        <button onClick={() => { resetAll(); setMessage(t('settings.shortcut.resetDone')) }} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised whitespace-nowrap">
          {t('settings.shortcut.defaults')}
        </button>
      </div>

      <label className="relative block">
        <span className="sr-only">{t('settings.shortcut.filterLabel')}</span>
        <Icon name="search" className="text-fg-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('settings.shortcut.filterLabel')}
          className="w-full h-9 pl-9 pr-3 rounded-lg bg-raised border border-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:border-line focus:bg-field" />
      </label>

      {message && <p className="text-xs text-warning" role="status">{message}</p>}
      {sections.length === 0 && <p className="text-sm text-fg-muted py-4 text-center">{t('settings.shortcut.noMatch')}</p>}

      {sections.map((s) => (
        <section key={s.id} className="space-y-1">
          <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider">{s.label}</p>
          {s.id === 'fixed' || s.id === 'editor' ? <p className="text-xs text-fg-muted pb-1">{t('settings.fixed.hint')}</p> : null}
          {s.rows.map((r, i) => {
            const action = r.action
            const changed = !!action && r.combo !== defaults[action]
            const isCapturing = !!action && capturing === action
            return (
              <div key={r.key} className={`flex items-center gap-3 py-2 ${i < s.rows.length - 1 ? 'border-b border-line-soft' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">{r.label}</p>
                  {r.hint && <p className="text-xs text-fg-muted">{r.hint}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isCapturing ? (
                    <span className="text-xs text-primary-600 dark:text-primary-400 font-medium animate-pulse">{t('settings.shortcut.pressKey')}</span>
                  ) : r.combo ? (
                    <KeyChip combo={r.combo} />
                  ) : (
                    <span className="text-xs text-fg-faint">{t('settings.shortcut.unbound')}</span>
                  )}
                  {action && (
                    <button onClick={() => { setCapturing(isCapturing ? null : action); setMessage(null) }} className="text-xs text-fg-muted hover:text-fg-2 px-1.5 py-1 rounded-md hover:bg-raised">
                      {isCapturing ? t('common.cancel') : t('settings.shortcut.change')}
                    </button>
                  )}
                  {action && changed && !isCapturing && (
                    <button onClick={() => set(action, null)} title={defaults[action] ? t('settings.shortcut.defaultIs', { combo: formatCombo(defaults[action]) }) : t('settings.shortcut.defaultNone')} className="text-xs text-fg-faint hover:text-fg-2 px-1.5 py-1 rounded-md hover:bg-raised">
                      {t('settings.shortcut.reset')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
