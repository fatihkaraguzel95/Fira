import type { HTMLAttributes } from 'react'
import { useT } from '../../i18n'

const BASE = 'flex-shrink-0 inline-flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default'
const tone = (on: boolean) => (on ? 'border-primary-500 bg-primary-600 text-white' : 'border-line bg-field text-fg-2 hover:border-fg-faint')

/** An on/off switch that says its state in words ("Açık" / "Kapalı"), as the settings window draws it. */
export function Switch({ on, label, disabled, onToggle, ...attrs }: {
  on: boolean
  label: string
  disabled?: boolean
  onToggle: () => void
} & Omit<HTMLAttributes<HTMLButtonElement>, 'onToggle'>) {
  const t = useT()
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle} className={`${BASE} ${tone(on)}`} {...attrs}>
      <span className={`w-6 h-6 rounded-full transition-colors ${on ? 'bg-white' : 'bg-fg-faint/40'}`} />
      {t(on ? 'settings.toggle.on' : 'settings.toggle.off')}
    </button>
  )
}
