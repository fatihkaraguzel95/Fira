import { useTheme, type ThemeMode } from '../../hooks/useTheme'
import { usePalette, PALETTES, type Palette } from '../../hooks/usePalette'
import { useT, type TranslationKey } from '../../i18n'

/**
 * Appearance picker. The little previews are drawn with literal colours on
 * purpose — they illustrate the light and dark themes side by side, so they must
 * not follow the current theme like the rest of the UI does.
 */
const LIGHT = { bg: '#f8fafc', card: '#ffffff', line: '#e2e8f0', text: '#94a3b8' }
const DARK = { bg: '#0f172a', card: '#111827', line: '#334155', text: '#64748b' }

function Preview({ half }: { half?: 'light' | 'dark' | 'both' }) {
  const box = (c: typeof LIGHT, clip?: string) => (
    <div className="absolute inset-0 flex gap-1 p-1.5" style={{ background: c.bg, clipPath: clip }}>
      <div className="w-1/4 rounded-md" style={{ background: c.card, border: `1px solid ${c.line}` }} />
      <div className="flex-1 flex flex-col gap-1">
        {[70, 100, 45].map((w, i) => (
          <div key={i} className="rounded-md" style={{ background: c.card, border: `1px solid ${c.line}`, height: 10, width: `${w}%` }}>
            <div className="m-[3px] h-[3px] rounded-full" style={{ background: c.text, width: '60%' }} />
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <div className="relative w-full aspect-[16/10] rounded-lg overflow-hidden border border-line">
      {half === 'dark' ? box(DARK) : box(LIGHT)}
      {half === 'both' && box(DARK, 'polygon(100% 0, 100% 100%, 0 100%)')}
    </div>
  )
}

// Translation keys, not text: these are evaluated once at import, so anything
// readable has to be resolved during render (see CLAUDE.md → Diller).
const OPTIONS: { id: ThemeMode; labelKey: TranslationKey; hintKey: TranslationKey; half: 'light' | 'dark' | 'both' }[] = [
  { id: 'light', labelKey: 'settings.theme.light', hintKey: 'settings.theme.lightHint', half: 'light' },
  { id: 'dark', labelKey: 'settings.theme.dark', hintKey: 'settings.theme.darkHint', half: 'dark' },
  { id: 'auto', labelKey: 'settings.theme.auto', hintKey: 'settings.theme.autoHint', half: 'both' },
]

/**
 * Renk paletlerinin küçük önizlemesi (#e8d26977). Önizleme — tema önizlemesi gibi —
 * bilerek sabit renklerle çizilir: seçili paleti değil, her paletin kendisini
 * göstermesi gerekiyor. Şu anki temayla (açık ya da koyu) çizilir; paletlerin iki
 * temaya da uyduğunu her önizlemede ikiye bölerek göstermek yerine tek bir cümle
 * söylüyor (kullanıcı, #9b2229bb).
 */
type Swatch = { nav: string; app: string; card: string; fg: string; line: string }
const PALETTE_SWATCH: Record<Palette, { light: Swatch; dark: Swatch }> = {
  default: { light: { nav: '#edf1f6', app: '#f8fafc', card: '#ffffff', fg: '#0f172a', line: '#e2e8f0' }, dark: { nav: '#070b14', app: '#111827', card: '#182030', fg: '#f3f4f6', line: '#374151' } },
  graphite: { light: { nav: '#efeff1', app: '#fafafa', card: '#ffffff', fg: '#18181b', line: '#e4e4e7' }, dark: { nav: '#09090b', app: '#18181b', card: '#202024', fg: '#f4f4f5', line: '#3f3f46' } },
  sand: { light: { nav: '#f0eeeb', app: '#fafaf9', card: '#ffffff', fg: '#1c1917', line: '#e7e5e4' }, dark: { nav: '#0e0c0b', app: '#1c1917', card: '#292524', fg: '#f5f5f4', line: '#44403c' } },
  midnight: { light: { nav: '#e5ecf7', app: '#f5f8fd', card: '#ffffff', fg: '#0c162d', line: '#dae3f0' }, dark: { nav: '#050914', app: '#0b1224', card: '#121c34', fg: '#ecf1fa', line: '#2a3a5e' } },
  contrast: { light: { nav: '#f0f0f0', app: '#ffffff', card: '#ffffff', fg: '#000000', line: '#767676' }, dark: { nav: '#0a0a0a', app: '#000000', card: '#121212', fg: '#ffffff', line: '#969696' } },
}
const PALETTE_KEYS: Record<Palette, { label: TranslationKey; hint: TranslationKey }> = {
  default: { label: 'settings.palette.default', hint: 'settings.palette.defaultHint' },
  graphite: { label: 'settings.palette.graphite', hint: 'settings.palette.graphiteHint' },
  sand: { label: 'settings.palette.sand', hint: 'settings.palette.sandHint' },
  midnight: { label: 'settings.palette.midnight', hint: 'settings.palette.midnightHint' },
  contrast: { label: 'settings.palette.contrast', hint: 'settings.palette.contrastHint' },
}

function PaletteHalf({ c }: { c: Swatch }) {
  return (
    <div className="flex-1 flex" style={{ background: c.app }}>
      <div className="w-1/4" style={{ background: c.nav }} />
      <div className="flex-1 p-1 flex flex-col gap-1">
        <div className="rounded-md p-[3px]" style={{ background: c.card, border: `1px solid ${c.line}` }}>
          <div className="h-[3px] rounded-full w-3/4" style={{ background: c.fg }} />
          <div className="h-[3px] rounded-full w-1/2 mt-[3px] opacity-50" style={{ background: c.fg }} />
        </div>
        <div className="rounded-md h-2" style={{ background: c.card, border: `1px solid ${c.line}` }} />
      </div>
    </div>
  )
}

function PalettePreview({ id, dark }: { id: Palette; dark: boolean }) {
  return (
    <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden border border-line flex">
      <PaletteHalf c={PALETTE_SWATCH[id][dark ? 'dark' : 'light']} />
    </div>
  )
}

/**
 * Temalar (#118f5c53): yalnız açık / koyu / otomatik ve renk paleti. Yazı boyutu,
 * yoğunluk ve davranış ayarları `AppearanceSettings`'te, denemesi süren özellikler
 * `BetaSettings`'te; buraya renk dışında bir ayar ekleme.
 */
export function ThemeSettings() {
  const t = useT()
  const { mode, isDark, setMode } = useTheme()
  const { palette, setPalette } = usePalette()

  return (
    <div className="space-y-4" data-settings-pane="theme">
      <div>
        <h4 className="text-sm font-semibold text-fg">{t('settings.theme.section')}</h4>
        <p className="text-xs text-fg-muted mt-0.5">{t('settings.theme.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {OPTIONS.map((o) => {
          const active = mode === o.id
          return (
            <button
              key={o.id}
              onClick={() => setMode(o.id)}
              aria-pressed={active}
              className={`text-left rounded-xl border p-2 transition-colors ${
                active ? 'border-primary-500 ring-2 ring-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20' : 'border-line hover:border-fg-faint'
              }`}
            >
              <Preview half={o.half} />
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

      {mode === 'auto' && (
        <p className="text-xs text-fg-muted">
          {t('settings.theme.deviceBefore')}
          <span className="font-medium text-fg-2">{t(isDark ? 'settings.theme.darkLower' : 'settings.theme.lightLower')}</span>
          {t('settings.theme.deviceAfter')}
        </p>
      )}

      {/* Renk paleti (#e8d26977): nötr yüzeylerin tonu, açık/koyu temadan bağımsız seçilir. */}
      <div className="border-t border-line-soft pt-4">
        <p className="text-sm font-semibold text-fg">{t('settings.palette.title')}</p>
        <p className="text-xs text-fg-muted mt-0.5">{t('settings.palette.subtitle')}</p>
        <p className="text-xs text-fg-muted mt-1 mb-3">{t('settings.palette.adapts')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="palette-picker">
          {PALETTES.map((id) => {
            const active = palette === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPalette(id)}
                aria-pressed={active}
                data-palette-option={id}
                className={`text-left rounded-xl border p-2 transition-colors ${active ? 'border-primary-500 ring-2 ring-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20' : 'border-line hover:border-fg-faint'}`}
              >
                <PalettePreview id={id} dark={isDark} />
                <div className="flex items-center gap-1.5 mt-2 px-0.5">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${active ? 'border-primary-500 bg-primary-500' : 'border-line'}`}>
                    {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="text-sm font-medium text-fg">{t(PALETTE_KEYS[id].label)}</span>
                </div>
                <p className="text-xs text-fg-faint mt-0.5 px-0.5">{t(PALETTE_KEYS[id].hint)}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
