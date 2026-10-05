import type { Project } from '../../types'
import { useT } from '../../i18n'
import { useTeamColors } from '../../hooks/useTeamColors'
import { ListAvatar } from '../ui/ListIcon'
import { CrumbMenu } from './treeMenus'

/**
 * A team's mark: its initial on the brand gradient — the same square the
 * sidebar draws at the head of each team (#9ab8db99).
 */
export function TeamMark({ name, size = 'xs' }: { name: string; size?: 'xs' | 'sm' | 'md' }) {
  const box = size === 'md' ? 'w-6 h-6 rounded-md text-xs' : size === 'sm' ? 'w-5 h-5 rounded-md text-2xs' : 'w-4 h-4 rounded-md text-2xs'
  return (
    <span className={`${box} bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0`} aria-hidden>
      <span className="text-white font-bold leading-none">{name.trim().charAt(0).toLocaleUpperCase('tr-TR')}</span>
    </span>
  )
}

/** A list's mark: its own icon (or logo) in its palette colour, as in the sidebar. */
export function ListMark({ list }: { list: Pick<Project, 'icon' | 'icon_url' | 'color_id' | 'team_id'> }) {
  const { data: colors = [] } = useTeamColors(list.team_id ?? null)
  const hex = colors.find((c) => c.id === list.color_id)?.hex ?? null
  return <ListAvatar icon={list.icon ?? null} iconUrl={list.icon_url ?? null} color={hex} size="sm" />
}

/**
 * "TEAM / List" at the head of a list (#9ab8db99) — the ticket window's
 * breadcrumb, one line, with the sidebar's marks. The team opens the Teams
 * panel at that team; the list name opens its settings (name, folder, icon,
 * colour, statuses) — for members who may not edit the list, just its statuses.
 * A right click on either opens the sidebar row's own menu (#c675e160).
 */
export function ListCrumb({ teamName, list, onTeam, onEditList, editLabel }: {
  teamName: string | null
  list: Project
  onTeam?: () => void
  onEditList?: () => void
  editLabel?: string
}) {
  const t = useT()
  const listInner = (
    <>
      <ListMark list={list} />
      <span className="truncate text-sm font-semibold text-fg">{list.name}</span>
    </>
  )
  return (
    <nav aria-label={t('board.header.crumb')} className="flex items-center gap-1 min-w-0 flex-shrink" data-list-crumb>
      {teamName && (
        <>
          <CrumbMenu node={list.team_id ? { kind: 'team', teamId: list.team_id } : null}>
            <button type="button" onClick={onTeam} title={t('board.header.teamInSidebar', { name: teamName })}
              className="hidden sm:flex items-center gap-1.5 flex-shrink-0 px-1.5 py-1 rounded-md hover:bg-raised transition-colors max-w-[180px] cursor-pointer">
              <TeamMark name={teamName} />
              <span className="truncate text-xs font-medium text-fg-2 uppercase tracking-wide">{teamName}</span>
            </button>
          </CrumbMenu>
          <span className="hidden sm:inline text-fg-faint" aria-hidden>/</span>
        </>
      )}
      {/* Dar pencerede sekmeler yer isteyince ad iki harfe kadar eziliyordu
          (#849dd4b8): isim için taban genişlik, kısalma önce sekmelerden. */}
      <h1 className="min-w-[7rem] flex">
        <CrumbMenu node={list.team_id ? { kind: 'list', teamId: list.team_id, id: list.id } : null}>
        {onEditList ? (
          <button type="button" onClick={onEditList} title={editLabel ?? t('board.header.editList')} data-crumb-list data-shortcut="list-settings"
            className="flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded-md hover:bg-raised transition-colors cursor-pointer max-w-[260px]">
            {listInner}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 min-w-0 px-1.5 py-1 max-w-[260px]" data-crumb-list>{listInner}</span>
        )}
        </CrumbMenu>
      </h1>
    </nav>
  )
}
