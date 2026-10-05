import { CHANGELOG } from '../../changelog'
import { ReleaseBody } from '../ChangelogModal'
import { FiraMark } from '../ui/Logo'
import { displayDate, useDateFormat } from '../../lib/time'
import { releasesInRange, type ReleaseState } from '../../lib/releaseNote'
import { useT } from '../../i18n'

/** A long absence is still one screen: the newest few in full, the rest behind the button. */
const SHOWN = 5

/**
 * What changed since the account last looked — the detail of the inbox's
 * release row (#2aa4f068). Loaded lazily (it carries the release notes); the
 * notes themselves are historical entries, written once, in Turkish.
 */
export default function ReleaseNotes({ state, onShowAll }: { state: ReleaseState; onShowAll: () => void }) {
  const t = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const releases = releasesInRange(CHANGELOG, state)
  const shown = releases.slice(0, SHOWN)
  const date = (iso: string) => displayDate(iso + 'T00:00:00')
  return (
    <article data-release-notes className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-raised flex items-center justify-center flex-shrink-0"><FiraMark size={22} className="text-fg" /></span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-fg">{t('inbox.release.title', { version: state.version })}</h3>
          <p className="text-xs text-fg-muted">
            {releases.length > 1
              ? t('inbox.release.range', { from: state.from, n: releases.length })
              : releases[0] ? date(releases[0].date) : t('inbox.release.none')}
          </p>
        </div>
      </header>

      {shown.map((r) => (
        <section key={r.version} data-release={r.version} className="rounded-xl border border-line-soft bg-surface px-4 py-3.5 space-y-3">
          {releases.length > 1 && (
            <p className="flex items-baseline gap-2">
              <span className="text-sm font-bold text-fg">v{r.version}</span>
              <span className="text-xs text-fg-muted">{date(r.date)}</span>
            </p>
          )}
          {r.summary && <p className="text-sm text-fg-2 leading-relaxed">{r.summary}</p>}
          <ReleaseBody release={r} />
        </section>
      ))}

      {releases.length > shown.length && (
        <p className="text-xs text-fg-muted">{t('inbox.release.more', { n: releases.length - shown.length })}</p>
      )}

      <button
        type="button"
        onClick={onShowAll}
        data-release-all
        className="w-full rounded-lg border border-line bg-surface hover:bg-raised text-sm font-medium text-fg-2 hover:text-fg py-2 transition-colors cursor-pointer"
      >
        {t('inbox.release.all')}
      </button>
    </article>
  )
}
