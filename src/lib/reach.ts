/**
 * "Sunucuya ulaşabiliyor muyum?" (#b9e1bb66).
 *
 * Ofis ağına (VPN) bağlı değilken paketler kara deliğe gidiyor: TCP bağlantısı
 * düşmüyor, zaman aşımını bekliyor. Bu yüzden uygulama açılışta oturumu okumaya
 * çalışırken dakikalarca dönen bir tekerlekte kalıyordu — ne hata, ne bilgi.
 *
 * Buradaki yoklama ucuz ve **kendi zaman aşımı** olan bir istek: GoTrue'nun
 * sağlık adresi. Cevap veriyorsa sunucu ayakta ve ağ açık demektir; vermiyorsa
 * ekranda ne olduğunu ve ne zaman yeniden deneneceğini söyleyebiliriz.
 */
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase'

/** Artan aralıklar (saniye): önce sık, sonra seyrek; en fazla bir dakika. */
export const RETRY_STEPS = [5, 10, 20, 30, 60]

export const retryDelay = (attempt: number) => RETRY_STEPS[Math.min(Math.max(0, attempt), RETRY_STEPS.length - 1)]

/** Tek yoklama. `false` = ulaşılamadı (ağ yok, VPN kapalı, sunucu kapalı, zaman aşımı). */
export async function pingServer(timeoutMs = 7000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { apikey: SUPABASE_ANON_KEY },
    })
    return res.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}
