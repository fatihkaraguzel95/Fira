import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { Link } from 'react-router-dom'
import type { Profile } from '../../types'
import { UserAvatar } from '../ticket/UserAvatar'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { useIsAdmin } from '../../hooks/useAdmin'
import { startTour } from '../../lib/tour'
import { useLang, useT } from '../../i18n'
import type { SettingsTab } from '../profile/SettingsModal'
import { emitShortcut, formatCombo } from '../../lib/shortcuts'
import { useShortcutBindings } from '../../hooks/useShortcuts'

/**
 * Everything personal lives behind the avatar: settings, notifications, theme,
 * release notes and sign out. It used to be a row of icons in the header, which
 * cost space on every screen for buttons that are pressed once in a while.
 */
export function ProfileMenu({ user, onOpenSettings, onShowWhatsNew }: {
  user: Profile
  onOpenSettings: (tab: SettingsTab) => void
  onShowWhatsNew: () => void
}) {
  const tr = useT()
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { signOut } = useAuth()
  const { mode, isDark } = useTheme()
  const { data: isAdmin } = useIsAdmin()

  usePopupLayer(open, ref, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])

  const item = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-fg-2 hover:bg-raised hover:text-fg transition-colors text-left'
  const icon = (name: IconName) => <Icon name={name} className="text-fg-muted" />
  const go = (tab: SettingsTab) => { setOpen(false); onOpenSettings(tab) }
  const { bindings } = useShortcutBindings()
  const shortcutsKey = bindings.shortcuts ? formatCombo(bindings.shortcuts) : ''
  const themeLabel = mode === 'auto'
    ? tr('settings.theme.autoWith', { mode: tr(isDark ? 'settings.theme.darkLower' : 'settings.theme.lightLower') })
    : tr(mode === 'dark' ? 'settings.theme.dark' : 'settings.theme.light')

  return (
    <div className="relative" ref={ref} data-tour="profile">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-shortcut="settings"
        title={user.full_name || user.email || tr('settings.menu.profile')}
        className={`flex items-center gap-1.5 rounded-xl px-1.5 py-1 transition-colors min-h-[44px] md:min-h-0 ${open ? 'bg-raised' : 'hover:bg-raised'}`}
      >
        <UserAvatar user={user} size="sm" />
        <Icon name="chevronDown" className={`text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Tam ekran görev görünümü z-50: üst çubuktan açılan menü onun altında
          kalıyordu (#849dd4b8); palet de aynı kattan (z-200) açılıyor. */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-[210] w-64 bg-surface border border-line rounded-xl shadow-lg py-1.5 animate-fade-in">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <UserAvatar user={user} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg truncate">{user.full_name || tr('settings.menu.unnamed')}</p>
              <p className="text-xs text-fg-muted truncate">{user.email}</p>
            </div>
          </div>

          <div className="h-px bg-line-soft my-1" />

          <div className="px-1.5">
            <button className={item} onClick={() => go('profile')}>
              {icon('settings')}
              {tr('settings.tab.profile')}
            </button>
            <button className={item} onClick={() => go('notifications')}>
              {icon('bell')}
              {tr('settings.tab.notifications')}
            </button>
            <button className={item} onClick={() => go('theme')}>
              {icon('palette')}
              <span className="flex-1">{tr('settings.tab.theme')}</span>
              <span className="text-xs text-fg-faint">{themeLabel}</span>
            </button>
            <button className={item} onClick={() => go('language')}>
              {icon('language')}
              <span className="flex-1">{tr('settings.language.title')}</span>
              <span className="text-xs text-fg-faint uppercase">{lang}</span>
            </button>
            {/* Teams'teki gibi ayrı bir liste penceresi açar (#75dc7a96); tuşlar orada değil Ayarlar'da değişir. */}
            <button className={item} onClick={() => { setOpen(false); emitShortcut('shortcuts') }}>
              {icon('keyboard')}
              <span className="flex-1">{tr('settings.tab.shortcuts')}</span>
              {shortcutsKey && <span className="text-2xs text-fg-faint">{shortcutsKey}</span>}
            </button>
            {/* For everyone (105): someone without an agent creates theirs there. */}
            <button className={item} onClick={() => go('agent')} data-menu-agent>
              {icon('sparkle')}
              {tr('settings.tab.agent')}
            </button>
            <button className={item} onClick={() => { setOpen(false); onShowWhatsNew() }}>
              {icon('megaphone')}
              {tr('settings.menu.whatsNew')}
            </button>
            <button className={item} onClick={() => { setOpen(false); startTour() }}>
              {icon('bolt')}
              {tr('settings.menu.tour')}
            </button>
            {isAdmin && (
              <Link to="/admin" onClick={() => setOpen(false)} className={item}>
                {icon('sliders')}
                {tr('settings.menu.admin')}
              </Link>
            )}
          </div>

          <div className="h-px bg-line-soft my-1" />

          <div className="px-1.5">
            <button className={`${item} !text-danger`} onClick={() => { setOpen(false); signOut() }}>
              <Icon name="logout" />
              {tr('settings.menu.signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
