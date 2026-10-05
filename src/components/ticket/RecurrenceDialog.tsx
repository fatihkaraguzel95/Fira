import { useMemo, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useT, useLang } from '../../i18n'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { isEditableTarget, blurAfterEscape } from '../../lib/keys'
import { DateInput } from '../ui/DateInput'
import { previewOccurrences, DEFAULT_TZ, type RecurrenceRule, type RecurrenceFreq } from '../../lib/recurrence'

/**
 * "Tekrarla…" penceresi (#59e0b75e, TK-4): bir görevi serinin şablonu yapar.
 * Kural sunucuda saklanır; buradaki önizleme istemcideki aynı motorla çizilir.
 */
const FREQS: RecurrenceFreq[] = ['daily', 'weekly', 'monthly', 'yearly']
const REMINDERS = [null, 15, 60, 120, 24 * 60] as const

/** ISO gün sırası: Pazartesi … Pazar. */
const DAYS = [1, 2, 3, 4, 5, 6, 7]

export function weekdayNames(lang: string, style: 'short' | 'long' = 'short') {
  const f = new Intl.DateTimeFormat(lang, { weekday: style })
  // 2026-09-21 pazartesi: ISO 1 = o gün.
  return DAYS.map((d) => f.format(new Date(Date.UTC(2026, 8, 20 + d))))
}

/** "Her cuma 12:00" gibi tek satırlık özet. */
export function describeRule(rule: RecurrenceRule, lang: string, t: (k: never, p?: Record<string, string | number>) => string): string {
  const names = weekdayNames(lang, 'long')
  const time = rule.at_time.slice(0, 5)
  const every = rule.interval > 1 ? String(rule.interval) : ''
  const key = `ticket.recur.summary.${rule.freq}${every ? 'N' : ''}` as never
  const days = (rule.byweekday?.length ? rule.byweekday : []).map((d) => names[d - 1]).join(', ')
  return t(key, { n: rule.interval, time, days, day: rule.bymonthday ?? 0 })
}

interface Props {
  title: string
  rule: RecurrenceRule | null
  canClear: boolean
  saving?: boolean
  onSave: (rule: RecurrenceRule) => void
  onClear: () => void
  onClose: () => void
}

export function RecurrenceDialog({ title, rule, canClear, saving, onSave, onClear, onClose }: Props) {
  const t = useT()
  const lang = useLang()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  const today = new Date().toISOString().slice(0, 10)
  const [freq, setFreq] = useState<RecurrenceFreq>(rule?.freq ?? 'weekly')
  const [interval, setInterval] = useState(rule?.interval ?? 1)
  const [weekdays, setWeekdays] = useState<number[]>(rule?.byweekday?.length ? rule.byweekday : [new Date().getDay() === 0 ? 7 : new Date().getDay()])
  const [monthday, setMonthday] = useState(rule?.bymonthday ?? new Date().getDate())
  const [atTime, setAtTime] = useState(rule?.at_time?.slice(0, 5) ?? '09:00')
  const [startsOn, setStartsOn] = useState(rule?.starts_on ?? today)
  const [endsOn, setEndsOn] = useState(rule?.ends_on ?? '')
  const [trigger, setTrigger] = useState(rule?.trigger ?? 'schedule')
  const [reminder, setReminder] = useState<number | null>(rule?.reminder_minutes ?? null)

  const draft: RecurrenceRule = useMemo(() => ({
    freq, interval: Math.max(1, interval), byweekday: freq === 'weekly' ? weekdays : null,
    bymonthday: freq === 'monthly' || freq === 'yearly' ? monthday : null,
    at_time: atTime, tz: rule?.tz ?? DEFAULT_TZ, starts_on: startsOn, ends_on: endsOn || null,
    trigger, reminder_minutes: reminder,
  }), [freq, interval, weekdays, monthday, atTime, startsOn, endsOn, trigger, reminder, rule?.tz])

  const preview = useMemo(() => previewOccurrences(draft, 3), [draft])
  const fmt = useMemo(() => new Intl.DateTimeFormat(lang, {
    timeZone: draft.tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }), [lang, draft.tz])
  const names = weekdayNames(lang)
  const valid = preview.length > 0 && (freq !== 'weekly' || weekdays.length > 0)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (isEditableTarget(e.target)) { blurAfterEscape(e.nativeEvent, e.target as HTMLElement); return }
    e.stopPropagation(); onClose()
  }

  const pill = (active: boolean) =>
    `px-2.5 h-8 rounded-lg text-sm border transition-colors cursor-pointer ${active
      ? 'bg-primary-50 dark:bg-primary-950/40 border-primary-300 dark:border-primary-800 text-primary-700 dark:text-primary-300 font-medium'
      : 'border-line text-fg-2 hover:bg-raised'}`

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} onKeyDown={onKeyDown}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('ticket.recur.title')} data-recur-dialog
        className="bg-surface rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col outline-none">
        <div className="px-5 py-4 border-b border-line-soft flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{t('ticket.recur.title')}</h2>
            <p className="text-xs text-fg-muted mt-0.5 truncate">{title}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('ticket.recur.freq')}</label>
            <div className="flex flex-wrap gap-1.5">
              {FREQS.map((f) => (
                <button key={f} type="button" onClick={() => setFreq(f)} className={pill(freq === f)} aria-pressed={freq === f}>
                  {t(`ticket.recur.freq.${f}` as never)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="recur-interval" className="text-sm text-fg-2">{t('ticket.recur.everyN')}</label>
            <input id="recur-interval" type="number" min={1} max={99} value={interval}
              onChange={(e) => setInterval(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
              className="w-16 h-8 px-2 text-sm rounded-lg bg-field border border-line text-fg" />
            <span className="text-sm text-fg-2">{t(`ticket.recur.unit.${freq}` as never, { n: interval })}</span>
          </div>

          {freq === 'weekly' && (
            <div>
              <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('ticket.recur.days')}</label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => (
                  <button key={d} type="button" aria-pressed={weekdays.includes(d)}
                    onClick={() => setWeekdays((w) => w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort())}
                    className={pill(weekdays.includes(d))}>{names[i]}</button>
                ))}
              </div>
            </div>
          )}

          {(freq === 'monthly' || freq === 'yearly') && (
            <div className="flex items-center gap-2">
              <label htmlFor="recur-monthday" className="text-sm text-fg-2">{t('ticket.recur.monthday')}</label>
              <input id="recur-monthday" type="number" min={1} max={31} value={monthday}
                onChange={(e) => setMonthday(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                className="w-16 h-8 px-2 text-sm rounded-lg bg-field border border-line text-fg" />
              <span className="text-xs text-fg-faint">{t('ticket.recur.monthdayHint')}</span>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="recur-time" className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('ticket.recur.at')}</label>
              <input id="recur-time" type="time" value={atTime} onChange={(e) => setAtTime(e.target.value || '09:00')}
                className="h-8 px-2 text-sm rounded-lg bg-field border border-line text-fg" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('ticket.recur.startsOn')}</label>
              <DateInput value={startsOn} onChange={(v) => setStartsOn(v || today)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('ticket.recur.endsOn')}</label>
              <DateInput value={endsOn} onChange={(v) => setEndsOn(v || '')} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('ticket.recur.trigger')}</label>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setTrigger('schedule')} aria-pressed={trigger === 'schedule'} className={pill(trigger === 'schedule')}>{t('ticket.recur.trigger.schedule')}</button>
              <button type="button" onClick={() => setTrigger('completion')} aria-pressed={trigger === 'completion'} className={pill(trigger === 'completion')}>{t('ticket.recur.trigger.completion')}</button>
            </div>
            <p className="text-xs text-fg-faint mt-1">{t(trigger === 'schedule' ? 'ticket.recur.trigger.scheduleHint' : 'ticket.recur.trigger.completionHint')}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('ticket.recur.reminder')}</label>
            <div className="flex flex-wrap gap-1.5">
              {REMINDERS.map((m) => (
                <button key={String(m)} type="button" onClick={() => setReminder(m)} aria-pressed={reminder === m} className={pill(reminder === m)}>
                  {m === null ? t('ticket.recur.reminder.none') : t('ticket.recur.reminder.before', { d: m < 60 ? `${m} dk` : m < 1440 ? `${m / 60} sa` : `${m / 1440} g` })}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-line-soft bg-raised/40 p-3">
            <p className="text-sm text-fg">{describeRule(draft, lang, t as never)}</p>
            <p className="text-xs text-fg-muted mt-1">
              {preview.length
                ? `${t('ticket.recur.next')}: ${preview.map((d) => fmt.format(d)).join(' · ')}`
                : t('ticket.recur.noneComing')}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-line-soft">
          <div>
            {canClear && (
              <button type="button" onClick={onClear} className="text-sm text-danger hover:underline px-1">{t('ticket.recur.stop')}</button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="text-sm text-fg-muted hover:text-fg-2 px-3 py-2">{t('common.cancel')}</button>
            <button type="button" onClick={() => onSave(draft)} disabled={!valid || saving}
              className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50" data-recur-save>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
