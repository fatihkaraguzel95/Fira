import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { useT } from '../../i18n'
import type { SavedView } from '../../hooks/useListViews'
import type { useSavedViews } from '../../hooks/useSavedViews'
import { useRowMenu, type RowMenuItem } from '../ui/RowMenu'

/**
 * The tabs of a list (#883CF8 / TL-09; in the list's header row since #9ab8db99): the built-in views
 * first (Pano / Liste, or the "my tasks" slices), then the saved ones, then "+". A dot on the
 * active tab means the screen drifted from the saved view; Save / Save as /
 * Revert sit next to it. Everything else — rename, share, protect, default,
 * delete — is in the tab's ⋯ menu.
 */
type Saved = ReturnType<typeof useSavedViews>

export interface BuiltinTab { key: string; label: ReactNode; active: boolean; onSelect: () => void }

interface Props {
  saved: Saved
  builtins: BuiltinTab[]
  /** The bar may create shared views (single-list screens with a team). */
  canShare: boolean
  canManageTeam: boolean
}

const Dot = () => <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />

function Tab({ view, saved, canManageTeam, canShare }: { view: SavedView; saved: Saved; canManageTeam: boolean; canShare: boolean }) {
  const t = useT()
  const active = saved.active?.id === view.id
  const editable = saved.canEdit(view)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(view.name)
  const [confirm, setConfirm] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (renaming) input.current?.select() }, [renaming])
  useEffect(() => { if (!renaming) setName(view.name) }, [view.name, renaming])

  const items: RowMenuItem[] = []
  if (editable) items.push({ key: 'rename', label: t('common.rename'), onSelect: () => setRenaming(true) })
  if (canShare && editable) items.push({ key: 'share', label: view.is_shared ? t('board.list.views.unshare') : t('board.list.views.share'), onSelect: () => void saved.setShared(view, !view.is_shared) })
  if (view.is_shared && editable) items.push({ key: 'protect', label: view.is_protected ? t('board.list.views.unprotect') : t('board.list.views.protect'), onSelect: () => void saved.setProtected(view, !view.is_protected) })
  if (view.is_shared && canManageTeam) items.push({ key: 'teamDefault', label: view.is_default ? t('board.list.views.teamDefaultOff') : t('board.list.views.teamDefault'), onSelect: () => void saved.setTeamDefault(view, !view.is_default), separated: true })
  items.push({ key: 'myDefault', label: saved.myDefaultId === view.id ? t('board.list.views.myDefaultOff') : t('board.list.views.myDefault'), onSelect: () => saved.setMyDefault(saved.myDefaultId === view.id ? null : view) })
  items.push({ key: 'copyLink', label: t('common.copyLink'), onSelect: () => { const u = new URL(window.location.href); u.searchParams.set('v', view.id); void navigator.clipboard.writeText(u.toString()) }, separated: true })
  if (editable) items.push({ key: 'delete', label: t('common.delete'), danger: true, separated: true, onSelect: () => setConfirm(true) })
  const menu = useRowMenu(items, { label: t('board.list.views.menu', { name: view.name }) })

  const commit = () => { const n = name.trim(); setRenaming(false); if (n && n !== view.name) void saved.rename(view, n) }
  return (
    <span className={`group/tab relative inline-flex items-center rounded-lg ${active ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 font-medium' : 'text-fg-2 hover:bg-raised hover:text-fg'}`} data-view-tab={view.id} onContextMenu={menu.onContextMenu}>
      {renaming ? (
        <input ref={input} value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setRenaming(false) }} className="h-8 px-2 text-sm rounded-lg bg-field border border-primary-500 text-fg outline-none w-40" aria-label={t('common.rename')} />
      ) : (
        <button type="button" aria-pressed={active} onClick={() => saved.select(view)} onDoubleClick={() => { if (editable) setRenaming(true) }} className="h-8 pl-3 pr-1.5 text-sm inline-flex items-center gap-1.5 cursor-pointer">
          {view.is_shared && <Icon name="users" className="opacity-70" />}
          {/* The lock says what it means to a screen reader and on hover; the icon itself is decoration. */}
          {view.is_protected && (
            <span className="inline-flex" role="img" aria-label={t('board.list.views.protectedHint')} title={t('board.list.views.protectedHint')}>
              <Icon name="lock" className="opacity-70" />
            </span>
          )}
          <span className="max-w-[10rem] truncate">{view.name}</span>
          {view.is_default && <span className="text-2xs opacity-70" title={t('board.list.views.teamDefaultHint')}>★</span>}
          {active && saved.dirty && <Dot />}
        </button>
      )}
      <span className={`pr-1 ${active || menu.open ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100 focus-within:opacity-100'} ${active ? '[&_button]:text-primary-600 dark:[&_button]:text-primary-300 [&_button:hover]:bg-primary-100 dark:[&_button:hover]:bg-primary-900/40' : ''}`}>{menu.trigger}</span>
      {menu.menu}
      {confirm && (
        <span role="alertdialog" className="absolute left-0 top-full z-30 mt-1 bg-surface border border-line rounded-xl shadow-2xl p-2 text-xs text-fg-2 inline-flex items-center gap-1.5 whitespace-nowrap">
          {t('board.list.views.deleteConfirm')}
          <button type="button" onClick={() => { setConfirm(false); void saved.remove(view) }} className="px-2 py-1 rounded-md bg-red-600 text-white font-semibold">{t('common.delete')}</button>
          <button type="button" onClick={() => setConfirm(false)} className="px-2 py-1 rounded-md hover:bg-raised">{t('common.giveUp')}</button>
        </span>
      )}
    </span>
  )
}

export function ViewBar({ saved, builtins, canShare, canManageTeam }: Props) {
  const t = useT()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newShared, setNewShared] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!adding) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setAdding(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [adding])
  const create = async () => { const n = newName.trim(); if (!n) return; await saved.saveAs(n, newShared); setAdding(false); setNewName(''); setNewShared(false) }
  const canSaveActive = !!saved.active && saved.canEdit(saved.active)

  // Görünüm seçici bir düğme grubu (`aria-pressed`), sekme listesi değil: kayıtlı
  // görünümün ⋯ menüsü ve "+" düğmesi de bu satırda, `tablist` ise yalnız sekme
  // içerebilir (axe: aria-required-children, #990dfec5).
  return (
    <div className="flex items-center gap-1 flex-wrap" role="group" aria-label={t('board.list.views.aria')} data-view-bar data-shortcut="toggle-view">
      {builtins.map((b) => (
        <button key={b.key} type="button" aria-pressed={b.active} onClick={b.onSelect} className={`h-8 px-3 rounded-lg text-sm inline-flex items-center gap-1.5 cursor-pointer transition-colors ${b.active ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 font-medium' : 'text-fg-2 hover:bg-raised hover:text-fg'}`} data-builtin-tab={b.key} data-shortcut={b.key === 'board' || b.key === 'list' ? b.key : undefined}>{b.label}</button>
      ))}
      {saved.views.length > 0 && <span className="w-px h-5 bg-line-soft mx-1" aria-hidden />}
      {saved.views.map((v) => <Tab key={v.id} view={v} saved={saved} canManageTeam={canManageTeam} canShare={canShare} />)}
      <span ref={box} className="relative inline-flex">
        <button type="button" onClick={() => setAdding((a) => !a)} aria-label={t('board.list.views.saveAs')} title={t('board.list.views.saveAs')} aria-expanded={adding} className="h-8 w-8 rounded-lg inline-flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised" data-view-add>
          <Icon name="plus" />
        </button>
        {adding && (
          <span role="dialog" aria-label={t('board.list.views.saveAs')} className="absolute left-0 top-full z-30 mt-1 w-72 bg-surface border border-line rounded-xl shadow-2xl p-3 flex flex-col gap-2">
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void create() }} placeholder={t('board.list.views.namePlaceholder')} aria-label={t('board.list.views.name')} className="h-8 px-2.5 text-sm rounded-lg bg-field border border-line text-fg placeholder-fg-faint focus:outline-none focus:border-primary-500" />
            {canShare && (
              <label className="inline-flex items-center gap-2 text-xs text-fg-2 cursor-pointer select-none"><input type="checkbox" className="rounded-md" checked={newShared} onChange={(e) => setNewShared(e.target.checked)} />{t('board.list.views.shareWithTeam')}</label>
            )}
            <span className="flex items-center gap-1.5 justify-end">
              <button type="button" onClick={() => setAdding(false)} className="text-xs px-2 h-8 rounded-lg text-fg-muted hover:bg-raised">{t('common.giveUp')}</button>
              <button type="button" onClick={() => void create()} disabled={!newName.trim() || saved.saving} className="text-xs px-2.5 h-8 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50" data-view-create>{t('common.save')}</button>
            </span>
          </span>
        )}
      </span>
      {saved.active && saved.dirty && (
        <span className="inline-flex items-center gap-1 ml-1 text-xs" data-view-dirty>
          <Dot /><span className="text-fg-muted">{t('board.list.views.unsaved')}</span>
          {canSaveActive && <button type="button" onClick={() => void saved.save()} disabled={saved.saving} className="px-2 h-7 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50" data-view-save>{t('common.save')}</button>}
          {!canSaveActive && <span className="text-fg-faint">{t('board.list.views.saveAsHint')}</span>}
          <button type="button" onClick={saved.revert} className="px-2 h-7 rounded-md text-fg-2 hover:bg-raised" data-view-revert>{t('board.list.views.revert')}</button>
        </span>
      )}
      {saved.active && canSaveActive && (
        <label className="inline-flex items-center gap-1.5 ml-auto text-xs text-fg-faint cursor-pointer select-none" title={t('board.list.views.autosaveHint')}>
          <input type="checkbox" className="rounded-md" checked={saved.autosave} onChange={(e) => saved.setAutosave(e.target.checked)} />{t('board.list.views.autosave')}
        </label>
      )}
    </div>
  )
}
