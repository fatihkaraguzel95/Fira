import { useState } from 'react'
import { FiraMark } from '../ui/Logo'
import { useServerReach } from '../../hooks/useServerReach'
import { useT } from '../../i18n'

/**
 * Açılışta sunucuya ulaşılamadığında dönen tekerleğin yerine geçen ekran
 * (#b9e1bb66). Üç şeyi söyler: ulaşılamıyor, muhtemel sebep (VPN / kapalı
 * sunucu) ve **kaç saniye sonra** yeniden deneneceği. Deneme kendiliğinden ve
 * artan aralıklarla sürer; "Şimdi dene" beklemeyi atlar.
 *
 * Sunucuya ulaşılınca sayfa yeniden yüklenir: açılış oturumu okurken takıldığı
 * için (GoTrue yenilemesi ağ gelene kadar asılı kalıyor) en temiz kurtarma
 * baştan başlamak. Aynı oturumda ikiden fazla yeniden yükleme yapılmaz; o
 * noktada sorun ağ değil oturumdur, ekran giriş sayfasını önerir.
 */
const RELOADS_KEY = 'fira.bootReloads'

export function ServerUnreachable() {
  const t = useT()
  const [sessionStuck, setSessionStuck] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const reach = useServerReach(() => {
    // Sunucu cevap verdi. Hemen yeniden yüklemiyoruz: açılış yavaş bir bağlantıda
    // hâlâ sürüyor olabilir, kendi kendine bitiverirse bu ekran zaten kalkar.
    // Üç saniye sonra hâlâ buradaysak baştan başlamak en temizi.
    setRecovering(true)
    window.setTimeout(() => {
      let n = 0
      try { n = Number(sessionStorage.getItem(RELOADS_KEY) ?? '0') } catch { n = 0 }
      if (n >= 2) { setSessionStuck(true); return }
      try { sessionStorage.setItem(RELOADS_KEY, String(n + 1)) } catch { /* özel pencere */ }
      window.location.reload()
    }, 3000)
  }, !sessionStuck && !recovering)

  return (
    <div className="min-h-screen bg-app flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface border border-line rounded-xl shadow-sm p-6 text-center">
        <div className="flex justify-center mb-4"><FiraMark size={40} /></div>

        {sessionStuck ? (
          <>
            <h1 className="text-base font-semibold text-fg">{t('common.offline.sessionTitle')}</h1>
            <p className="text-sm text-fg-2 mt-2 leading-relaxed">{t('common.offline.sessionBody')}</p>
            <a
              href="/login"
              className="mt-5 inline-flex items-center justify-center h-9 px-4 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
            >
              {t('common.offline.toLogin')}
            </a>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold text-fg">{t('common.offline.title')}</h1>
            <p className="text-sm text-fg-2 mt-2 leading-relaxed">{t('common.offline.body')}</p>
            <p className="text-xs text-fg-muted mt-3 leading-relaxed">{t('common.offline.hint')}</p>

            <div className="mt-5 flex items-center justify-center gap-2 text-sm text-fg-muted min-h-[1.5rem]" role="status" aria-live="polite">
              {recovering ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-success border-t-transparent animate-spin" aria-hidden />
                  {t('common.offline.recovering')}
                </>
              ) : reach.checking ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" aria-hidden />
                  {t('common.offline.checking')}
                </>
              ) : (
                <span className="tabular-nums">{t('common.offline.retryIn', { n: reach.nextIn })}</span>
              )}
            </div>

            <button
              type="button"
              onClick={reach.checkNow}
              disabled={reach.checking || recovering}
              className="mt-3 inline-flex items-center justify-center h-9 px-4 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {t('common.offline.retryNow')}
            </button>

            {reach.attempt > 1 && (
              <p className="text-xs text-fg-faint mt-3">{t('common.offline.attempts', { n: reach.attempt })}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
