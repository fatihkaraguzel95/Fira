import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { subscribeConnection, getConnection, type ConnectionState } from '../../lib/connection'
import { useT } from '../../i18n'

/**
 * A thin bar under the header when the connection is unhealthy: offline (writes
 * may not land) or realtime dropped for long enough that it is not just a blip
 * (live updates from others are paused). Silent while everything is fine.
 */
const REALTIME_GRACE_MS = 6000

export function ConnectionBanner() {
  const t = useT()
  const [state, setState] = useState<ConnectionState>(getConnection)
  const [showDropped, setShowDropped] = useState(false)

  useEffect(() => subscribeConnection(setState), [])

  // Wait out a brief realtime reconnect before alarming the user.
  useEffect(() => {
    if (state.online && state.realtime === 'dropped' && state.droppedSince) {
      const wait = Math.max(0, REALTIME_GRACE_MS - (Date.now() - state.droppedSince))
      const timer = window.setTimeout(() => setShowDropped(true), wait)
      return () => window.clearTimeout(timer)
    }
    setShowDropped(false)
  }, [state.online, state.realtime, state.droppedSince])

  const offline = !state.online
  const shown = offline || showDropped

  // Üstte yer kaplayan bir bant var: tam ekran görev penceresi ve gelen kutusu
  // çekmecesi gibi `fixed` katmanlar da onun altından başlasın (#474a502d).
  useEffect(() => {
    const root = document.documentElement
    if (shown) root.setAttribute('data-conn-banner', '')
    else root.removeAttribute('data-conn-banner')
    return () => root.removeAttribute('data-conn-banner')
  }, [shown])

  if (!shown) return null

  const cfg = offline
    ? { cls: 'bg-danger/10 text-danger border-danger/25', icon: 'offline' as const, text: t('board.connection.offline'), detail: t('board.connection.offlineDetail') }
    : { cls: 'bg-warning/10 text-warning border-warning/25', icon: 'refresh' as const, text: t('board.connection.dropped'), detail: t('board.connection.droppedDetail') }

  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium border-b ${cfg.cls}`}>
      <Icon name={cfg.icon} className={offline ? '' : 'animate-spin'} />
      <span className="font-semibold">{cfg.text}</span>
      <span className="hidden sm:inline opacity-80">— {cfg.detail}</span>
    </div>
  )
}
