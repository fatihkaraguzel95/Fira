import { useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { canGoBack, canGoForward, subscribeNav } from '../../lib/nav'
import { formatCombo } from '../../lib/shortcuts'
import { useShortcutBindings } from '../../hooks/useShortcuts'
import { useT } from '../../i18n'

const state = () => (canGoBack() ? 1 : 0) + (canGoForward() ? 2 : 0)

/**
 * Back and forward, left of the search box (#f1254345; Teams and VS Code have the same pair).
 *
 * They are the browser's own history, nothing separate: the buttons, Alt+← / Alt+→,
 * the browser's buttons, a mouse's side buttons and a touchpad swipe all walk the same
 * entries, and `lib/nav` decides what those entries are (back = the more general screen).
 * A button is off when Fira has nowhere to go that way; the browser's back can still
 * leave Fira from the first screen, this one cannot.
 */
export function NavArrows({ className = '' }: { className?: string }) {
  const t = useT()
  const navigate = useNavigate()
  const flags = useSyncExternalStore(subscribeNav, state, state)
  const { bindings } = useShortcutBindings()
  const label = (text: string, action: 'nav-back' | 'nav-forward') => (bindings[action] ? `${text} (${formatCombo(bindings[action])})` : text)
  const button = 'tap w-7 h-7 rounded-lg inline-flex items-center justify-center text-fg-muted hover:bg-raised hover:text-fg transition-colors cursor-pointer disabled:cursor-default disabled:text-fg-faint/40 disabled:hover:bg-transparent'
  return (
    <div className={`items-center gap-0.5 ${className}`} data-nav-arrows>
      <button type="button" data-shortcut="nav-back" disabled={(flags & 1) === 0} onClick={() => navigate(-1)} aria-label={t('board.topbar.back')} title={label(t('board.topbar.back'), 'nav-back')} className={button}>
        <Icon name="arrowLeft" />
      </button>
      <button type="button" data-shortcut="nav-forward" disabled={(flags & 2) === 0} onClick={() => navigate(1)} aria-label={t('board.topbar.forward')} title={label(t('board.topbar.forward'), 'nav-forward')} className={button}>
        <Icon name="arrowRight" />
      </button>
    </div>
  )
}
