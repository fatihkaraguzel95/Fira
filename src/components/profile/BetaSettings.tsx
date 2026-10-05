import { useShell } from '../../hooks/useShell'
import { Icon } from '../ui/Icon'
import { useBeta, type BetaFeature } from '../../hooks/useBeta'
import { DrawingIcon, WhiteboardIcon } from '../page/PageTree'
import { useT } from '../../i18n'

const SWITCH = 'flex-shrink-0 inline-flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border text-xs font-medium transition-colors cursor-pointer disabled:opacity-50'
const switchTone = (on: boolean) => (on ? 'border-primary-500 bg-primary-600 text-white' : 'border-line bg-field text-fg-2 hover:border-fg-faint')

function BetaRow({ icon, title, hint, on, disabled, onToggle, attrs }: {
  icon: React.ReactNode
  title: string
  hint: string
  on: boolean
  disabled?: boolean
  onToggle: () => void
  attrs?: Record<string, string>
}) {
  const t = useT()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="mt-0.5 text-fg-muted">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm text-fg">{title} <span className="ml-1 text-2xs font-semibold px-1.5 py-0.5 rounded-md bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">{t('canvas.beta')}</span></p>
          <p className="text-xs text-fg-muted mt-0.5">{hint}</p>
        </div>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={title} disabled={disabled} onClick={onToggle} className={`${SWITCH} ${switchTone(on)}`} {...attrs}>
        <span className={`w-6 h-6 rounded-full transition-colors ${on ? 'bg-white' : 'bg-fg-faint/40'}`} />
        {t(on ? 'settings.toggle.on' : 'settings.toggle.off')}
      </button>
    </div>
  )
}

const ShellIcon = (
  <Icon name="shell" />
)

/**
 * Beta özellikler (#118f5c53): denemesi süren her şey tek sekmede, hepsi varsayılan kapalı.
 *  - Yeni kabuk (#1aae9955): tercih temanın kendisi gibi localStorage'ta, kabuk ilk
 *    boyamadan önce uygulanmalı.
 *  - Çizim ve whiteboard (#cf0c7678): ayrı ayrı açılır. Ayar sunucudaki tercihte; RLS de
 *    aynı anahtara bakıyor (096), yani kapalıyken bu öğeler hiçbir yerde gelmiyor.
 * Yeni bir beta anahtarı buraya satır olarak eklenir, Temalar'a ya da Görünüm'e değil.
 */
export function BetaSettings() {
  const t = useT()
  const shell = useShell()
  const beta = useBeta()
  const canvases: { id: BetaFeature; icon: React.ReactNode; title: string; hint: string }[] = [
    { id: 'drawing', icon: <DrawingIcon />, title: t('settings.beta.drawing'), hint: t('settings.beta.drawingHint') },
    { id: 'whiteboard', icon: <WhiteboardIcon />, title: t('settings.beta.whiteboard'), hint: t('settings.beta.whiteboardHint') },
  ]
  return (
    <div className="space-y-4" data-settings-pane="beta" data-testid="beta-features">
      <p className="text-xs text-fg-muted">{t('settings.beta.intro')}</p>

      <BetaRow
        icon={ShellIcon}
        title={t('settings.softShell.title')}
        hint={t('settings.softShell.subtitle')}
        on={shell.soft}
        onToggle={() => shell.setMode(shell.soft ? 'classic' : 'soft')}
        attrs={{ 'data-testid': 'soft-shell' }}
      />

      <div className="border-t border-line-soft pt-4">
        <p className="text-sm font-semibold text-fg">{t('settings.beta.canvases')}</p>
        <p className="text-xs text-fg-muted mt-0.5 mb-3">{t('settings.beta.subtitle')}</p>
        <div className="space-y-3">
          {canvases.map((r) => {
            const on = beta.has(r.id)
            return (
              <BetaRow
                key={r.id}
                icon={r.icon}
                title={r.title}
                hint={r.hint}
                on={on}
                disabled={!beta.loaded}
                onToggle={() => beta.set(r.id, !on)}
                attrs={{ 'data-beta-feature': r.id }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
