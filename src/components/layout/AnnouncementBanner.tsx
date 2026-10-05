import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { useSystemSettings } from '../../hooks/useAdmin'
import { useT } from '../../i18n'

/** Admin announcement shown above the board for everyone (dismissible per session). */
export function AnnouncementBanner() {
  const t = useT()
  const { data } = useSystemSettings()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const a = data?.announcement
  if (!a?.text) return null
  if (a.until && new Date(a.until).getTime() < Date.now()) return null
  if (dismissed === a.text) return null
  const warn = a.level === 'warning'
  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-sm border-b ${warn ? 'bg-warning/10 text-warning border-warning/30' : 'bg-primary-50 dark:bg-primary-950/30 text-primary-800 dark:text-primary-200 border-primary-200 dark:border-primary-900'}`}>
      <Icon name="megaphone" />
      <span className="flex-1">{a.text}</span>
      <button onClick={() => setDismissed(a.text)} className="tap inline-flex items-center justify-center w-6 h-6 rounded-md text-xs opacity-70 hover:opacity-100 hover:bg-fg/10" aria-label={t('board.announcement.close')}>✕</button>
    </div>
  )
}

/** Full-screen maintenance notice for non-admins. */
export function MaintenanceScreen({ message }: { message?: string }) {
  const t = useT()
  return (
    <div className="min-h-screen flex items-center justify-center bg-app p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="text-4xl">🛠️</div>
        <h1 className="text-xl font-semibold text-fg">{t('board.maintenance.title')}</h1>
        {/* `message` is what an admin typed in system_settings — their words, not ours. */}
        <p className="text-sm text-fg-muted">{message || t('board.maintenance.text')}</p>
      </div>
    </div>
  )
}
