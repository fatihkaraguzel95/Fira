import { useT } from '../../i18n'
import { Icon } from '../ui/Icon'
import { applyUpdate, useAppUpdate } from '../../lib/appUpdate'

/**
 * "Güncelle" beside the profile menu, only while a newer build is waiting
 * (#2aa4f068). One word and one click — when and how the update would land by
 * itself is not the user's problem, so nothing here explains it.
 */
export function UpdateButton() {
  const t = useT()
  const { ready, busy } = useAppUpdate()
  if (!ready) return null
  return (
    <button
      type="button"
      onClick={() => void applyUpdate()}
      disabled={busy}
      aria-busy={busy}
      data-update-button
      title={t(busy ? 'board.update.refreshing' : 'board.update.ready')}
      className="h-8 px-2.5 mr-1 rounded-lg inline-flex items-center gap-1.5 flex-shrink-0 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-70 transition-colors cursor-pointer disabled:cursor-default animate-fade-in"
    >
      {busy ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
      ) : (
        <Icon name="refresh" />
      )}
      {t('board.update.button')}
    </button>
  )
}
