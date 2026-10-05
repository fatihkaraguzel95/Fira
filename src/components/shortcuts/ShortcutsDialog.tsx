import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useT } from '../../i18n'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { useShortcutBindings } from '../../hooks/useShortcuts'
import { useIsAdmin } from '../../hooks/useAdmin'
import { markHandled } from '../../lib/keys'
import { formatCombo } from '../../lib/shortcuts'
import { KeyChip } from './KeyChip'
import { shortcutSections } from './sections'

/**
 * Keyboard shortcuts at a glance (#75dc7a96, modelled on Teams' dialog): a
 * filter, collapsible sections, two columns of "what it does · keys". Read
 * only — keys are changed in Settings › Shortcuts ("Kısayolları düzenle").
 * Loaded lazily; the shortcut that opens it is in the main bundle.
 */
export function ShortcutsDialog({ onClose, onEdit }: { onClose: () => void; onEdit: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useDialogFocus(ref, true, () => inputRef.current)
  const { bindings } = useShortcutBindings()
  const { data: isAdmin = false } = useIsAdmin()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const sections = shortcutSections(bindings, { withUnbound: false, isAdmin: !!isAdmin, query })

  // Esc: first clears the filter, then closes (the dialog is the top overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation(); markHandled(e)
      if (query && document.activeElement === inputRef.current) setQuery('')
      else onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [query, onClose])

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" data-shortcuts-dialog
        className="bg-surface rounded-xl shadow-2xl border border-line-soft w-full max-w-4xl max-h-[88vh] flex flex-col outline-none">
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div>
            <h2 id="shortcuts-title" className="text-lg font-semibold text-fg">{t('settings.shortcut.title')}</h2>
            <p className="text-xs text-fg-muted mt-1">{t('settings.shortcut.dialogHint', { f1: formatCombo('f1') })}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}
            className="tap w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors flex-shrink-0">
            <Icon name="close" />
          </button>
        </div>

        <div className="px-6 pb-3 flex justify-end">
          <label className="relative w-full sm:w-72">
            <span className="sr-only">{t('settings.shortcut.filterLabel')}</span>
            <Icon name="search" className="text-fg-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('settings.shortcut.filterLabel')} data-shortcuts-filter
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-raised border border-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:border-line focus:bg-field" />
          </label>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2">
          {sections.length === 0 && <p className="text-sm text-fg-muted py-8 text-center">{t('settings.shortcut.noMatch')}</p>}
          {sections.map((s, i) => {
            const open = !!query || !collapsed[s.id]
            return (
              <section key={s.id} className={i > 0 ? 'border-t border-line-soft' : ''} data-shortcut-section={s.id}>
                <h3>
                  <button type="button" aria-expanded={open} onClick={() => setCollapsed((c) => ({ ...c, [s.id]: open }))}
                    className="w-full flex items-center gap-2 py-3 text-sm font-semibold text-fg hover:text-fg-2 text-left">
                    <Icon name="chevronDown" className={`text-fg-muted transition-transform ${open ? '' : '-rotate-90'}`} />
                    {s.label}
                  </button>
                </h3>
                {open && (
                  <ul className="grid md:grid-cols-2 gap-x-10 pb-3 pl-6">
                    {s.rows.map((r) => (
                      <li key={r.key} className="flex items-center justify-between gap-4 py-1.5 min-h-[2.5rem]">
                        <span className="text-sm text-fg-2 min-w-0" title={r.hint}>{r.label}</span>
                        <KeyChip combo={r.combo} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>

        <div className="px-6 py-3 border-t border-line-soft flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <button type="button" onClick={onEdit} className="font-medium text-primary-600 dark:text-primary-400 hover:underline">{t('settings.shortcut.edit')}</button>
          <span className="text-fg-faint">{t('settings.shortcut.editHint')}</span>
        </div>
      </div>
    </div>
  )
}
