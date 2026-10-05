import { useEffect, useState } from 'react'
import { refreshThemeColor } from './useTheme'

/**
 * Renk paleti (#e8d26977): nötr yüzeylerin ve yazının tonu. Marka rengi
 * (`primary-*`) tema-sabit kalır; palet yalnız `--c-*` nötr tokenlarını
 * değiştirir, açık/koyu tema ve kabuk (useShell) ile birlikte çalışır.
 *
 * Tema ve kabuk gibi localStorage'ta: ilk boyamadan önce lazım.
 */
export const PALETTES = ['default', 'graphite', 'sand', 'midnight', 'contrast'] as const
export type Palette = (typeof PALETTES)[number]

const KEY = 'palette'
// 'fira:palette' komut paletinin açılma olayı (lib/palette.ts); aynı adı taşıyınca
// renk paletini değiştirmek arama çubuğunu açıyordu (#1aae9955).
const CHANGED = 'fira:color-palette'

export function readPalette(): Palette {
  try {
    const v = localStorage.getItem(KEY) as Palette | null
    return v && (PALETTES as readonly string[]).includes(v) ? v : 'default'
  } catch {
    return 'default'
  }
}

/** <html data-palette="…"> — `default` bayrak yazmaz, bugünkü tokenlar geçerli. */
export function applyStoredPalette() {
  const p = readPalette()
  if (p === 'default') document.documentElement.removeAttribute('data-palette')
  else document.documentElement.setAttribute('data-palette', p)
  // Kurulu PWA penceresinin şerit rengi `--c-nav`'den okunuyor.
  refreshThemeColor()
}

export function setPalette(p: Palette) {
  try { localStorage.setItem(KEY, p) } catch { /* özel pencerede yazamayabiliriz */ }
  applyStoredPalette()
  window.dispatchEvent(new Event(CHANGED))
}

export function usePalette() {
  const [palette, set] = useState<Palette>(readPalette)
  useEffect(() => {
    const follow = () => set(readPalette())
    window.addEventListener(CHANGED, follow)
    return () => window.removeEventListener(CHANGED, follow)
  }, [])
  return { palette, setPalette }
}
