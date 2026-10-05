/**
 * Yönetici uyarısını ertelemek (#214fe1d8): kapatılan uyarı bir saat görünmez.
 * Kayıt hesap tercihinde (`user_preferences` global `adminAlerts`), yani sayfa
 * yenilense ya da başka cihazdan girilse de geçerli. Önce kapatma yalnız bileşenin
 * hafızasındaydı: yenilemede ve disk yüzdesi bir puan artınca uyarı hemen geri
 * geliyordu.
 *
 * İstisna: ertelenirken durum ağırlaşırsa (sarı uyarı → kırmızı tehlike, disk %95+)
 * uyarı beklemeden geri gelir — 18 Eyl'deki disk dolması kesintisi saatler içinde oldu.
 */
export const ADMIN_ALERT_SNOOZE_MS = 60 * 60 * 1000

export type AlertLevel = 'warn' | 'danger'

export interface AlertSnooze {
  until: string
  level: AlertLevel
}

export function snoozeFrom(now: number, level: AlertLevel): AlertSnooze {
  return { until: new Date(now + ADMIN_ALERT_SNOOZE_MS).toISOString(), level }
}

/** Uyarı şu an gizli mi: süre dolmadıysa ve seviye ertelendiğinden ağır değilse. */
export function isSnoozed(snooze: AlertSnooze | null | undefined, level: AlertLevel, now: number): boolean {
  if (!snooze) return false
  const until = Date.parse(snooze.until)
  if (!Number.isFinite(until) || until <= now) return false
  return !(level === 'danger' && snooze.level !== 'danger')
}

/** Ertelemenin bitmesine kalan süre (ms); bitmişse ya da yoksa 0. */
export function snoozeLeft(snooze: AlertSnooze | null | undefined, now: number): number {
  const until = snooze ? Date.parse(snooze.until) : NaN
  return Number.isFinite(until) ? Math.max(0, until - now) : 0
}
