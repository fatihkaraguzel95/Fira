import { useMemo, useState } from 'react'
import { Icon } from '../ui/Icon'
import { isCanvasKind, type PageKind } from '../../types'
import { KindIcon } from '../page/PageTree'
import { useNavigate } from 'react-router-dom'
import { openTicket } from '../../lib/nav'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useFavorites, useToggleFavorite, forgetRecent, type FavKind, type Recents } from '../../lib/favorites'
import { usePrefs } from '../../hooks/usePrefs'
import { useRowMenu, MenuIcons, type RowMenuItem } from '../ui/RowMenu'
import { copyLink, listUrl, pageUrl, ticketUrl } from '../../lib/shareLink'
import { ListAvatar } from '../ui/ListIcon'
import { CopyId } from '../ui/CopyId'
import type { Project, Team } from '../../types'
import { useT } from '../../i18n'

/**
 * The top of the sidebar (#D6B3097E): what this person pinned, and what they
 * opened last. Both are per user. Favourites are explicit (row menu ★); recents
 * are a trace of the last eight tasks / pages / lists opened, newest first, so
 * the thing you were just looking at is one click away without a search —
 * the pattern ClickUp (Favorites + Recent), Jira (Starred + Recent in "Your
 * work") and Notion (Favorites section) all settled on.
 */
interface Props {
  teams: (Team & { my_role: string })[]
  onSelectProject: (project: Project, team: Team, opts?: { explicit?: boolean }) => void
  onOpenPage: (id: string) => void
  onClose?: () => void
  /** Home widgets show the two lists separately (#A16136B5). */
  showFavorites?: boolean
  showRecents?: boolean
  /** Ana sayfada başlığı bölümün kendisi çiziyor (#C2C27B51). */
  showTitle?: boolean
}

export type Named = { id: string; name: string; sub?: string | null; kind?: PageKind | null; icon?: string | null; icon_url?: string | null; color?: string | null; team_id?: string | null; project_id?: string | null }

/** Names for the ids we hold — three small lookups, chunked (CLAUDE.md: `in()` ≤ 60 ids). */
export function useNames(kind: FavKind, ids: string[]) {
  const key = ids.slice().sort().join(',')
  return useQuery({
    queryKey: ['fav-names', kind, key],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Named[]> => {
      const out: Named[] = []
      for (let i = 0; i < ids.length; i += 60) {
        const chunk = ids.slice(i, i + 60)
        if (kind === 'ticket') {
          const { data, error } = await supabase.from('tickets').select('id, title, project_id').in('id', chunk)
          if (error) throw error
          out.push(...(data ?? []).map((t) => ({ id: t.id, name: t.title, project_id: t.project_id })))
        } else if (kind === 'page') {
          const { data, error } = await supabase.from('pages').select('id, title, team_id, kind').in('id', chunk).is('archived_at', null)
          if (error) throw error
          out.push(...(data ?? []).map((p) => ({ id: p.id, name: p.title, team_id: p.team_id, kind: (p as { kind?: PageKind }).kind ?? 'page' })))
        } else {
          // Rengi de al: favorideki liste ağaçtakiyle aynı görünsün (#c2c27b51).
          // Renk takim paletinde duruyor, gömülü seçimle tek sorguda geliyor.
          const { data, error } = await supabase.from('projects').select('id, name, icon, icon_url, team_id, color:team_colors!projects_color_id_fkey(hex)').in('id', chunk)
          if (error) throw error
          out.push(...(data ?? []).map((p) => ({
            id: p.id, name: p.name, icon: p.icon, icon_url: p.icon_url, team_id: p.team_id,
            color: (p as unknown as { color?: { hex?: string | null } | null }).color?.hex ?? null,
          })))
        }
      }
      return out
    },
  })
}

const PageGlyph = () => (
  <Icon name="page" className="text-fg-muted" />
)
const TicketGlyph = () => (
  <Icon name="ticket" className="text-fg-muted" />
)

function Row({ kind, item, onOpen, onRemove, removeLabel }: { kind: FavKind; item: Named; onOpen: () => void; onRemove: () => void; removeLabel: string }) {
  const t = useT()
  const items: RowMenuItem[] = [
    { key: 'open', label: t('common.open'), icon: MenuIcons.open, onSelect: onOpen },
    { key: 'link', label: t('common.copyLink'), icon: MenuIcons.link, onSelect: () => void copyLink(
      kind === 'ticket' ? ticketUrl(item.id) : kind === 'page' ? pageUrl(item.id) : listUrl(item.id), item.name) },
    { key: 'remove', label: removeLabel, icon: MenuIcons.trash, onSelect: onRemove, separated: true },
  ]
  const menu = useRowMenu(items, { title: item.name, label: t('board.menu.more', { name: item.name }) })
  return (
    <div onContextMenu={menu.onContextMenu} className="group/fav relative flex items-center my-0.5 rounded-lg transition-colors">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left pl-2 pr-2 py-1.5 rounded-lg text-sm flex items-center gap-2 text-fg-2 hover:bg-raised hover:text-fg"
        title={item.name}
      >
        {kind === 'project' ? <ListAvatar icon={item.icon ?? null} iconUrl={item.icon_url ?? null} color={item.color ?? null} size="sm" /> : kind === 'page' ? (isCanvasKind(item.kind) ? <KindIcon kind={item.kind} className="text-fg-muted" /> : <PageGlyph />) : <TicketGlyph />}
        <span className="truncate text-xs font-medium">{item.name || (isCanvasKind(item.kind) ? t(`canvas.untitled.${item.kind}`) : t('common.unnamedTask'))}</span>
        {kind === 'ticket' && <span className="ml-auto"><CopyId id={item.id} /></span>}
      </button>
      {menu.trigger}
      {menu.menu}
    </div>
  )
}

function Header({ label, open, onToggle, count }: { label: string; open: boolean; onToggle: () => void; count?: number }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="w-full px-3 pt-4 pb-1 flex items-center gap-2 text-left">
      <span className="flex-1 text-xs font-semibold text-fg-muted">{label}</span>
      {typeof count === 'number' && count > 0 && <span className="text-2xs text-fg-faint tabular-nums">{count}</span>}
      <Icon name="chevronDown" className={`text-fg-faint transition-transform ${open ? '' : '-rotate-90'}`} />
    </button>
  )
}

export function FavoritesSection({ teams, onSelectProject, onOpenPage, onClose, showFavorites = true, showRecents = true, showTitle = true }: Props) {
  const t = useT()
  const navigate = useNavigate()
  const { data: favorites = [] } = useFavorites()
  const toggle = useToggleFavorite()
  const prefs = usePrefs('global')
  const p = prefs.prefs as { favOpen?: boolean; recentOpen?: boolean; recents?: Recents }
  const favOpen = showTitle ? (p.favOpen ?? true) : true
  const recentOpen = p.recentOpen ?? true
  const recents = p.recents ?? {}
  // Something opened a moment ago should not push the list around while you look at it.
  const [recentLimit] = useState(6)

  const favIds = useMemo(() => ({
    ticket: favorites.filter((f) => f.kind === 'ticket').map((f) => f.target),
    page: favorites.filter((f) => f.kind === 'page').map((f) => f.target),
    project: favorites.filter((f) => f.kind === 'project').map((f) => f.target),
  }), [favorites])
  const recentIds = useMemo(() => ({
    ticket: (recents.tickets ?? []).slice(0, recentLimit).map((e) => e.id),
    page: (recents.pages ?? []).slice(0, recentLimit).map((e) => e.id),
    project: (recents.projects ?? []).slice(0, recentLimit).map((e) => e.id),
  }), [recents, recentLimit])

  const names = {
    ticket: useNames('ticket', [...new Set([...favIds.ticket, ...recentIds.ticket])]).data ?? [],
    page: useNames('page', [...new Set([...favIds.page, ...recentIds.page])]).data ?? [],
    project: useNames('project', [...new Set([...favIds.project, ...recentIds.project])]).data ?? [],
  }
  const byId = (kind: FavKind) => new Map(names[kind].map((n) => [n.id, n]))

  const open = (kind: FavKind, item: Named) => {
    onClose?.()
    if (kind === 'ticket') { openTicket(navigate, item.id); return }
    if (kind === 'page') { onOpenPage(item.id); return }
    const team = teams.find((tm) => tm.id === item.team_id)
    if (!team) return
    onSelectProject({ id: item.id, name: item.name, team_id: item.team_id, icon: item.icon ?? null, icon_url: item.icon_url ?? null } as unknown as Project, team, { explicit: true })
  }

  // Favourites in the order they were added; recents newest first, across kinds by time.
  const favRows = favorites
    .map((f) => ({ kind: f.kind, item: byId(f.kind).get(f.target) }))
    .filter((r): r is { kind: FavKind; item: Named } => !!r.item)
  const recentRows = ([
    ...(recents.tickets ?? []).map((e) => ({ kind: 'ticket' as FavKind, at: e.at, item: byId('ticket').get(e.id) })),
    ...(recents.pages ?? []).map((e) => ({ kind: 'page' as FavKind, at: e.at, item: byId('page').get(e.id) })),
    ...(recents.projects ?? []).map((e) => ({ kind: 'project' as FavKind, at: e.at, item: byId('project').get(e.id) })),
  ])
    .filter((r): r is { kind: FavKind; at: string; item: Named } => !!r.item)
    // What is pinned already has a place above; the recents list is for the rest.
    .filter((r) => !favorites.some((f) => f.kind === r.kind && f.target === r.item.id))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)

  return (
    <div className="px-0">
      {showFavorites && showTitle && <Header label={t('board.sidebar.favorites')} open={favOpen} onToggle={() => prefs.patch({ favOpen: !favOpen })} count={favRows.length} />}
      {showFavorites && favOpen && (
        <div className="px-2">
          {favRows.length === 0
            ? <p className="px-2 py-1 text-xs text-fg-muted leading-snug">{t('board.fav.empty')}</p>
            : favRows.map((r) => (
              <Row key={`${r.kind}:${r.item.id}`} kind={r.kind} item={r.item} onOpen={() => open(r.kind, r.item)} onRemove={() => toggle(r.kind, r.item.id)} removeLabel={t('board.fav.remove')} />
            ))}
        </div>
      )}
      {showRecents && (recentRows.length > 0 || !showFavorites) && (
        <>
          {/* Başlığı dışarıdaki bölüm taşıyorsa (Ana sayfa) ikinci bir "Son açılanlar" başlığı çizilmez. */}
          {showTitle && <Header label={t('board.sidebar.recents')} open={recentOpen} onToggle={() => prefs.patch({ recentOpen: !recentOpen })} />}
          {(recentOpen || !showTitle) && (
            <div className="px-2">
              {recentRows.map((r) => (
                <Row key={`${r.kind}:${r.item.id}`} kind={r.kind} item={r.item} onOpen={() => open(r.kind, r.item)} onRemove={() => { void forgetRecent(r.kind, r.item.id) }} removeLabel={t('board.recent.remove')} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
