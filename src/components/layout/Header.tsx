import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import type { Project, Team, TicketFilters, TicketStatus } from '../../types'
import { FilterMenu } from './FilterMenu'
import { ListCrumb } from './ListCrumb'
import { useT } from '../../i18n'

/**
 * The open list's own row (#43a865fb → #9ab8db99), one line:
 *   TEAM / List   ·   Pano · Liste · saved views · +   ·············   Filtre
 * Everything here acts on this list. App-wide controls (palette, profile) are
 * in the TopBar; searching moved to the palette ("/" opens it narrowed to this
 * list); a new task comes from the palette ("n", "Yeni görev") or a column's /
 * group's "Görev ekle"; statuses live in the list's settings (the list name).
 */
interface Props {
  onMenuToggle: () => void
  project: Project | null
  team: Team | null
  /** Shown in place of the list name when the main area is not a list ("Görevlerim" gibi). */
  contextLabel?: string
  /** Sayfa açıkken (#c64e74fa): satırın söyleyeceği bir şey yok — sayfanın kendi
   *  başlığı ve konumu zaten üstünde. Masaüstünde satır tamamen gizlenir,
   *  telefonda yalnız menü düğmesi kalır. */
  bare?: boolean
  filters: TicketFilters
  onFiltersChange: (f: TicketFilters) => void
  statuses: TicketStatus[]
  /** The view tabs (Pano · Liste · saved views), between the crumb and the filter. */
  views?: ReactNode
  onTeam?: () => void
  /** Opens the list's settings (name, folder, icon, colour, statuses); absent for read-only viewers. */
  onEditList?: () => void
  /** What the list name does when clicked ("list settings and statuses", or just "statuses" for members). */
  editListLabel?: string
}

export function Header({ onMenuToggle, project, team, contextLabel, bare = false, filters, onFiltersChange, statuses, views, onTeam, onEditList, editListLabel }: Props) {
  const t = useT()
  return (
    <div data-context-bar className={`bg-surface border-b border-line-soft px-3 md:px-5 py-2 flex flex-wrap md:flex-nowrap items-center flex-shrink-0 gap-2 md:gap-3 ${bare ? 'md:hidden min-h-0' : 'min-h-[57px]'}`}>
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuToggle}
        className="md:hidden w-11 h-11 flex items-center justify-center rounded-xl text-fg-muted hover:bg-raised active:bg-raised transition-colors flex-shrink-0"
        aria-label={t('board.header.openMenu')}
      >
        <Icon name="menu" size={20} />
      </button>

      {bare ? null : project ? (
        <ListCrumb teamName={team?.name ?? null} list={project} onTeam={onTeam} onEditList={onEditList} editLabel={editListLabel} />
      ) : contextLabel ? (
        <span className="text-sm font-semibold text-fg-2 truncate">{contextLabel}</span>
      ) : (
        <span className="text-sm text-fg-faint hidden md:block">{t('board.header.pickList')}</span>
      )}

      {/* Not a scroll box: the tabs' menus and the save-as popover open below them and would be clipped.
          On a phone the tabs take their own line under the crumb instead. */}
      {project && views && (
        <div className="order-last md:order-none basis-full md:basis-auto md:flex-1 min-w-0" data-tour="view">{views}</div>
      )}
      <span className="flex-1 md:hidden" />
      {!(project && views) && <span className="hidden md:block flex-1" />}

      {project && (
        <div className="flex-shrink-0">
          <FilterMenu filters={filters} onChange={onFiltersChange} statuses={statuses} teamId={team?.id ?? null} projectId={project.id} align="right" />
        </div>
      )}
    </div>
  )
}
