import { openTicket, go } from '../../lib/nav'
import { Icon } from '../ui/Icon'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePrefs } from '../../hooks/usePrefs'
import { useMyTasks, sliceMyTasks, MY_TASKS_VIEWS, myTasksViewLabel, type MyTasksView } from '../../hooks/useMyTasks'
import { TicketListView } from '../list/TicketListView'
import { useListViewConfig } from '../../hooks/useListViewConfig'
import { DEFAULT_LIST_VIEW, sanitizeListView, type ListViewConfig } from '../../lib/listView'
import { useSavedViews } from '../../hooks/useSavedViews'
import { ViewBar } from '../list/ViewBar'
import { useNames, type Named } from '../layout/FavoritesSection'
import { ListAvatar } from '../ui/ListIcon'
import { CopyId } from '../ui/CopyId'
import type { Recents, FavKind } from '../../lib/favorites'
import { displayTime, useDateFormat } from '../../lib/time'
import { useT, type TranslationKey } from '../../i18n'

/**
 * Personal views in the MAIN area (#4A136310): the Home panel only navigates,
 * the content opens here — like a team's list opens beside the tree.
 *  - /me/tasks?view=…  my open tasks, one slice at a time (tabs with counts)
 *  - /me/recents       what I opened last (tasks, pages, lists)
 */

/** My tasks span lists, so the list column is on by default (the "Liste" column suggested in #4A136310). */
const ME_LIST_VIEW: ListViewConfig = { ...DEFAULT_LIST_VIEW, columns: [{ key: 'name' }, { key: 'project' }, { key: 'status' }, { key: 'priority' }, { key: 'due' }, { key: 'tags' }] }

export function MyTasksView() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const raw = params.get('view') as MyTasksView | null
  const view: MyTasksView = raw && MY_TASKS_VIEWS.includes(raw) ? raw : 'today'
  const { data: tasks = [], isLoading } = useMyTasks()
  const shown = sliceMyTasks(tasks, view)
  const listView = useListViewConfig(ME_LIST_VIEW, 'me:tasks')
  const savedViews = useSavedViews({
    key: { scope: 'me' },
    prefsScope: 'me:tasks',
    live: { type: 'list', list: listView.config, slice: view },
    apply: (v) => {
      if (v.config.slice && MY_TASKS_VIEWS.includes(v.config.slice as MyTasksView)) setParams({ view: v.config.slice, v: v.id })
      if (v.config.list) listView.setConfig(sanitizeListView(v.config.list, ME_LIST_VIEW))
    },
  })
  return (
    <div className="flex flex-col h-full gap-3">
      <ViewBar
        saved={savedViews}
        canShare={false}
        canManageTeam={false}
        builtins={MY_TASKS_VIEWS.map((v) => {
          const n = sliceMyTasks(tasks, v).length
          const on = v === view && !savedViews.active
          return { key: v, active: on, onSelect: () => { savedViews.select(null); setParams({ view: v }) }, label: (<>{t(myTasksViewLabel(v))}<span className={`text-2xs tabular-nums ${on ? 'text-white/80' : v === 'overdue' && n > 0 ? 'text-danger font-semibold' : 'text-fg-faint'}`}>{n}</span></>) }
        })}
      />
      <div className="flex-1 min-h-0">
        {!isLoading && shown.length === 0
          ? <p className="px-2 py-10 text-center text-sm text-fg-faint">{t('me.tasks.empty')}</p>
          : <TicketListView source={{ kind: 'me', view }} config={listView.config} onConfigChange={listView.setConfig} defaultConfig={ME_LIST_VIEW} />}
      </div>
    </div>
  )
}

const kinds: { kind: FavKind; key: keyof Recents }[] = [{ kind: 'ticket', key: 'tickets' }, { kind: 'page', key: 'pages' }, { kind: 'project', key: 'projects' }]

const TicketGlyph = () => (
  <Icon name="ticket" className="text-fg-muted" />
)
const PageGlyph = () => (
  <Icon name="page" className="text-fg-muted" />
)

export function RecentsView({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const t = useT()
  useDateFormat()
  const navigate = useNavigate()
  const prefs = usePrefs('global')
  const recents = ((prefs.prefs as { recents?: Recents }).recents ?? {})
  const names = {
    ticket: useNames('ticket', (recents.tickets ?? []).map((e) => e.id)).data ?? [],
    page: useNames('page', (recents.pages ?? []).map((e) => e.id)).data ?? [],
    project: useNames('project', (recents.projects ?? []).map((e) => e.id)).data ?? [],
  }
  const rows = kinds
    .flatMap(({ kind, key }) => (recents[key] ?? []).map((e) => ({ kind, at: e.at, item: names[kind].find((n) => n.id === e.id) })))
    .filter((r): r is { kind: FavKind; at: string; item: Named } => !!r.item)
    .sort((a, b) => b.at.localeCompare(a.at))
  const open = (kind: FavKind, item: Named) => {
    if (kind === 'ticket') openTicket(navigate, item.id)
    else if (kind === 'page') go(navigate, `/page/${item.id}`)
    else onOpenProject(item.id)
  }
  const kindLabel: Record<FavKind, TranslationKey> = { ticket: 'me.recents.kindTicket', page: 'me.recents.kindPage', project: 'me.recents.kindList' }
  return (
    <div className="h-full overflow-auto">
      {rows.length === 0 && <p className="px-2 py-10 text-center text-sm text-fg-faint">{t('me.recents.empty')}</p>}
      <ul className="max-w-3xl divide-y divide-line-soft rounded-xl border border-line-soft bg-surface">
        {rows.map((r) => (
          <li key={`${r.kind}:${r.item.id}`}>
            <button type="button" onClick={() => open(r.kind, r.item)} className="w-full flex items-center gap-3 px-4 h-12 text-left hover:bg-raised transition-colors cursor-pointer">
              {r.kind === 'project' ? <ListAvatar icon={r.item.icon ?? null} iconUrl={r.item.icon_url ?? null} color={null} size="sm" /> : r.kind === 'page' ? <PageGlyph /> : <TicketGlyph />}
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-fg truncate">{r.item.name || t('common.unnamedTask')}</span>
                <span className="block text-xs text-fg-faint">{t(kindLabel[r.kind])} · {displayTime(r.at)}</span>
              </span>
              {r.kind === 'ticket' && <CopyId id={r.item.id} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
