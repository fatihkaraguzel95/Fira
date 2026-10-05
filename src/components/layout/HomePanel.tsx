import { useNavigate, useLocation } from 'react-router-dom'
import { go as goTo } from '../../lib/nav'
import { Icon } from '../ui/Icon'
import { usePrefs } from '../../hooks/usePrefs'
import { useMyTasks, sliceMyTasks, MY_TASKS_VIEWS } from '../../hooks/useMyTasks'
import { useAgents } from '../../hooks/useAgents'
import { myTasksViewLabel } from '../../hooks/useMyTasks'
import type { Team, Project } from '../../types'
import { useT } from '../../i18n'
import { FavoritesSection } from './FavoritesSection'
import { HomeSection } from './HomeSection'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { HOME_WIDGETS, readHomePrefs, type HomeWidget } from './homePrefs'
export { HOME_WIDGETS, readHomePrefs, type HomePrefs, type HomeWidget } from './homePrefs'

/**
 * The "Ana sayfa" panel (#A16136B5, #4A136310): a NAVIGATION panel, like the
 * Teams panel — it never holds long lists. "Görevlerim" offers views (overdue,
 * today, this week…) that open in the main area; "Son açılanlar" opens there
 * too; favourites (short) and the pinned teams' trees stay in the panel. The
 * widgets and their order are the user's choice (Düzenle).
 */
const TasksIcon = () => (
  <Icon name="tasks" />
)
const AgentIcon = () => (
  <Icon name="sparkle" />
)
const ClockIcon = () => (
  <Icon name="clock" />
)

/** One navigation row: 32 px, icon left, label, optional count; the current one is marked. */
export function NavRow({ icon, label, count, danger = false, active = false, onClick, shortcut }: { icon?: React.ReactNode; label: string; count?: number; danger?: boolean; active?: boolean; onClick: () => void; /** `data-shortcut` (Görevlerim, Son açılanlar). */ shortcut?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-shortcut={shortcut}
      aria-current={active ? 'page' : undefined}
      className={`relative w-full flex items-center gap-2 h-8 px-3 rounded-lg text-[13px] text-left transition-colors cursor-pointer ${active ? 'bg-primary-500/10 text-fg font-medium' : 'text-fg-2 hover:bg-raised hover:text-fg'}`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary-500" aria-hidden />}
      <span className="w-4 h-4 flex items-center justify-center text-fg-muted flex-shrink-0">{icon}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {typeof count === 'number' && <span className={`text-2xs tabular-nums ${danger && count > 0 ? 'text-danger font-semibold' : 'text-fg-faint'}`}>{count}</span>}
    </button>
  )
}

export function HomePanel({ teams, editing, onToggleEditing, onSelectProject, onOpenPage, onClose, teamsWidget }: {
  teams: (Team & { my_role: import('../../types').TeamRole })[]
  /** Panelin altındaki "Düzenle" düğmesi: bölümleri seç ve sırala. */
  editing: boolean
  onToggleEditing: () => void
  onSelectProject: (project: Project, team: Team, opts?: { explicit?: boolean }) => void
  onOpenPage: (id: string) => void
  onClose?: () => void
  /** The pinned teams' trees, built by the sidebar (it owns the tree callbacks). */
  teamsWidget: React.ReactNode
}) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const prefs = usePrefs('global')
  const home = readHomePrefs(prefs.prefs)
  const setWidgets = (widgets: HomeWidget[]) => prefs.patch({ home: { widgets, teams: home.teams, collapsed: home.collapsed } })
  const isOpen = (w: HomeWidget) => !home.collapsed.includes(w)
  const toggleOpen = (w: HomeWidget) => prefs.patch({ home: { collapsed: isOpen(w) ? [...home.collapsed, w] : home.collapsed.filter((x) => x !== w) } })
  // Sürükleme: 6 px eşiği tıklamayı bozmaz (katlama düğmesi aynı satırda).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const list = [...home.widgets]
    const from = list.indexOf(active.id as HomeWidget)
    const to = list.indexOf(over.id as HomeWidget)
    if (from < 0 || to < 0) return
    list.splice(to, 0, list.splice(from, 1)[0])
    setWidgets(list)
  }
  const has = (w: HomeWidget) => home.widgets.includes(w)
  const { data: tasks = [] } = useMyTasks()
  // The agent panel was reachable from the command palette only (#90e67e48): whoever can
  // see an agent (their own, or one working in a team of theirs) gets a row here.
  const { data: agents = [] } = useAgents()
  const label: Record<HomeWidget, string> = {
    myTasks: t('board.home.myTasks'), favorites: t('board.sidebar.favorites'), recents: t('board.sidebar.recents'), teams: t('board.sidebar.teams'),
  }
  const currentView = location.pathname === '/me/tasks' ? new URLSearchParams(location.search).get('view') ?? 'today' : null
  const go = (path: string) => { goTo(navigate, path); onClose?.() }

  if (editing) {
    const ordered = [...home.widgets, ...HOME_WIDGETS.filter((w) => !has(w))]
    const move = (w: HomeWidget, dir: -1 | 1) => {
      const list = [...home.widgets]; const i = list.indexOf(w); const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return
      ;[list[i], list[j]] = [list[j], list[i]]; setWidgets(list)
    }
    return (
      <div className="px-3 py-2">
        <p className="px-1 pb-2 text-xs text-fg-muted">{t('board.home.customizeHint')}</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={home.widgets}>
        <ul className="space-y-1">
          {ordered.map((w) => (
            <EditRow key={w} id={w} sortable={has(w)}>
              <input id={`home-w-${w}`} type="checkbox" checked={has(w)} onChange={(e) => setWidgets(e.target.checked ? [...home.widgets, w] : home.widgets.filter((x) => x !== w))} className="accent-primary-600" />
              <label htmlFor={`home-w-${w}`} className="flex-1 text-[13px] text-fg cursor-pointer">{label[w]}</label>
              {has(w) && (
                <>
                  <button type="button" onClick={() => move(w, -1)} aria-label={t('board.home.moveUp', { name: label[w] })} className="w-6 h-6 rounded-md text-fg-faint hover:text-fg hover:bg-surface disabled:opacity-30" disabled={home.widgets.indexOf(w) === 0}>↑</button>
                  <button type="button" onClick={() => move(w, 1)} aria-label={t('board.home.moveDown', { name: label[w] })} className="w-6 h-6 rounded-md text-fg-faint hover:text-fg hover:bg-surface disabled:opacity-30" disabled={home.widgets.indexOf(w) === home.widgets.length - 1}>↓</button>
                </>
              )}
            </EditRow>
          ))}
        </ul>
        </SortableContext>
        </DndContext>
        <p className="px-1 pt-3 text-xs text-fg-faint leading-snug">{t('board.home.teamsHint')}</p>
        <button
          type="button"
          onClick={onToggleEditing}
          className="mt-3 w-full h-8 rounded-lg text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
        >
          {t('board.home.done')}
        </button>
      </div>
    )
  }

  const widget = (w: HomeWidget) => {
    switch (w) {
      case 'myTasks': return (
        <HomeSection key={w} id={w} label={label.myTasks} open={isOpen(w)} onToggle={() => toggleOpen(w)}>
          <div className="px-2 space-y-0.5">
            {MY_TASKS_VIEWS.map((v, i) => (
              <NavRow key={v} shortcut={i === 0 ? 'my-tasks' : undefined} icon={<TasksIcon />} label={t(myTasksViewLabel(v))} count={sliceMyTasks(tasks, v).length} danger={v === 'overdue'} active={currentView === v} onClick={() => go(`/me/tasks?view=${v}`)} />
            ))}
          </div>
        </HomeSection>
      )
      case 'recents': return (
        <HomeSection key={w} id={w} label={label.recents} open={isOpen(w)} onToggle={() => toggleOpen(w)}>
          {/* Son açılanlar doğrudan listelenir (en fazla 8); eskiden bölümün tek satırı yine
              "Son açılanlar"dı ve bir tık fazladan istiyordu (#990dfec5). Tam liste altta. */}
          <FavoritesSection teams={teams} onSelectProject={onSelectProject} onOpenPage={onOpenPage} onClose={onClose} showFavorites={false} showTitle={false} />
          <div className="px-2">
            <NavRow shortcut="recents" icon={<ClockIcon />} label={t('board.home.allRecents')} active={location.pathname === '/me/recents'} onClick={() => go('/me/recents')} />
          </div>
        </HomeSection>
      )
      case 'favorites': return (
        <HomeSection key={w} id={w} label={label.favorites} open={isOpen(w)} onToggle={() => toggleOpen(w)}>
          <FavoritesSection teams={teams} onSelectProject={onSelectProject} onOpenPage={onOpenPage} onClose={onClose} showRecents={false} showTitle={false} />
        </HomeSection>
      )
      case 'teams': return (
        <HomeSection key={w} id={w} label={label.teams} open={isOpen(w)} onToggle={() => toggleOpen(w)}>
          {home.teams.length === 0 ? <p className="px-3 py-1 text-xs text-fg-faint leading-snug">{t('board.home.teamsEmpty')}</p> : teamsWidget}
        </HomeSection>
      )
    }
  }

  return (
    <div className="py-1 flex flex-col min-h-full">
      {home.widgets.length === 0 && <p className="px-4 py-6 text-center text-xs text-fg-faint leading-relaxed">{t('board.home.empty')}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={home.widgets}>
          {home.widgets.map(widget)}
        </SortableContext>
      </DndContext>
      {/* "Düzenle" panelin en altında (kullanıcı isteği): üstte dururken
          bölümlerin önüne geçiyordu. */}
      <div className="mt-auto px-3 pt-4 pb-2">
        {agents.length > 0 && (
          <div className="-mx-1 mb-2" data-home-agents>
            <NavRow icon={<AgentIcon />} label={t('board.cmd.agents')} active={location.pathname === '/me/agents'} onClick={() => go('/me/agents')} />
          </div>
        )}
        <button
          type="button"
          onClick={onToggleEditing}
          className="w-full h-8 rounded-lg text-xs font-medium text-fg-2 border border-line bg-field hover:border-fg-faint hover:text-fg transition-colors cursor-pointer"
        >
          {t('board.home.customize')}
        </button>
      </div>
    </div>
  )
}

/** Düzenleme listesinin bir satırı: tutamağından sürüklenir. */
function EditRow({ id, sortable, children }: { id: string; sortable: boolean; children: React.ReactNode }) {
  const s = useSortable({ id, disabled: !sortable })
  return (
    <li
      ref={s.setNodeRef}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.6 : 1 }}
      className="flex items-center gap-2 px-2 h-9 rounded-lg bg-raised/60"
    >
      {sortable && (
        <span {...s.attributes} {...s.listeners} className="text-fg-faint cursor-move touch-none select-none" aria-hidden>
          <Icon name="grip" />
        </span>
      )}
      {children}
    </li>
  )
}
