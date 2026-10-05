import { useState } from 'react'
import { useServerReach } from '../../hooks/useServerReach'
import { useT } from '../../i18n'

/**
 * Giriş ekranındaki ince uyarı (#b9e1bb66). Oturum açmadan önce de sunucuya
 * ulaşılamıyor olabilir; o zaman "Giriş yap" her denemede boş bir hataya
 * düşüyordu. Ekran açılırken bir kez yoklanır: sunucu ayaktaysa hiçbir şey
 * görünmez, değilse ne olduğu ve kaç saniye sonra yeniden deneneceği yazar.
 */
export function ServerReachBanner() {
  const t = useT()
  const [ok, setOk] = useState(false)
  const reach = useServerReach(() => setOk(true), !ok)
  // İlk yoklama sürerken sessiz kal: her açılışta bir satır yanıp sönmesin.
  if (ok || (reach.checking && reach.attempt <= 1)) return null
  return (
    <div role="status" aria-live="polite" className="mb-4 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-xs text-fg-2">
      <p className="font-semibold text-warning">{t('common.offline.title')}</p>
      <p className="mt-1 leading-relaxed">{t('common.offline.body')}</p>
      <p className="mt-1.5 flex items-center gap-2 text-fg-muted">
        {reach.checking ? (
          <>
            <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
            {t('common.offline.checking')}
          </>
        ) : (
          <span className="tabular-nums">{t('common.offline.retryIn', { n: reach.nextIn })}</span>
        )}
        <button type="button" onClick={reach.checkNow} disabled={reach.checking} className="ml-auto underline underline-offset-2 hover:text-fg disabled:opacity-50">
          {t('common.offline.retryNow')}
        </button>
      </p>
    </div>
  )
}
