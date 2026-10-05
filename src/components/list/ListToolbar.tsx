import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { useT, type TranslationKey } from '../../i18n'
import { GROUP_BYS, COLUMN_KEYS, type GroupBy, type ListViewConfig, type SubtaskMode, type ColumnKey } from '../../lib/listView'
import { COLUMNS } from './columns'

/**
 * The list's own toolbar (#883CF8 / TL-02): what shapes the rows — grouping
 * now, subtask mode (TL-03), columns (TL-05) and view settings (TL-10) later.
 * Everything here writes the `ListViewConfig`; nothing keeps its own state.
 */
export const GROUP_LABEL: Record<GroupBy, TranslationKey> = {
  none: 'board.list.group.none', status: 'board.list.status', assignee: 'board.list.group.assignee', priority: 'board.list.priority',
  tags: 'board.col.tags', due: 'board.list.due', project: 'board.col.project',
}


export const SUBTASK_MODES: SubtaskMode[] = ['collapse', 'expand', 'separate']
export const SUBTASK_LABEL: Record<SubtaskMode, TranslationKey> = { collapse: 'board.list.subtasks.collapse', expand: 'board.list.subtasks.expand', separate: 'board.list.subtasks.separate' }

/** A toolbar pill that opens a small menu; closes on outside click and Escape. */
export function ToolbarMenu({ label, icon, active, children, title }: { label: string; icon: ReactNode; active?: boolean; children: ReactNode | ((close: () => void) => ReactNode); title?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Menü baştan sola hizalı açılır; ekranın sağ kenarını aşıyorsa sağa hizalanır
  // (başlık satırının sonundaki "+" menüsü dışarıda kalıyordu, #d8a62c6e).
  const [alignRight, setAlignRight] = useState(false)
  useLayoutEffect(() => {
    if (!open) { setAlignRight(false); return }
    const el = menuRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > document.documentElement.clientWidth - 8) setAlignRight(true)
  }, [open])
  usePopupLayer(open, box, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
        className={`flex items-center gap-1.5 text-[13px] h-8 px-2.5 rounded-lg transition-colors cursor-pointer ${active ? 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 font-medium' : 'text-fg-muted hover:text-fg hover:bg-raised'}`}
      >
        {icon}
        <span>{label}</span>
        <Icon name="chevronDown" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" className={`absolute ${alignRight ? 'right-0' : 'left-0'} top-full z-30 mt-1 w-60 bg-surface border border-line rounded-xl shadow-2xl py-1 animate-fade-in`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}

export const menuItemClass = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-fg-2 hover:bg-raised hover:text-fg cursor-pointer'

/** Show/hide columns from the catalogue; the name column is always on. Shared by the toolbar and the table's trailing "+". */
export function ColumnPickerItems({ config, onChange, hidden = [] }: { config: ListViewConfig; onChange: (c: ListViewConfig) => void; hidden?: ColumnKey[] }) {
  const t = useT()
  const on = new Set(config.columns.map((c) => c.key))
  const toggle = (key: ColumnKey) => {
    if (key === 'name') return
    onChange({ ...config, columns: on.has(key) ? config.columns.filter((c) => c.key !== key) : [...config.columns, { key }] })
  }
  return (
    <div role="group" aria-label={t('board.list.columnsTitle')}>
      {COLUMN_KEYS.filter((k) => !hidden.includes(k)).map((k) => (
        <button key={k} type="button" role="menuitemcheckbox" aria-checked={on.has(k)} disabled={k === 'name'} onClick={() => toggle(k)} className={`${menuItemClass} disabled:opacity-60 disabled:cursor-default`} data-column-option={k}>
          <MenuCheck on={on.has(k)} />
          <span className="flex-1">{t(COLUMNS[k].labelKey)}</span>
        </button>
      ))}
    </div>
  )
}

export function MenuCheck({ on }: { on: boolean }) {
  return (
    <span className={`w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-md border ${on ? 'bg-primary-600 border-primary-600 text-white' : 'border-line bg-field'}`}>
      {on && <Icon name="check" size={12} />}
    </span>
  )
}

interface Props {
  config: ListViewConfig
  onChange: (c: ListViewConfig) => void
  /** Which groupings make sense for this source (a single list has no "list" grouping). */
  groupOptions?: GroupBy[]
  /** Empty status groups need the list's statuses — only a single-list source has them. */
  canShowEmpty?: boolean
  /** Extra controls (subtask mode, columns…) rendered after the grouping menu. */
  children?: ReactNode
  /** Columns that make no sense for this source (a single list needs no "list" column). */
  hiddenColumns?: ColumnKey[]
  /** Download the rows as drawn (TL-09). */
  onExport?: () => void
  /** View settings (TL-10): closed tasks live in the board's filter for a single list, so the toggle may be handed over. */
  closed?: { on: boolean; set: (on: boolean) => void }
  /** Back to the screen's own defaults. */
  onReset?: () => void
  /** Me mode needs a signed-in person; hidden when the source is already "mine". */
  canMeMode?: boolean
  /** Collapse/expand everything at once (TL-04); a kind is absent when it does not apply. */
  fold?: { groups?: { collapseAll: () => void; expandAll: () => void }; subtasks?: { collapseAll: () => void; expandAll: () => void } }
}

export function ListToolbar({ config, onChange, groupOptions = GROUP_BYS, canShowEmpty = false, children, fold, hiddenColumns, onExport, closed, onReset, canMeMode = true }: Props) {
  const t = useT()
  const grouped = config.groupBy !== 'none'
  const multi = config.groupBy === 'assignee' || config.groupBy === 'tags'
  return (
    <div className="flex items-center gap-1 flex-wrap" data-list-toolbar>
      <ToolbarMenu
        label={grouped ? `${t('board.list.groupBy')}: ${t(GROUP_LABEL[config.groupBy])}` : t('board.list.groupBy')}
        icon={<Icon name="text" />}
        active={grouped}
        title={t('board.list.groupByTitle')}
      >
        {(close) => (<>
        <div role="radiogroup" aria-label={t('board.list.groupByTitle')}>
          {groupOptions.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={config.groupBy === g} onClick={() => { onChange({ ...config, groupBy: g }); close() }} className={menuItemClass} data-group-option={g}>
              <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${config.groupBy === g ? 'border-primary-500 bg-primary-500' : 'border-line'}`}>
                {config.groupBy === g && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              {t(GROUP_LABEL[g])}
            </button>
          ))}
        </div>
        {(multi || (canShowEmpty && config.groupBy === 'status')) && <div className="border-t border-line-soft my-1" />}
        {multi && (
          <button type="button" role="menuitemcheckbox" aria-checked={config.groupMulti === 'combined'} onClick={() => onChange({ ...config, groupMulti: config.groupMulti === 'combined' ? 'each' : 'combined' })} className={menuItemClass}>
            <MenuCheck on={config.groupMulti === 'combined'} />
            <span className="flex-1">{t('board.list.multiCombined')}</span>
          </button>
        )}
        {canShowEmpty && config.groupBy === 'status' && (
          <button type="button" role="menuitemcheckbox" aria-checked={config.showEmptyGroups} onClick={() => onChange({ ...config, showEmptyGroups: !config.showEmptyGroups })} className={menuItemClass}>
            <MenuCheck on={config.showEmptyGroups} />
            <span className="flex-1">{t('board.list.showEmptyGroups')}</span>
          </button>
        )}
        </>)}
      </ToolbarMenu>
      <ToolbarMenu
        label={`${t('board.list.subtasks')}: ${t(SUBTASK_LABEL[config.subtaskMode])}`}
        icon={<Icon name="list" />}
        active={config.subtaskMode !== 'collapse'}
        title={t('board.list.subtasksTitle')}
      >
        {(close) => (
          <div role="radiogroup" aria-label={t('board.list.subtasksTitle')}>
            {SUBTASK_MODES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={config.subtaskMode === m} onClick={() => { onChange({ ...config, subtaskMode: m }); close() }} className={menuItemClass} data-subtask-option={m}>
                <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${config.subtaskMode === m ? 'border-primary-500 bg-primary-500' : 'border-line'}`}>
                  {config.subtaskMode === m && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </span>
                <span className="flex-1">{t(SUBTASK_LABEL[m])}</span>
              </button>
            ))}
            <p className="px-3 pt-1 pb-1.5 text-xs text-fg-faint">{t(config.subtaskMode === 'separate' ? 'board.list.subtasks.separateHint' : 'board.list.subtasks.nestedHint')}</p>
          </div>
        )}
      </ToolbarMenu>
      <ToolbarMenu label={t('board.list.columns')} icon={<Icon name="columns" />} title={t('board.list.columnsTitle')} active={config.columns.length !== 6}>
        <ColumnPickerItems config={config} onChange={onChange} hidden={hiddenColumns} />
      </ToolbarMenu>
      {fold && (fold.groups || fold.subtasks) && (
        <ToolbarMenu label={t('board.list.fold')} icon={<Icon name="fold" />} title={t('board.list.foldTitle')}>
          {(close) => (<>
            {fold.groups && (<>
              <button type="button" role="menuitem" onClick={() => { fold.groups!.collapseAll(); close() }} className={menuItemClass} data-fold="groups-collapse">{t('board.list.fold.groupsCollapse')}</button>
              <button type="button" role="menuitem" onClick={() => { fold.groups!.expandAll(); close() }} className={menuItemClass} data-fold="groups-expand">{t('board.list.fold.groupsExpand')}</button>
            </>)}
            {fold.groups && fold.subtasks && <div className="border-t border-line-soft my-1" />}
            {fold.subtasks && (<>
              <button type="button" role="menuitem" onClick={() => { fold.subtasks!.collapseAll(); close() }} className={menuItemClass} data-fold="subtasks-collapse">{t('board.list.fold.subtasksCollapse')}</button>
              <button type="button" role="menuitem" onClick={() => { fold.subtasks!.expandAll(); close() }} className={menuItemClass} data-fold="subtasks-expand">{t('board.list.fold.subtasksExpand')}</button>
            </>)}
            {fold.groups && <p className="px-3 pt-1 pb-1.5 text-xs text-fg-faint">{t('board.list.fold.shiftHint')}</p>}
          </>)}
        </ToolbarMenu>
      )}
      {children}
      <ToolbarMenu label={t('board.list.settings')} icon={<Icon name="settings" />} title={t('board.list.settingsTitle')} active={config.meMode || config.density === 'compact' || config.wrapText}>
        {() => {
          const row = (key: string, on: boolean, label: string, toggle: () => void, hint?: string) => (
            <button key={key} type="button" role="menuitemcheckbox" aria-checked={on} onClick={toggle} className={menuItemClass} data-setting={key} title={hint}>
              <MenuCheck on={on} /><span className="flex-1">{label}</span>
            </button>
          )
          const showClosedOn = closed ? closed.on : config.showClosed
          return (<>
            {row('showClosed', showClosedOn, t('board.list.settings.showClosed'), () => (closed ? closed.set(!showClosedOn) : onChange({ ...config, showClosed: !config.showClosed })))}
            {row('showClosedSubtasks', config.showClosedSubtasks, t('board.list.settings.showClosedSubtasks'), () => onChange({ ...config, showClosedSubtasks: !config.showClosedSubtasks }))}
            {canShowEmpty && row('showEmptyGroups', config.showEmptyGroups, t('board.list.showEmptyGroups'), () => onChange({ ...config, showEmptyGroups: !config.showEmptyGroups }))}
            <div className="border-t border-line-soft my-1" />
            {row('wrapText', config.wrapText, t('board.list.settings.wrapText'), () => onChange({ ...config, wrapText: !config.wrapText }))}
            {row('compact', config.density === 'compact', t('board.list.settings.compact'), () => onChange({ ...config, density: config.density === 'compact' ? 'comfortable' : 'compact' }), t('board.list.settings.compactHint'))}
            {row('showMeta', config.showMeta, t('board.list.settings.showMeta'), () => onChange({ ...config, showMeta: !config.showMeta }))}
            {row('showTagsInline', config.showTagsInline, t('board.list.settings.showTagsInline'), () => onChange({ ...config, showTagsInline: !config.showTagsInline }))}
            {row('showParentName', config.showParentName, t('board.list.settings.showParentName'), () => onChange({ ...config, showParentName: !config.showParentName }))}
            {canMeMode && (<>
              <div className="border-t border-line-soft my-1" />
              {row('meMode', config.meMode, t('board.list.settings.meMode'), () => onChange({ ...config, meMode: !config.meMode }), t('board.list.settings.meModeHint'))}
            </>)}
            {onReset && (<>
              <div className="border-t border-line-soft my-1" />
              <button type="button" role="menuitem" onClick={onReset} className={`${menuItemClass} text-xs text-fg-muted`} data-setting="reset">{t('board.list.settings.reset')}</button>
            </>)}
          </>)
        }}
      </ToolbarMenu>
      {config.meMode && canMeMode && (
        <span className="inline-flex items-center gap-1 h-7 px-2 rounded-full bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 text-2xs font-medium" data-me-mode>
          {t('board.list.settings.meBadge')}
          <button type="button" onClick={() => onChange({ ...config, meMode: false })} aria-label={t('board.list.settings.meOff')} className="w-4 h-4 rounded-full inline-flex items-center justify-center hover:bg-primary-100 dark:hover:bg-primary-900/40">✕</button>
        </span>
      )}
      {onExport && (
        <button type="button" onClick={onExport} title={t('board.list.export')} aria-label={t('board.list.export')} className="ml-auto h-8 w-8 rounded-lg inline-flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised" data-list-export>
          <Icon name="download" />
        </button>
      )}
    </div>
  )
}
