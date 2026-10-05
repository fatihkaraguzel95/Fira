import { FormEvent, useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useCreateFolder, useUpdateFolder } from '../../hooks/useFolders'
import type { Team, TeamFolder } from '../../types'
import { ColorPalettePicker } from '../ui/ColorPalettePicker'
import { useT } from '../../i18n'

interface Props {
  team: Team
  folder?: TeamFolder | null   // edit mode when set
  /** Create inside this folder (068); null = the team root. */
  parentId?: string | null
  canManage: boolean
  onClose: () => void
}

export function FolderModal({ team, folder, parentId = null, canManage, onClose }: Props) {
  const t = useT()
  const isEdit = !!folder
  const [name, setName] = useState(folder?.name ?? '')
  const [colorId, setColorId] = useState<string | null>(folder?.color_id ?? null)
  const [error, setError] = useState<string | null>(null)
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      if (isEdit && folder) await updateFolder.mutateAsync({ id: folder.id, teamId: team.id, input: { name: name.trim(), color_id: colorId } })
      else await createFolder.mutateAsync({ teamId: team.id, name: name.trim(), colorId, parentId })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('team.saveFailed'))
    }
  }

  const pending = createFolder.isPending || updateFolder.isPending

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-soft">
          <div>
            <h2 className="text-base font-semibold text-fg">{isEdit ? t('team.folder.editTitle') : t('team.folder.newTitle')}</h2>
            <p className="text-xs text-fg-muted mt-0.5">{team.name}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised">
            <Icon name="close" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('team.folder.nameLabel')}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('team.folder.namePlaceholder')}
              className="w-full border border-line bg-field text-fg rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{t('team.colorLabel')}</label>
            <ColorPalettePicker teamId={team.id} value={colorId} onChange={setColorId} canCreate={canManage} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="text-sm text-fg-muted hover:text-fg-2 px-4 py-2">{t('common.cancel')}</button>
            <button type="submit" disabled={pending || !name.trim()} className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
              {pending ? t('common.saving') : isEdit ? t('common.save') : t('team.action.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
