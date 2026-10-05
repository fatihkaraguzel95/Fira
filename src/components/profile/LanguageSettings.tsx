import { LANGUAGES, setLang, useLang, useT } from '../../i18n'
import { useDateFormatSetting } from '../../hooks/useDateFormatPrefs'
import { useReading } from '../../hooks/useReading'
import { READ_LANGS, toggleReadLang } from '../../lib/reading'
import { Icon } from '../ui/Icon'
import { displayDate, displayTime, type DateFormatPrefs, type DateStyle, type MonthStyle, type DateOrder } from '../../lib/time'

/**
 * Language and date shape in one place — they are the two "how do I read this"
 * choices, and putting them side by side lets the language switch immediately
 * show its effect on the date samples below.
 *
 * Language is three plain rows rather than a dropdown: someone who has landed in
 * a language they cannot read needs to recognise their own, so every option is
 * written in its own language and always visible.
 *
 * The date section is built around a live preview. Nobody can picture the
 * difference between "compact" and "full" from the words; they can see it from
 * five real timestamps that change as they click.
 */

/** A row of segmented buttons — used for the month and order choices. */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { id: T; label: string; hint?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-start gap-3 flex-wrap">
      <span className="text-xs text-fg-muted w-16 flex-shrink-0 pt-1.5">{label}</span>
      <div className="flex flex-wrap gap-1 p-0.5 rounded-lg bg-raised border border-line-soft" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = o.id === value
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.hint}
              onClick={() => onChange(o.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                on ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg-2'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function LanguageSettings() {
  const t = useT()
  const lang = useLang()
  const { value, set, reset } = useDateFormatSetting()
  const { reading, loaded: readingLoaded, set: setReading } = useReading()

  // Fixed offsets from now, so the preview always shows the same five cases
  // whatever time of day it is opened.
  const now = new Date()
  const minus = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const samples: { key: Parameters<typeof t>[0]; iso: string; date?: boolean }[] = [
    { key: 'settings.date.sample.now', iso: minus(6 * 60_000) },
    { key: 'settings.date.sample.earlier', iso: minus(5 * 3_600_000) },
    { key: 'settings.date.sample.thisWeek', iso: minus(3 * 86_400_000) },
    { key: 'settings.date.sample.older', iso: minus(400 * 86_400_000) },
    { key: 'settings.date.sample.due', iso: minus(-9 * 86_400_000), date: true },
  ]

  const styles: { id: DateStyle; label: string; hint: string }[] = [
    { id: 'humanized', label: t('settings.date.style.humanized'), hint: t('settings.date.style.humanizedHint') },
    { id: 'compact', label: t('settings.date.style.compact'), hint: t('settings.date.style.compactHint') },
    { id: 'full', label: t('settings.date.style.full'), hint: t('settings.date.style.fullHint') },
  ]
  const isDefault = value.style === 'humanized' && value.month === 'name' && value.order === 'auto'

  return (
    <div className="space-y-8">
      {/* ── Language ───────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-fg">{t('settings.language.title')}</h3>
          <p className="text-xs text-fg-muted mt-0.5">{t('settings.language.subtitle')}</p>
        </div>

        <div className="grid gap-2" role="radiogroup" aria-label={t('settings.language.title')}>
          {LANGUAGES.map((l) => {
            const on = l.id === lang
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setLang(l.id)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  on ? 'border-primary-500 bg-primary-500/5' : 'border-line hover:bg-raised'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${on ? 'border-primary-500' : 'border-line'}`}
                  aria-hidden
                >
                  {on && <span className="w-2 h-2 rounded-full bg-primary-500" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{l.endonym}</span>
                  <span className="block text-xs text-fg-faint uppercase tracking-wider">{l.id}</span>
                </span>
                {on && (
                  <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 flex-shrink-0">
                    {t('settings.language.current')}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <p className="text-xs text-fg-muted">{t('settings.language.note')}</p>
        <p className="text-xs text-fg-muted">{t('settings.language.contentNote')}</p>
      </section>

      {/* ── Languages I read (113): kept with the account, the server prepares translations from it ── */}
      <section className="space-y-3 pt-2 border-t border-line-soft" data-reading>
        <div>
          <h3 className="text-sm font-semibold text-fg">{t('settings.reading.title')}</h3>
          <p className="text-xs text-fg-muted mt-0.5">{t('settings.reading.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('settings.reading.title')}>
          {READ_LANGS.map((l) => {
            const on = reading.read.includes(l.id)
            return (
              <button
                key={l.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={!readingLoaded}
                onClick={() => setReading(toggleReadLang(reading, l.id, lang))}
                data-read-lang={l.id}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors cursor-pointer disabled:opacity-50 ${
                  on ? 'border-primary-500 bg-primary-500/5 text-fg font-medium' : 'border-line text-fg-2 hover:bg-raised'
                }`}
              >
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${on ? 'border-primary-500 bg-primary-500 text-white' : 'border-line'}`} aria-hidden>
                  {on && <Icon name="check" />}
                </span>
                {l.endonym}
              </button>
            )
          })}
        </div>
        {reading.to ? (
          <label className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            <span>{t('settings.reading.to')}</span>
            <select
              value={reading.to}
              onChange={(e) => setReading({ read: reading.read, to: e.target.value })}
              data-read-to
              className="rounded-lg border border-line bg-field px-2 py-1.5 text-sm text-fg focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {READ_LANGS.filter((l) => reading.read.includes(l.id)).map((l) => <option key={l.id} value={l.id}>{l.endonym}</option>)}
            </select>
          </label>
        ) : (
          <p className="text-xs text-fg-muted" data-read-off>{readingLoaded ? t('settings.reading.off') : ''}</p>
        )}
        <p className="text-xs text-fg-muted">{t('settings.reading.note')}</p>
      </section>

      {/* ── Date and time ──────────────────────────────────────────────────── */}
      <section className="space-y-4 pt-2 border-t border-line-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">{t('settings.date.title')}</h3>
            <p className="text-xs text-fg-muted mt-0.5">{t('settings.date.subtitle')}</p>
          </div>
          {!isDefault && (
            <button
              type="button"
              onClick={reset}
              className="flex-shrink-0 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap"
            >
              {t('settings.date.reset')}
            </button>
          )}
        </div>

        {/* Style — each option shows what it does to the same "3 days ago" moment */}
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('settings.date.style')}>
          {styles.map((s) => {
            const on = s.id === value.style
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ style: s.id })}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  on ? 'border-primary-500 bg-primary-500/5' : 'border-line hover:bg-raised'
                }`}
              >
                <span className="block text-sm font-medium text-fg">{s.label}</span>
                <span className="block text-xs text-fg-faint mt-0.5 leading-snug">{s.hint}</span>
              </button>
            )
          })}
        </div>

        <div className="space-y-2.5">
          <Segmented<MonthStyle>
            label={t('settings.date.month')}
            value={value.month}
            onChange={(month) => set({ month })}
            options={[
              { id: 'name', label: t('settings.date.month.name') },
              { id: 'numeric', label: t('settings.date.month.numeric') },
            ]}
          />
          <Segmented<DateOrder>
            label={t('settings.date.order')}
            value={value.order}
            onChange={(order) => set({ order })}
            options={[
              { id: 'auto', label: t('settings.date.order.auto'), hint: t('settings.date.order.autoHint') },
              { id: 'dmy', label: t('settings.date.order.dmy') },
              { id: 'mdy', label: t('settings.date.order.mdy') },
            ]}
          />
        </div>

        {/* Live preview — the whole point of this screen */}
        <div className="rounded-xl border border-line bg-raised/50 overflow-hidden">
          <p className="px-3 py-2 text-xs font-semibold text-fg-faint uppercase tracking-wider border-b border-line-soft">
            {t('settings.date.preview')}
          </p>
          <ul className="divide-y divide-line-soft">
            {samples.map((s) => (
              <li key={s.key} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                <span className="text-xs text-fg-muted">{t(s.key)}</span>
                <span className="text-xs font-medium text-fg tabular-nums text-right">
                  {s.date ? displayDate(s.iso) : displayTime(s.iso, now)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

export type { DateFormatPrefs }
