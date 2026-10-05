import { useEffect, useState } from 'react'
import { refreshThemeColor } from './useTheme'

/**
 * Uygulama kabuğunun görünümü (#1aae9955, beta).
 *
 * `classic` bugünkü hâl. `soft` MS Teams düzeni: şerit, üst çubuk ve panel
 * **aynı** koyu gride buluşur, pano/liste ise köşeleri yuvarlak, gölgeli, tam
 * beyaz (koyu temada tam siyah) bir yaprağın içinde açılır.
 *
 * Tercih — temanın kendisi gibi — localStorage'ta: kabuk ilk boyamadan önce
 * uygulanmalı, yoksa her açılışta bir kare yanlış çerçeve görünür (oturum
 * sunucudan gelene kadar bekleyemeyiz). Varsayılan `classic`: beta, isteyen
 * Profil > Beta özellikler'den açar.
 */
export type ShellMode = 'classic' | 'soft'

const KEY = 'shell'
const CHANGED = 'fira:shell'

export function readShellMode(): ShellMode {
  try {
    return localStorage.getItem(KEY) === 'soft' ? 'soft' : 'classic'
  } catch {
    return 'classic'
  }
}

/** <html data-shell="soft"> — bütün kural seti bu bayrağa asılı. */
export function applyStoredShell() {
  const soft = readShellMode() === 'soft'
  if (soft) document.documentElement.setAttribute('data-shell', 'soft')
  else document.documentElement.removeAttribute('data-shell')
  // Kurulu PWA penceresindeki şerit rengi `--c-nav`'den okunuyor; kabuk onu
  // değiştirdiği için damga tazelenir (useTheme.navColor).
  refreshThemeColor()
}

export function setShellMode(mode: ShellMode) {
  try { localStorage.setItem(KEY, mode) } catch { /* özel pencerede yazamayabiliriz */ }
  applyStoredShell()
  window.dispatchEvent(new Event(CHANGED))
}

/** Aynı anda açık birden çok kopya (ayarlar penceresi, profil menüsü) için. */
export function useShell() {
  const [mode, setMode] = useState<ShellMode>(readShellMode)
  useEffect(() => {
    const follow = () => setMode(readShellMode())
    window.addEventListener(CHANGED, follow)
    return () => window.removeEventListener(CHANGED, follow)
  }, [])
  return { mode, soft: mode === 'soft', setMode: setShellMode }
}
