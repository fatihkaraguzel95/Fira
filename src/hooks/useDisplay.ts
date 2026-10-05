import { useEffect, useState } from 'react'

/**
 * Yoğunluk ve yazı boyutu (#9b2229bb). Palet ve kabuk gibi localStorage'ta ve
 * `<html>` bayrağıyla uygulanır: ilk boyamadan önce lazım (oturum sunucudan gelene
 * kadar yanlış ölçüyle bir kare görünmesin) ve cihaza özgü — telefonda büyük yazı
 * isteyen masaüstünde istemeyebilir.
 *
 *  - `data-density="compact"`: pano kartları ve kenar çubuğu ağacı daralır (index.css).
 *    Liste görünümünün kendi yoğunluk seçimi var (görünüm başına), ona dokunmaz.
 *  - `data-font-size`: kök yazı ölçeği. rem ile verilen yazı ve boşluklar birlikte
 *    büyür; piksel sabit yazılar büyümez.
 */
export type UiDensity = 'comfortable' | 'compact'
export const FONT_SIZES = ['sm', 'md', 'lg', 'xl'] as const
export type FontSize = (typeof FONT_SIZES)[number]

const DENSITY_KEY = 'density'
const FONT_KEY = 'fontSize'
const CHANGED = 'fira:display'

const read = (key: string) => {
  try { return localStorage.getItem(key) } catch { return null }
}

export function readDensity(): UiDensity {
  return read(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
}

export function readFontSize(): FontSize {
  const v = read(FONT_KEY) as FontSize | null
  return v && (FONT_SIZES as readonly string[]).includes(v) ? v : 'md'
}

/** Varsayılanlar bayrak yazmaz: bugünkü ölçüler geçerli. */
export function applyStoredDisplay() {
  const root = document.documentElement
  if (readDensity() === 'compact') root.setAttribute('data-density', 'compact')
  else root.removeAttribute('data-density')
  const size = readFontSize()
  if (size === 'md') root.removeAttribute('data-font-size')
  else root.setAttribute('data-font-size', size)
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* özel pencerede yazamayabiliriz */ }
  applyStoredDisplay()
  window.dispatchEvent(new Event(CHANGED))
}

export const setDensity = (d: UiDensity) => write(DENSITY_KEY, d === 'compact' ? 'compact' : null)
export const setFontSize = (f: FontSize) => write(FONT_KEY, f === 'md' ? null : f)

/** Aynı anda açık birden çok kopya için (ayarlar penceresi, profil menüsü). */
export function useDisplay() {
  const [state, set] = useState(() => ({ density: readDensity(), fontSize: readFontSize() }))
  useEffect(() => {
    const follow = () => set({ density: readDensity(), fontSize: readFontSize() })
    window.addEventListener(CHANGED, follow)
    return () => window.removeEventListener(CHANGED, follow)
  }, [])
  return { ...state, setDensity, setFontSize }
}
