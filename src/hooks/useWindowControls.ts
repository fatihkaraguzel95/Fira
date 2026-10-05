import { useEffect, useState } from 'react'

/**
 * Pencere kontrolleri kaplaması (#0DD02686) — yüklü PWA'da başlık çubuğunu
 * uygulamanın kendisi çizer.
 *
 * Kullanıcının isteği: Teams'in yüklü sürümündeki gibi ayrı bir işletim sistemi
 * başlık çubuğu olmasın, uygulamanın üst çubuğu doğrudan o satırda dursun ve
 * pencere düğmeleri (küçült/büyüt/kapat) onun sağında yer alsın.
 *
 * Tarayıcı bunu `display_override: ["window-controls-overlay"]` ile açıyor;
 * yerleşim `env(titlebar-area-*)` değişkenlerinden geliyor. Burada yalnız
 * "açık mı" bilgisini `<html data-wco>` olarak yazıyoruz — ölçüleri CSS
 * okuyor, böylece değerler pencere boyutuyla birlikte kendiliğinden değişiyor.
 */
interface WCO {
  visible: boolean
  addEventListener(type: 'geometrychange', fn: () => void): void
  removeEventListener(type: 'geometrychange', fn: () => void): void
}

const overlay = (): WCO | null =>
  (navigator as Navigator & { windowControlsOverlay?: WCO }).windowControlsOverlay ?? null

export function useWindowControlsOverlay(): boolean {
  const [on, setOn] = useState(() => !!overlay()?.visible)

  useEffect(() => {
    const wco = overlay()
    if (!wco) return
    const sync = () => {
      const visible = !!wco.visible
      setOn(visible)
      // CSS tarafı da bilsin: kaplama yokken hiçbir şey değişmemeli.
      document.documentElement.toggleAttribute('data-wco', visible)
    }
    sync()
    wco.addEventListener('geometrychange', sync)
    return () => wco.removeEventListener('geometrychange', sync)
  }, [])

  return on
}
