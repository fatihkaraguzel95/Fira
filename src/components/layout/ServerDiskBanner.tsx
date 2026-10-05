import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { Link } from 'react-router-dom'
import { useIsAdmin, useServerDisk, useSystemSettings } from '../../hooks/useAdmin'
import { useT } from '../../i18n'
import { usePrefs, GLOBAL_SCOPE } from '../../hooks/usePrefs'
import { isSnoozed, snoozeFrom, snoozeLeft, type AlertSnooze } from '../../lib/adminAlerts'

/**
 * Disk warning for system admins, on every board screen (DK-5, #addb4475).
 * On 18 Sep 2026 the server disk filled, the database could not start and Fira
 * failed for everyone — while the status collector had been reporting 100% for
 * hours on an admin page nobody was looking at. Same threshold as the admin
 * page's alert list (`system_settings.alerts.disk_pct`, default 85). Closing it
 * hides it for an hour (#214fe1d8, `lib/adminAlerts.ts`) — in the account's
 * prefs, so a reload or another device keeps it hidden — unless it turns from a
 * warning into danger (95%+), which shows it again at once.
 */
export function ServerDiskBanner() {
  const t = useT()
  const { data: isAdmin } = useIsAdmin()
  const settings = useSystemSettings()
  const { data } = useServerDisk(!!isAdmin)
  const prefs = usePrefs(GLOBAL_SCOPE)
  const snooze = (prefs.prefs as { adminAlerts?: { disk?: AlertSnooze } }).adminAlerts?.disk ?? null
  // Erteleme bitince kendini yeniden çizsin (bir saat sonra uyarı geri gelir).
  const [, setTick] = useState(0)
  useEffect(() => {
    const left = snoozeLeft(snooze, Date.now())
    if (!left) return
    const id = window.setTimeout(() => setTick((n) => n + 1), Math.min(left + 500, 2 ** 31 - 1))
    return () => window.clearTimeout(id)
  }, [snooze?.until]) // eslint-disable-line react-hooks/exhaustive-deps
  const disk = data?.disk
  const threshold = settings.data?.alerts?.disk_pct ?? 85
  // Tercihler gelmeden çizilmez: ertelenmiş uyarı bir an görünüp kaybolmasın.
  if (!isAdmin || !disk || disk.pct < threshold || !prefs.loaded) return null
  const danger = disk.pct >= 95
  const level = danger ? 'danger' : 'warn'
  if (isSnoozed(snooze, level, Date.now())) return null
  const free = `${(disk.avail / 1024 ** 3).toFixed(1)} GB`
  return (
    <div role="alert" data-disk-banner className={`flex items-center gap-3 px-4 py-2 text-sm border-b ${danger ? 'bg-danger/10 text-danger border-danger/30' : 'bg-warning/10 text-fg border-warning/30'}`}>
      <Icon name="warning" className={`${danger ? '' : 'text-warning'}`} />
      <span className="flex-1">{t('misc.admin.diskBanner', { n: disk.pct, free })}</span>
      <Link to="/admin" className="inline-flex items-center min-h-6 text-xs font-semibold underline underline-offset-2 hover:opacity-80 whitespace-nowrap">{t('misc.admin.diskBannerOpen')}</Link>
      <button type="button" onClick={() => prefs.patch({ v: 1, adminAlerts: { disk: snoozeFrom(Date.now(), level) } })} data-disk-banner-hide
        className="tap inline-flex items-center justify-center w-6 h-6 rounded-md text-xs opacity-70 hover:opacity-100 hover:bg-fg/10" aria-label={t('misc.admin.diskBannerHide')} title={t('misc.admin.diskBannerHide')}>✕</button>
    </div>
  )
}
