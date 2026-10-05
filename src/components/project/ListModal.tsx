import { FormEvent, useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { displayUrl } from '../../lib/storage'
import { useCreateProject, useUpdateProject } from '../../hooks/useProjects'
import { BackgroundPicker } from './BackgroundPicker'
import { useFolders } from '../../hooks/useFolders'
import { folderOptions } from '../../lib/folders'
import { useTeamColors } from '../../hooks/useTeamColors'
import type { Team, Project } from '../../types'
import { IconPicker } from '../ui/IconPicker'
import { ColorPalettePicker } from '../ui/ColorPalettePicker'
import { DEFAULT_LIST_ICON } from '../ui/ListIcon'
import { useT } from '../../i18n'
import { useTeamRole } from '../../hooks/useTeams'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { isEditableTarget, blurAfterEscape } from '../../lib/keys'
import { StatusManager } from '../board/StatusManager'
import { RecurrenceSection } from './RecurrenceSection'

interface Props {
  team: Team
  list?: Project | null          // edit mode when set
  defaultFolderId?: string | null
  onClose: () => void
  onCreated?: (list: Project) => void
}

/**
 * Create / edit a list (name, folder, icon or logo, palette colour) and, when
 * editing, its statuses (#9ab8db99 — they moved here from the list header).
 * Only team admins may change the list itself; members who can write still
 * manage its statuses here (RLS: statuses follow can_write_team), so for them
 * the dialog is just the statuses.
 */
export function ListModal({ team, list, defaultFolderId = null, onClose, onCreated }: Props) {
  const t = useT()
  const isEdit = !!list
  const { perms } = useTeamRole(team.id)
  const canManage = perms.canManage
  const statusesOnly = isEdit && !canManage
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  const [name, setName] = useState(list?.name ?? '')
  const [folderId, setFolderId] = useState<string | null>(list?.folder_id ?? defaultFolderId)
  const [icon, setIcon] = useState<string | null>(list?.icon ?? DEFAULT_LIST_ICON)
  const [iconUrl, setIconUrl] = useState<string | null>(list?.icon_url ?? null)
  const [colorId, setColorId] = useState<string | null>(list?.color_id ?? null)
  const [background, setBackground] = useState<string | null>(list?.background_url ?? null)
  const [backgroundCredit, setBackgroundCredit] = useState<string | null>(list?.background_credit ?? null)
  const [pickingBg, setPickingBg] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: folders = [] } = useFolders(team.id)
  const { data: colors = [] } = useTeamColors(team.id)
  const createList = useCreateProject()
  const updateList = useUpdateProject()
  const colorHex = colors.find((c) => c.id === colorId)?.hex ?? null

  // Esc in a field (a status being renamed, the name box) only leaves the field; the
  // background picker on top closes itself first.
  const pickingRef = useRef(pickingBg); pickingRef.current = pickingBg
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pickingRef.current) return
      if (isEditableTarget(e.target)) { blurAfterEscape(e, e.target); return }
      e.stopPropagation(); onClose()
    }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    const input = { name: name.trim(), folder_id: folderId, icon: iconUrl ? null : icon, icon_url: iconUrl, color_id: colorId, background_url: background, background_credit: backgroundCredit }
    try {
      if (isEdit && list) {
        await updateList.mutateAsync({ projectId: list.id, teamId: team.id, input })
      } else {
        const created = await createList.mutateAsync({ teamId: team.id, input })
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('team.saveFailed'))
    }
  }

  const pending = createList.isPending || updateList.isPending
  const title = statusesOnly ? t('board.status.manager') : isEdit ? t('team.list.editTitle') : t('team.list.newTitle')

  return (
    <>
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="bg-surface rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col outline-none" data-list-modal>
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-soft flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <p className="text-xs text-fg-muted mt-0.5 truncate">{list ? `${team.name} / ${list.name}` : team.name}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {!statusesOnly && (
        <form id="list-modal-form" onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('team.list.nameLabel')}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('team.list.namePlaceholder')}
              className="w-full border border-line bg-field text-fg rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('team.list.folderLabel')}</label>
            <select
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="w-full border border-line bg-field text-fg rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t('team.list.noFolder')}</option>
              {folderOptions(folders).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('team.list.iconLabel')}</label>
            <IconPicker icon={icon} iconUrl={iconUrl} colorHex={colorHex} onChange={({ icon, icon_url }) => { setIcon(icon); setIconUrl(icon_url) }} />
          </div>

          {canManage && (
            <div>
              <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('team.list.backgroundLabel')}</label>
              <div className="flex items-center gap-3">
                <div className="w-24 h-14 rounded-lg border border-line overflow-hidden bg-raised flex items-center justify-center flex-shrink-0">
                  {background
                    ? <img src={displayUrl(background)} alt="" className="w-full h-full object-cover" />
                    : <span className="text-2xs text-fg-faint">{t('common.none')}</span>}
                </div>
                <button type="button" onClick={() => setPickingBg(true)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised">
                  {background ? t('team.list.changeBackground') : t('team.list.pickBackground')}
                </button>
                {background && (
                  <button type="button" onClick={() => { setBackground(null); setBackgroundCredit(null) }} className="text-xs text-fg-muted hover:text-danger">
                    {t('common.remove')}
                  </button>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('team.colorLabel')}</label>
            <ColorPalettePicker teamId={team.id} value={colorId} onChange={setColorId} canCreate={canManage} />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
        )}

        {/* Statuses save as you go (each change is its own request), unlike the form above. */}
        {list && (
          <section aria-labelledby="list-modal-statuses" className={`px-6 pb-6 ${statusesOnly ? 'pt-5' : 'pt-5 border-t border-line-soft'}`} data-list-statuses>
            <h3 id="list-modal-statuses" className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{t('team.list.statusesLabel')}</h3>
            <p className="text-xs text-fg-faint mt-1 mb-2">{t('team.list.statusesHint')}</p>
            <StatusManager projectId={list.id} />
          </section>
        )}

        {/* Tekrarlayan görevler (#59e0b75e): kural görevin penceresinde kurulur, burada seriler görünür. */}
        {list && (
          <section aria-labelledby="list-modal-recur" className="px-6 pb-6 pt-5 border-t border-line-soft" data-list-recur>
            <h3 id="list-modal-recur" className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{t('team.list.recurLabel')}</h3>
            <p className="text-xs text-fg-faint mt-1 mb-2">{t('team.list.recurHint')}</p>
            <RecurrenceSection projectId={list.id} canWrite={perms.canWrite} onNavigate={onClose} />
          </section>
        )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-line-soft flex-shrink-0">
          {statusesOnly ? (
            <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-medium rounded-lg border border-line text-fg-2 hover:bg-raised">{t('common.close')}</button>
          ) : (<>
            <button type="button" onClick={onClose} className="text-sm text-fg-muted hover:text-fg-2 px-4 py-2">{t('common.cancel')}</button>
            <button type="submit" form="list-modal-form" disabled={pending || !name.trim()} className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
              {pending ? t('common.saving') : isEdit ? t('common.save') : t('team.action.create')}
            </button>
          </>)}
        </div>
      </div>
    </div>
      {pickingBg && (
        <BackgroundPicker
          current={background}
          onPick={(url, credit) => { setBackground(url); setBackgroundCredit(credit) }}
          onClose={() => setPickingBg(false)}
        />
      )}
    </>
  )
}
