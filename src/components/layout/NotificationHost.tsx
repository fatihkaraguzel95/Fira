import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useAuth } from '../../hooks/useAuth'
import { NOTIFICATION_EVENTS, useNotificationPrefs } from '../../hooks/useNotificationPrefs'
import { useMutedIds } from '../../hooks/useNotifications'
import { setNotifyConfig, subscribeNotifications, notificationPermission, VERB, type AppNotification, type NotifyItem } from '../../lib/notify'
import { subscribeErrors, type ErrorToast } from '../../lib/errorToast'
import { useT } from '../../i18n'
import { openInbox } from '../../lib/inboxBus'
import { ImportDock } from '../ui/ImportDock'
import { UserAvatar } from '../ticket/UserAvatar'
import type { Profile } from '../../types'

type Translate = ReturnType<typeof useT>

/**
 * What happened, the way an inbox row says it (#4029f71c): a status is a chip
 * in its own colour inside the sentence, everything else is the plain verb.
 */
function ToastItem({ item, tr }: { item: NotifyItem; tr: Translate }) {
  if (item.event !== 'status') return <>{VERB[item.event](item.value)}</>
  return (
    <>
      {tr('inbox.statusBefore')}
      <span
        data-toast-status
        className={`chip-dyn inline-flex items-center gap-1 border text-2xs font-semibold px-1.5 py-0.5 rounded-md align-middle ${item.color ? '' : 'opacity-80'}`}
        style={{ '--c': item.color ?? '#6b7280' } as React.CSSProperties}
      >
        <span className="chip-dot w-1.5 h-1.5 rounded-full" />
        {item.value}
      </span>
      {tr('inbox.statusAfter')}
    </>
  )
}

/**
 * Keeps the notification bridge in sync with the user's preferences and shows
 * in-app notifications as toasts. Browser notifications are only fired when the
 * tab is in the background (see notify.ts) — a popup for something you can see
 * happening in front of you is noise.
 */
export function NotificationHost() {
  // `t` is already the toast in the maps below, so the translator is `tr`.
  const tr = useT()
  const { user } = useAuth()
  const { value } = useNotificationPrefs()
  const muted = useMutedIds()
  const [toasts, setToasts] = useState<AppNotification[]>([])
  const [errors, setErrors] = useState<ErrorToast[]>([])

  useEffect(() => {
    setNotifyConfig({
      userId: user?.id ?? null,
      inApp: value.inApp,
      browser: value.browser && notificationPermission() === 'granted',
      // Telegram is delivered by the server-side bot, so the browser only cares
      // about its own two channels.
      events: Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [
        e.id,
        { inApp: value.events[e.id].inApp, browser: value.events[e.id].browser },
      ])) as never,
      muted,
    })
  }, [user?.id, value, muted])

  useEffect(() => subscribeNotifications((n) => {
    setToasts((list) => [...list.filter((t) => t.id !== n.id), n].slice(-4))
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== n.id)), 9000)
  }), [])

  // Failures of the user's own actions — a red toast they can dismiss.
  useEffect(() => subscribeErrors((e) => {
    setErrors((list) => [...list, e].slice(-3))
    // Onay satırı kısa durur; hata, okunacak kadar.
    window.setTimeout(() => setErrors((list) => list.filter((x) => x.id !== e.id)), e.kind === 'success' ? 3500 : 8000)
  }), [])
  const dismissError = (id: string) => setErrors((list) => list.filter((x) => x.id !== id))

  // The live region has to exist before the first toast lands, or screen readers miss it.
  return (
    <div aria-live="polite" aria-atomic="false" className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))] pointer-events-none">
      {/* Aynı kanal iki tonda: hata kırmızı, onay ("kopyalandı") yeşil (#d46f6d70). */}
      {errors.map((e) => (
        <div key={e.id} role={e.kind === 'success' ? 'status' : 'alert'} className={`pointer-events-auto rounded-xl border bg-surface shadow-lg p-3 animate-fade-in flex items-start gap-2.5 ${e.kind === 'success' ? 'border-success/30' : 'border-danger/30'}`}>
          <span className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${e.kind === 'success' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
            {e.kind === 'success'
              ? <Icon name="check" />
              : <Icon name="warning" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-fg">{e.title}</p>
            {e.detail && <p className="text-xs text-fg-muted break-words">{e.detail}</p>}
            {/* Teknik detay istenince açılır (#4e8dc8f1): ekip teknik, "bir şeyler
                ters gitti" yetmiyor; kod, HTTP durumu ve sunucunun mesajı burada. */}
            {e.tech && e.kind !== 'success' && (
              <details className="mt-1 group/tech">
                <summary className="text-xs text-fg-faint hover:text-fg-2 cursor-pointer list-none select-none">
                  {tr('misc.error.showDetail')}
                </summary>
                <p className="mt-1 text-2xs font-mono text-fg-muted break-all whitespace-pre-wrap bg-raised rounded-lg p-2">{e.tech}</p>
              </details>
            )}
          </div>
          <button onClick={() => dismissError(e.id)} className="text-fg-faint hover:text-fg-2 leading-none px-1" aria-label={tr('common.close')}>×</button>
        </div>
      ))}
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto rounded-xl border border-line bg-surface shadow-lg p-3 animate-fade-in flex items-start gap-2.5"
        >
          {/* Whoever caused it, not a bell: the toast already says it is a notification. */}
          {t.actor ? (
            <span className="mt-0.5 flex-shrink-0" data-toast-actor>
              <UserAvatar user={{ id: t.actor.id ?? t.actor.name, full_name: t.actor.name, email: '', avatar_url: t.actor.avatarUrl } as Profile} size="sm" />
            </span>
          ) : (
            <span className="mt-0.5 w-7 h-7 rounded-full bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 flex items-center justify-center flex-shrink-0">
              <Icon name="bell" />
            </span>
          )}
          <button
            className="flex-1 min-w-0 text-left"
            onClick={() => { setToasts((l) => l.filter((x) => x.id !== t.id)); openInbox({ ticketId: t.ticketId }) }}
          >
            {t.actor && t.items?.length ? (
              <>
                <p className="text-xs text-fg-2 break-words leading-5">
                  <span className="font-semibold text-fg">{t.actor.name}</span>{' '}
                  {t.items.map((item, i) => (
                    <span key={i}>{i > 0 && '; '}<ToastItem item={item} tr={tr} /></span>
                  ))}
                </p>
                {t.ticketTitle && <p className="text-xs text-fg-muted truncate">{t.ticketTitle}</p>}
              </>
            ) : (
              <>
                <p className="text-xs font-semibold text-fg">{t.title}</p>
                <p className="text-xs text-fg-muted line-clamp-2 break-words whitespace-pre-line">{t.body}</p>
              </>
            )}
          </button>
          <button
            onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}
            className="text-fg-faint hover:text-fg-2 leading-none px-1"
            aria-label={tr('common.close')}
          >
            ×
          </button>
        </div>
      ))}
      {/* The OneNote import's progress, below the toasts (#684A9085). */}
      <ImportDock />
    </div>
  )
}
