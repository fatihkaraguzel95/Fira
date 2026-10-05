import { Suspense, lazy } from 'react'
import type { InboxItem } from '../../hooks/useNotifications'
import { useReleaseNote } from '../../hooks/useReleaseNote'
import { LoadingLine } from '../ui/Spinner'
import { useT } from '../../i18n'
import { ActivityDiff } from './ActivityDiff'

const ReleaseNotes = lazy(() => import('./ReleaseNotes'))

/**
 * The open notification, for the drawer and the page alike: what changed on a
 * ticket, or — for the release row — what is new in Fira (#2aa4f068).
 */
export function InboxDetail({ item, onOpenTicket, onShowChangelog }: {
  item: InboxItem
  onOpenTicket: (ticketId: string) => void
  onShowChangelog: () => void
}) {
  const t = useT()
  const release = useReleaseNote().state
  if (item.event !== 'release') return <ActivityDiff item={item} onOpenTicket={onOpenTicket} />
  if (!release) return null
  return <Suspense fallback={<LoadingLine text={t('common.loading')} className="text-sm" />}><ReleaseNotes state={release} onShowAll={onShowChangelog} /></Suspense>
}
