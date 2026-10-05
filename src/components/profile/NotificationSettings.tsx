import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { useNavigate } from 'react-router-dom'
import { openTicket } from '../../lib/nav'
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, useNotificationPrefs } from '../../hooks/useNotificationPrefs'
import { useTicketMutes, useToggleMute } from '../../hooks/useNotifications'
import { notificationPermission, requestNotificationPermission, emitNotification, popupText, type NotifyItem } from '../../lib/notify'
import { currentUser } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { TelegramSettings } from './TelegramSettings'
import { useT } from '../../i18n'

/**
 * The event × channel grid reads its labels straight off `NOTIFICATION_EVENTS`
 * and `NOTIFICATION_CHANNELS`: those registries translate themselves (their
 * `label`/`hint`/`short` are getters that call `t()` on access), so the wording
 * lives in one place and every other consumer of the registry gets it too.
 * Keeping a second id → key table here would have been ten strings maintained
 * twice.
 */
function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`w-9 h-5 rounded-full flex-shrink-0 transition-colors relative disabled:opacity-40 ${on ? 'bg-primary-600' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

/** One cell of the event × channel grid. */
function Cell({ on, disabled, onChange, label, offLabel }: { on: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string; offLabel: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      title={disabled ? offLabel : label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors mx-auto ${
        disabled
          ? 'border-line-soft text-fg-faint opacity-40'
          : on
            ? 'bg-primary-600 border-primary-600 text-white'
            : 'border-line text-transparent hover:border-fg-faint'
      }`}
    >
      <Icon name="check" />
    </button>
  )
}

/**
 * Tickets the user muted from the inbox (062). Without this list a mute is a
 * one-way door: the row it was set from scrolls out of the inbox after ninety
 * days and nothing else ever mentions it again.
 */
function MutedTickets({ onClose }: { onClose?: () => void }) {
  const t = useT()
  const { data: mutes = [], isLoading } = useTicketMutes()
  const toggleMute = useToggleMute()
  const navigate = useNavigate()
  // The settings window sits above the router outlet; navigating without
  // closing it would open the ticket underneath, out of reach.
  const openTicketRow = (id: string) => { onClose?.(); openTicket(navigate, id) }

  if (isLoading || mutes.length === 0) {
    return (
      <section className="space-y-2">
        <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider">{t('settings.notif.muted.title')}</p>
        <p className="text-xs text-fg-muted">{t('settings.notif.muted.empty')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider">{t('settings.notif.muted.title')}</p>
      <ul className="rounded-xl border border-line divide-y divide-line-soft overflow-hidden">
        {mutes.map((m) => (
          <li key={m.ticket_id} className="flex items-center gap-2 px-3 py-2">
            <button
              onClick={() => openTicketRow(m.ticket_id)}
              className="min-w-0 flex-1 text-left text-sm text-fg-2 hover:text-primary-600 dark:hover:text-primary-400 truncate transition-colors"
            >
              {m.ticket?.title || t('common.unnamedTask')}
            </button>
            <span className="text-2xs font-mono text-fg-faint flex-shrink-0">#{m.ticket_id.slice(0, 6).toUpperCase()}</span>
            <button
              onClick={() => toggleMute.mutate({ ticketId: m.ticket_id, muted: false })}
              className="flex-shrink-0 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
            >
              {t('settings.notif.muted.unmute')}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-faint">{t('settings.notif.muted.note')}</p>
    </section>
  )
}

/**
 * Who gets told what, and where. Three channels with different reach: a toast
 * while the app is open, an OS notification when it is in the background, and
 * Telegram — the only one that leaves the VPN and arrives on a phone.
 */
export function NotificationSettings({ onClose }: { onClose?: () => void }) {
  const t = useT()
  const { value, patch, setEventChannel } = useNotificationPrefs()
  const [permission, setPermission] = useState(notificationPermission())
  const [testSent, setTestSent] = useState(false)
  const [telegramLinked, setTelegramLinked] = useState(false)

  const askPermission = async () => {
    const result = await requestNotificationPermission()
    setPermission(result)
    if (result === 'granted') patch({ browser: true })
  }

  const channelOn = { inApp: value.inApp, browser: value.browser, telegram: value.telegram && telegramLinked }
  const row = 'flex items-start gap-3 py-2.5'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-fg">{t('settings.tab.notifications')}</h3>
        <p className="text-xs text-fg-muted mt-0.5">{t('settings.notif.subtitle')}</p>
      </div>

      <section className="space-y-1">
        <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider">{t('settings.notif.channels')}</p>

        <div className={`${row} border-b border-line-soft`}>
          <Toggle on={value.inApp} onChange={(v) => patch({ inApp: v })} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">{t('settings.notif.channel.inApp')}</p>
            <p className="text-xs text-fg-muted">{t('settings.notif.channel.inAppHint')}</p>
          </div>
        </div>

        <div className={`${row} border-b border-line-soft`}>
          <Toggle
            on={value.browser && permission === 'granted'}
            disabled={permission === 'unsupported' || permission === 'denied'}
            onChange={(v) => (v && permission !== 'granted' ? askPermission() : patch({ browser: v }))}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">{t('settings.notif.channel.browser')}</p>
            <p className="text-xs text-fg-muted">
              {t('settings.notif.channel.browserHint')}
              {permission === 'denied' && <span className="text-warning"> {t('settings.notif.permDenied')}</span>}
              {permission === 'unsupported' && <span className="text-warning"> {t('settings.notif.permUnsupported')}</span>}
            </p>
            {permission === 'default' && (
              <button onClick={askPermission} className="mt-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised">
                {t('settings.notif.askPermission')}
              </button>
            )}
            {permission === 'granted' && (
              <button
                data-notif-test
                onClick={async () => {
                  // A real-looking one (#4029f71c): your own face and a status change,
                  // since "this is how they will look" should be true.
                  const me = await currentUser()
                  const { data: profile } = me
                    ? await supabase.from('profiles').select('id, full_name, avatar_url').eq('id', me.id).maybeSingle()
                    : { data: null }
                  const name = profile?.full_name || me?.email || t('settings.notif.testTitle')
                  const items: NotifyItem[] = [{ event: 'status', value: t('settings.notif.testStatus'), color: '#3b82f6' }]
                  const ticketTitle = t('settings.notif.testBody')
                  emitNotification(
                    {
                      id: `test-${Date.now()}`, event: 'status', ticketId: '',
                      ...popupText(name, true, items, ticketTitle),
                      actor: { id: profile?.id ?? me?.id ?? null, name, avatarUrl: profile?.avatar_url ?? null },
                      items, ticketTitle,
                    },
                    { inApp: true, browser: true },
                    { force: true },
                  )
                  setTestSent(true)
                  window.setTimeout(() => setTestSent(false), 3000)
                }}
                className="mt-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised"
              >
                {testSent ? t('settings.notif.sent') : t('settings.notif.sendTest')}
              </button>
            )}
          </div>
        </div>

        <TelegramSettings
          enabled={value.telegram}
          onEnabledChange={(v) => patch({ telegram: v })}
          onLinkedChange={setTelegramLinked}
        />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider">{t('settings.notif.events')}</p>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[22rem] text-left border-collapse">
            <thead>
              <tr>
                <th className="w-full" />
                {NOTIFICATION_CHANNELS.map((c) => (
                  <th key={c.id} className="px-1.5 pb-1.5 text-xs font-medium text-fg-muted text-center whitespace-nowrap">
                    {c.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map((e, i) => (
                <tr key={e.id} className={i < NOTIFICATION_EVENTS.length - 1 ? 'border-b border-line-soft' : ''}>
                  <td className="py-2.5 pr-3 align-top">
                    <p className="text-sm text-fg">{e.label}</p>
                    <p className="text-xs text-fg-muted">{e.hint}</p>
                  </td>
                  {NOTIFICATION_CHANNELS.map((c) => (
                    <td key={c.id} className="px-1.5 py-2.5 align-middle">
                      <Cell
                        on={value.events[e.id][c.id]}
                        disabled={!channelOn[c.id]}
                        onChange={(v) => setEventChannel(e.id, c.id, v)}
                        label={`${e.label} · ${c.label}`}
                        offLabel={t('settings.notif.channelOff')}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-fg-faint pt-1">{t('settings.notif.deliveryNote')}</p>
      </section>

      <MutedTickets onClose={onClose} />

      <section className="rounded-xl border border-line bg-raised/50 p-3">
        <p className="text-sm text-fg-2 font-medium">{t('settings.notif.email')}</p>
        <p className="text-xs text-fg-muted mt-0.5">{t('settings.notif.emailHint')}</p>
      </section>
    </div>
  )
}
