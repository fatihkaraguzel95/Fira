import { useEffect } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { hasUnsaved } from '../../lib/unsaved'
import { isEditableTarget } from '../../lib/keys'
import { applyUpdate, markUpdateReady, setUpdateRegistration, updateState } from '../../lib/appUpdate'

/**
 * Registers the service worker and applies new builds. Draws nothing: a waiting
 * build shows as the "Güncelle" button in the top bar (`UpdateButton`, #2aa4f068).
 *
 * Several small releases a day meant a "new version" bar every time (#5A06299B),
 * so a waiting build is also applied ON ITS OWN when nobody would notice: the
 * tab is hidden, or it has been idle for a while — and never while there is
 * unsaved text or the cursor sits in a field.
 */
const IDLE_MS = 3 * 60 * 1000
const POLL_MS = 30 * 1000
const CHECK_MS = 15 * 60 * 1000

const quiet = () => !hasUnsaved() && !isEditableTarget(document.activeElement)

export function UpdateWatcher() {
  useEffect(() => {
    let lastInput = Date.now()
    registerSW({
      onNeedRefresh: markUpdateReady,
      onRegisteredSW: (_url, reg) => {
        setUpdateRegistration(reg ?? null)
        if (reg) setInterval(() => reg.update().catch(() => {}), CHECK_MS)
      },
    })
    const touch = () => { lastInput = Date.now() }
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, touch, { passive: true, capture: true })
    // The moments an update may land unnoticed.
    const onVisibility = () => { if (document.visibilityState === 'hidden' && updateState().ready && quiet()) void applyUpdate() }
    document.addEventListener('visibilitychange', onVisibility)
    const idle = window.setInterval(() => {
      if (updateState().ready && quiet() && Date.now() - lastInput > IDLE_MS) void applyUpdate()
    }, POLL_MS)
    return () => {
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.removeEventListener(ev, touch, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(idle)
    }
  }, [])
  return null
}
