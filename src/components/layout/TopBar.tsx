import type { Profile } from '../../types'
import { NavArrows } from './NavArrows'
import type { SettingsTab } from '../profile/SettingsModal'
import { useT } from '../../i18n'
import { FiraMark, FiraWordmark } from '../ui/Logo'
import { ProfileMenu } from './ProfileMenu'
import { UpdateButton } from './UpdateButton'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import type { Team } from '../../types'

/**
 * The app bar (#43a865fb): the only row whose controls act on the whole app —
 * the Fira mark (Home), the command palette, the profile/settings menu.
 * Everything that acts on the open list (view, filter, search, statuses, new
 * task) lives one row down, in the list's own header, so each row has one
 * scope. The mark sits in a 48 px box so it lines up with the rail below.
 * "Güncelle" shows beside the avatar only while a newer build waits (#2aa4f068).
 */
interface Props {
  onHome: () => void
  profile: Profile | null
  onOpenSettings: (tab: SettingsTab) => void
  onShowWhatsNew: () => void
  commands: PaletteCommand[]
  teams: Team[]
  onOpenTicket: (id: string) => void
  onOpenPage: (id: string) => void
  onOpenProject: (id: string) => void
  onOpenTeam: (id: string) => void
}

export function TopBar({ onHome, profile, onOpenSettings, onShowWhatsNew, ...palette }: Props) {
  const t = useT()
  return (
    <header aria-label={t('board.topbar.aria')} data-topbar className="relative h-12 pt-px flex-shrink-0 flex items-center gap-2 pl-2 pr-2 md:pr-3 bg-nav border-b border-line-soft">
      <button
        type="button"
        onClick={onHome}
        aria-label={t('board.topbar.home')}
        title={t('board.topbar.home')}
        data-topbar-home
        className="h-9 min-w-[48px] px-2.5 rounded-lg inline-flex items-center justify-center gap-2 text-fg hover:bg-raised transition-colors cursor-pointer flex-shrink-0"
      >
        <FiraMark size={24} className="text-fg" />
        <FiraWordmark height={14} className="text-fg hidden lg:block" />
      </button>
      {/* Geniş ekranda arama çubuğu **ekranın** tam ortasında (kullanıcı, 28 Eyl):
          akışta kalsaydı soldaki marka ile sağdaki avatarın genişlik farkı
          kadar kayıyordu. Kap tıklamaları geçirir, yalnız çubuğun kendisi alır. */}
      <div className="hidden md:block flex-1" />
      {/* Kap iki yandaki marka ve avatar kadar içeriden başlar (px-40) ki geniş
          kutu onların üstüne binmesin; kutu o alanda en fazla 2xl (672 px).
          v0.65.0'da iç sarmalayıcı içeriğe göre daralıyordu ve kutu ~300 px'e
          inmişti — sonuç başlıkları okunmuyordu (kullanıcı, 28 Eyl). */}
      <div className="flex-1 min-w-0 flex justify-end md:flex-none md:absolute md:inset-x-0 md:px-40 md:justify-center md:pointer-events-none" data-tour="palette">
        <div className="min-w-0 md:relative md:w-full md:max-w-2xl md:flex md:justify-center md:pointer-events-auto">
          {/* Geri / ileri (#f1254345): kutunun hemen solunda; kutunun kendisi ekranın ortasında kalır. */}
          <NavArrows className="hidden md:flex absolute right-full inset-y-0 mr-1.5" />
          <CommandPalette {...palette} />
        </div>
      </div>
      {profile && (
        <div className="flex items-center flex-shrink-0 md:min-w-[48px] md:justify-end">
          <UpdateButton />
          <ProfileMenu user={profile} onOpenSettings={onOpenSettings} onShowWhatsNew={onShowWhatsNew} />
        </div>
      )}
    </header>
  )
}
