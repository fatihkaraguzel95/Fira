import { useEffect, useState } from 'react'
import { useDisplay, FONT_SIZES, type FontSize, type UiDensity } from '../../hooks/useDisplay'
import { isCelebrationEnabled, setCelebrationEnabled, celebrateTicket, celebrationKind, setCelebrationKind } from '../../lib/celebrate'
import type { ConfettiKind } from '../../lib/celebrate/confetti'
import { usePrefs, GLOBAL_SCOPE } from '../../hooks/usePrefs'
import { readPopupKeepOpen, type TicketViewMode } from '../ticket/ticketView'
import { useT, type TranslationKey } from '../../i18n'
import { Icon, type IconName } from '../ui/Icon'
import { useIconSet, setIconSet, loadFineIcons, ICON_SETS, type IconSet } from '../../hooks/useIconSet'

const ICON_LABELS: Record<IconSet, { label: TranslationKey; hint: TranslationKey }> = {
  bold: { label: 'settings.icons.bold', hint: 'settings.icons.boldHint' },
  fine: { label: 'settings.icons.fine', hint: 'settings.icons.fineHint' },
}
/** The picker shows each set with the same handful of icons, so the difference is the drawing alone. */
const ICON_SAMPLE: IconName[] = ['page', 'folder', 'list', 'chat', 'bell', 'settings', 'star', 'trash']

const DENSITY_OPTIONS: { id: UiDensity; labelKey: TranslationKey; hintKey: TranslationKey }[] = [
  { id: 'comfortable', labelKey: 'settings.density.comfortable', hintKey: 'settings.density.comfortableHint' },
  { id: 'compact', labelKey: 'settings.density.compact', hintKey: 'settings.density.compactHint' },
]
const FONT_LABELS: Record<FontSize, TranslationKey> = {
  sm: 'settings.fontSize.sm', md: 'settings.fontSize.md', lg: 'settings.fontSize.lg', xl: 'settings.fontSize.xl',
}
/** "Aa" örneğinin boyu: farkı gözle seçilsin diye kök ölçekten (15–18 px) biraz açık. */
const FONT_SAMPLE: Record<FontSize, number> = { sm: 13, md: 16, lg: 19, xl: 22 }

/** Görünüm sekmesinin iki başlığı (#9b2229bb, #118f5c53): yazı ve yoğunluk, davranış. */
function Group({ title, hint, first }: { title: string; hint: string; first?: boolean }) {
  return (
    <div className={first ? '' : 'border-t border-line pt-5'}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-faint">{title}</h3>
      <p className="text-xs text-fg-muted mt-0.5">{hint}</p>
    </div>
  )
}

const VIEW_OPTIONS: { id: TicketViewMode; labelKey: TranslationKey; hintKey: TranslationKey }[] = [
  { id: 'fullscreen', labelKey: 'common.fullscreen', hintKey: 'settings.ticketView.fullscreenHint' },
  { id: 'popup', labelKey: 'settings.ticketView.popup', hintKey: 'settings.ticketView.popupHint' },
]

/**
 * Görünüm (#118f5c53): Fira'nın nasıl göründüğü ve davrandığı, renkler dışında.
 * Renkler `ThemeSettings`'te (Temalar), denemesi süren özellikler `BetaSettings`'te.
 */
export function AppearanceSettings() {
  const t = useT()
  const [celebrate, setCelebrate] = useState(isCelebrationEnabled())
  const [confetti, setConfetti] = useState<ConfettiKind>(celebrationKind())
  const prefs = usePrefs(GLOBAL_SCOPE)
  const display = useDisplay()
  const iconSet = useIconSet()
  // The picker previews both sets: fetch the one that is not the default's drawings while this tab is open.
  useEffect(() => { void loadFineIcons() }, [])
  const ticketView: TicketViewMode = (prefs.prefs as { ticketView?: string }).ticketView === 'popup' ? 'popup' : 'fullscreen'
  const popupKeepOpen = readPopupKeepOpen(prefs.prefs)
  const codeLineNumbers = (prefs.prefs as { editor?: { lineNumbers?: unknown } }).editor?.lineNumbers === true

  return (
    <div className="space-y-4" data-settings-pane="appearance">
      <Group first title={t('settings.group.layout')} hint={t('settings.group.layoutHint')} />

      {/* İkon seti (#e8d26977): kalın (Lucide) ya da ince (Fluent); kişinin tercihi. */}
      <div>
        <p className="text-sm font-semibold text-fg">{t('settings.icons.title')}</p>
        <p className="text-xs text-fg-muted mt-0.5 mb-3">{t('settings.icons.subtitle')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="icon-set-picker">
          {ICON_SETS.map((id) => {
            const active = iconSet === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setIconSet(id)}
                aria-pressed={active}
                data-icon-set-option={id}
                className={`text-left rounded-xl border p-3 transition-colors ${active ? 'border-primary-500 ring-2 ring-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20' : 'border-line hover:border-fg-faint'}`}
              >
                <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5 text-fg-2" aria-hidden>
                  {ICON_SAMPLE.map((name) => <Icon key={name} name={name} set={id} />)}
                </div>
                <div className="flex items-center gap-1.5 mt-2 px-0.5">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${active ? 'border-primary-500 bg-primary-500' : 'border-line'}`}>
                    {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="text-sm font-medium text-fg">{t(ICON_LABELS[id].label)}</span>
                </div>
                <p className="text-xs text-fg-faint mt-0.5 px-0.5">{t(ICON_LABELS[id].hint)}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Yazı boyutu (#9b2229bb): kök ölçek, useDisplay. */}
      <div className="border-t border-line-soft pt-4">
        <p className="text-sm font-semibold text-fg">{t('settings.fontSize.title')}</p>
        <p className="text-xs text-fg-muted mt-0.5 mb-3">{t('settings.fontSize.subtitle')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="font-size-picker">
          {FONT_SIZES.map((id) => {
            const active = display.fontSize === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => display.setFontSize(id)}
                aria-pressed={active}
                data-font-size-option={id}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? 'border-primary-500 ring-2 ring-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20' : 'border-line hover:border-fg-faint'}`}
              >
                <span className="block font-semibold text-fg leading-none" style={{ fontSize: FONT_SAMPLE[id] }} aria-hidden>Aa</span>
                <span className="block text-xs text-fg-2 mt-1.5">{t(FONT_LABELS[id])}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Yoğunluk (#9b2229bb): pano kartı ve ağaç; listenin kendi seçimi ayrı. */}
      <div className="border-t border-line-soft pt-4">
        <p className="text-sm font-semibold text-fg">{t('settings.density.title')}</p>
        <p className="text-xs text-fg-muted mt-0.5 mb-3">{t('settings.density.subtitle')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="density-picker">
          {DENSITY_OPTIONS.map((o) => {
            const active = display.density === o.id
            const rows = o.id === 'compact' ? 5 : 3
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => display.setDensity(o.id)}
                aria-pressed={active}
                data-density-option={o.id}
                className={`text-left rounded-xl border p-3 transition-colors ${active ? 'border-primary-500 ring-2 ring-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20' : 'border-line hover:border-fg-faint'}`}
              >
                {/* küçük şema: aynı yükseklikte rahatta üç, sıkıda beş kart */}
                <div className={`w-full aspect-[16/9] rounded-lg overflow-hidden border border-line bg-app p-1.5 flex flex-col ${o.id === 'compact' ? 'gap-1' : 'gap-2'}`} aria-hidden>
                  {Array.from({ length: rows }, (_, i) => (
                    <div key={i} className="flex-1 rounded-md bg-surface border border-line flex items-center px-1.5">
                      <div className="h-[3px] rounded-full bg-fg-faint/60" style={{ width: `${[70, 50, 85, 60, 40][i]}%` }} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-2 px-0.5">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${active ? 'border-primary-500 bg-primary-500' : 'border-line'}`}>
                    {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="text-sm font-medium text-fg">{t(o.labelKey)}</span>
                </div>
                <p className="text-xs text-fg-faint mt-0.5 px-0.5">{t(o.hintKey)}</p>
              </button>
            )
          })}
        </div>
      </div>

      <Group title={t('settings.group.behavior')} hint={t('settings.group.behaviorHint')} />

      {/* Ticket window view — the same content, framed as a full page or a popup */}
      <div>
        <p className="text-sm font-semibold text-fg">{t('settings.ticketView.title')}</p>
        <p className="text-xs text-fg-muted mt-0.5 mb-3">{t('settings.ticketView.subtitle')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {VIEW_OPTIONS.map((o) => {
            const active = ticketView === o.id
            return (
              <button
                key={o.id}
                onClick={() => prefs.patch({ v: 1, ticketView: o.id })}
                aria-pressed={active}
                className={`text-left rounded-xl border p-3 transition-colors ${active ? 'border-primary-500 ring-2 ring-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20' : 'border-line hover:border-fg-faint'}`}
              >
                {/* tiny schematic: full-screen fills; popup is a centered card */}
                <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden border border-line bg-app">
                  {o.id === 'fullscreen' ? (
                    <div className="absolute inset-1.5 rounded-md bg-surface border border-line" />
                  ) : (
                    <div className="absolute inset-0 bg-black/10 dark:bg-black/40 flex items-center justify-center">
                      <div className="w-2/3 h-2/3 rounded-md bg-surface border border-line shadow-sm" />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-2 px-0.5">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${active ? 'border-primary-500 bg-primary-500' : 'border-line'}`}>
                    {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="text-sm font-medium text-fg">{t(o.labelKey)}</span>
                </div>
                <p className="text-xs text-fg-faint mt-0.5 px-0.5">{t(o.hintKey)}</p>
              </button>
            )
          })}
        </div>
        {/* Yalnız açılır pencerede anlamlı (#3a5b8d93): dışına tıklamak kapatsın mı. */}
        {ticketView === 'popup' && (
          <div className="mt-3 flex items-start gap-3" data-popup-outside>
            <button
              role="switch"
              aria-checked={!popupKeepOpen}
              aria-label={t('settings.ticketView.outsideClose')}
              onClick={() => prefs.patch({ v: 1, ticketPopupKeepOpen: popupKeepOpen ? null : true })}
              className={`w-9 h-5 rounded-full flex-shrink-0 transition-colors relative mt-0.5 ${!popupKeepOpen ? 'bg-primary-600' : 'bg-line'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${!popupKeepOpen ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">{t('settings.ticketView.outsideClose')}</p>
              <p className="text-xs text-fg-muted">{t('settings.ticketView.outsideCloseHint')}</p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line-soft pt-4 flex items-start gap-3">
        <button
          role="switch"
          aria-checked={celebrate}
          onClick={() => { const next = !celebrate; setCelebrate(next); setCelebrationEnabled(next) }}
          className={`w-9 h-5 rounded-full flex-shrink-0 transition-colors relative ${celebrate ? 'bg-primary-600' : 'bg-line'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${celebrate ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg">{t('settings.celebrate.title')}</p>
          <p className="text-xs text-fg-muted">{t('settings.celebrate.hint')}</p>
          {celebrate && (
            <div className="mt-2 space-y-2">
              {/* Two confetti animations to choose from; "Dene" plays the chosen
                  one inside a card-sized box, exactly as it plays on a card. */}
              <div className="flex flex-wrap gap-1.5">
                {(['a', 'b'] as ConfettiKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={confetti === k}
                    onClick={() => { setConfetti(k); setCelebrationKind(k) }}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                      confetti === k ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300' : 'border-line text-fg-2 hover:bg-raised'
                    }`}
                  >
                    {t(k === 'a' ? 'settings.celebrate.confettiA' : 'settings.celebrate.confettiB')}
                  </button>
                ))}
              </div>
              <div
                data-celebrate-demo
                data-ticket-id="demo-celebrate"
                className="relative overflow-hidden rounded-xl border border-line bg-surface px-3 py-3 w-56 max-w-full min-h-[104px]"
              >
                <p className="text-xs font-medium text-fg">{t('settings.celebrate.sampleCard')}</p>
                <p className="text-xs text-fg-faint mt-0.5">{t('settings.celebrate.sampleHint')}</p>
              </div>
              <button
                onClick={(e) => {
                  const card = e.currentTarget.parentElement?.querySelector('[data-celebrate-demo]')
                  celebrateTicket('demo', '#22c55e', card ?? e.currentTarget)
                }}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised"
              >
                {t('settings.celebrate.try')}
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Kod bloğunda satır numarası (#58789618): kullanıcının tercihi, her yerde
          (açıklama, yorum, sayfa) aynı anda geçerli. */}
      <div className="border-t border-line-soft pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-fg">{t('settings.codeLineNumbers.title')}</p>
            <p className="text-xs text-fg-muted mt-0.5">{t('settings.codeLineNumbers.subtitle')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={codeLineNumbers}
            data-testid="code-lineno"
            onClick={() => prefs.patch({ v: 1, editor: { lineNumbers: codeLineNumbers ? null : true } })}
            className={`flex-shrink-0 inline-flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border text-xs font-medium transition-colors cursor-pointer ${codeLineNumbers ? 'border-primary-500 bg-primary-600 text-white' : 'border-line bg-field text-fg-2 hover:border-fg-faint'}`}
          >
            <span className={`w-6 h-6 rounded-full transition-colors ${codeLineNumbers ? 'bg-white' : 'bg-fg-faint/40'}`} />
            {t(codeLineNumbers ? 'settings.toggle.on' : 'settings.toggle.off')}
          </button>
        </div>
      </div>
    </div>
  )
}
