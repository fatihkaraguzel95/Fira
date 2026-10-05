import { useCallback, useEffect, useRef, useState } from 'react'
import { pingServer, retryDelay } from '../lib/reach'

/**
 * Sunucuya ulaşana kadar artan aralıklarla dener ve geri sayımı söyler
 * (#b9e1bb66). Ekran ne olduğunu yazabilsin diye durum dışarı verilir:
 * yoklama sürüyor mu, kaçıncı deneme, kaç saniye sonra tekrar.
 */
export interface ServerReach {
  /** Şu an bir yoklama sürüyor mu. */
  checking: boolean
  /** Kaçıncı deneme (1'den başlar; ekranda "3. deneme" diye yazılır). */
  attempt: number
  /** Sonraki denemeye kalan saniye (yoklama sürerken 0). */
  nextIn: number
  /** Beklemeyi atla, hemen dene. */
  checkNow: () => void
}

export function useServerReach(onReachable: () => void, active = true): ServerReach {
  const [checking, setChecking] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [nextIn, setNextIn] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const countdown = useRef<number | undefined>(undefined)
  const reached = useRef(onReachable)
  reached.current = onReachable
  const busy = useRef(false)
  const tries = useRef(0)

  const stop = () => {
    window.clearTimeout(timer.current)
    window.clearInterval(countdown.current)
  }

  const run = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    stop()
    setNextIn(0)
    setChecking(true)
    tries.current += 1
    setAttempt(tries.current)
    const ok = await pingServer()
    setChecking(false)
    busy.current = false
    if (ok) { reached.current(); return }
    // Ulaşılamadı: bir sonraki denemeyi kur ve geri sayımı göster.
    const wait = retryDelay(tries.current - 1)
    setNextIn(wait)
    countdown.current = window.setInterval(() => setNextIn((n) => (n > 0 ? n - 1 : 0)), 1000)
    timer.current = window.setTimeout(() => { void run() }, wait * 1000)
  }, [])

  useEffect(() => {
    if (!active) return
    void run()
    // Ağ geri geldiğinde beklemeden dene: tarayıcı bunu bize söylüyor.
    const wake = () => { void run() }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake() })
    return () => { stop(); window.removeEventListener('online', wake) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return { checking, attempt, nextIn, checkNow: () => void run() }
}
