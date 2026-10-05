import { useEffect, useRef, useState } from 'react'
import { Icon } from './ui/Icon'
import { displayDate, useDateFormat } from '../lib/time'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { CHANGELOG, type ChangelogEntry, type ChangelogRelease } from '../changelog'
import { useT } from '../i18n'

const COLLAPSE_AFTER = 6 // items shown before the "show more" button

/**
 * The dialog chrome follows the interface language; the release notes inside it
 * do not. They are historical entries in changelog.ts, written once, in Turkish.
 */
function formatDate(iso: string) {
  return displayDate(iso + 'T00:00:00')
}

// ─── One list (features or fixes) with major/minor rendering + read-more ───────
function EntryList({ entries, tone }: { entries: ChangelogEntry[]; tone: 'feature' | 'fix' }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const majors = entries.filter(e => e.major)
  const minors = entries.filter(e => !e.major)
  const visibleMinors = expanded ? minors : minors.slice(0, COLLAPSE_AFTER)
  const hidden = minors.length - visibleMinors.length
  const dot = tone === 'feature' ? 'bg-primary-500' : 'bg-success'

  return (
    <div className="space-y-3">
      {majors.map((e, i) => (
        <div key={i} className="rounded-xl border border-line bg-raised/60 px-4 py-3">
          <p className="text-sm font-semibold text-fg">{e.title}</p>
          {e.description && <p className="text-xs text-fg-muted mt-1 leading-relaxed">{e.description}</p>}
        </div>
      ))}
      {visibleMinors.length > 0 && (
        <ul className="space-y-1.5">
          {visibleMinors.map((e, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-fg-2 leading-snug">
              <span className={`mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
              <span>{e.title}</span>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          {t('misc.changelog.showMore', { n: hidden })}
        </button>
      )}
      {expanded && minors.length > COLLAPSE_AFTER && (
        <button type="button" onClick={() => setExpanded(false)} className="text-xs text-fg-muted hover:underline">
          {t('misc.changelog.showLess')}
        </button>
      )}
    </div>
  )
}

// ─── The two lists of one release (also the inbox's release row, #2aa4f068) ───
export function ReleaseBody({ release }: { release: ChangelogRelease }) {
  const t = useT()
  return (
    <div className="space-y-5">
      {release.features.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400 mb-2">
            {t('misc.changelog.features')}
          </h4>
          <EntryList entries={release.features} tone="feature" />
        </div>
      )}
      {release.fixes.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-success mb-2">
            {t('misc.changelog.fixes')}
          </h4>
          <EntryList entries={release.fixes} tone="fix" />
        </div>
      )}
    </div>
  )
}

// ─── One release ──────────────────────────────────────────────────────────────
function Release({ release, latest, defaultOpen }: { release: ChangelogRelease; latest: boolean; defaultOpen: boolean }) {
  const t = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-line-soft last:border-0 pb-5 last:pb-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 text-left group"
      >
        <span className="text-base font-bold text-fg">v{release.version}</span>
        {latest && (
          <span className="text-2xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary-600 text-white">
            {t('misc.changelog.current')}
          </span>
        )}
        <span className="text-xs text-fg-muted">{formatDate(release.date)}</span>
        <Icon name="chevronRight" className={`ml-auto text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {release.summary && <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">{release.summary}</p>}

      {open && <div className="mt-4"><ReleaseBody release={release} /></div>}
    </section>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void
}

export function ChangelogModal({ onClose }: Props) {
  const t = useT()
  const shellRef = useRef<HTMLDivElement>(null)
  useDialogFocus(shellRef)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={shellRef} role="dialog" aria-modal="true" aria-label={t('misc.changelog.badge')} className="bg-surface rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] border border-line-soft outline-none">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-line-soft flex items-start justify-between gap-4">
          <div>
            <span className="inline-block text-xs font-semibold tracking-widest uppercase text-primary-600 dark:text-primary-400 mb-1">
              {t('misc.changelog.badge')}
            </span>
            <h2 className="text-xl font-bold text-fg">{t('misc.changelog.title')}</h2>
            <p className="text-sm text-fg-muted mt-1">{t('misc.changelog.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors flex-shrink-0"
          >
            <Icon name="close" />
          </button>
        </div>

        {/* Releases: latest expanded, older collapsed */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-thin">
          {CHANGELOG.map((r, i) => (
            <Release key={r.version} release={r} latest={i === 0} defaultOpen={i === 0} />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line-soft">
          <button
            onClick={onClose}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium text-sm py-2.5 rounded-xl transition-colors"
          >
            {t('misc.changelog.gotIt')}
          </button>
        </div>
      </div>
    </div>
  )
}
