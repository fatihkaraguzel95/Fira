import { useSyncExternalStore } from 'react'

/**
 * Whether a newer build is waiting, and how it is applied (#2aa4f068).
 *
 * One store, because two places care: `UpdateWatcher` (App) registers the
 * service worker and applies a waiting build on its own at a quiet moment, and
 * the top bar shows "Güncelle" while one waits. Pressing it is done properly
 * (v0.20.2, #5A06299B): the waiting worker is told to take over and we wait for
 * it to control the page before reloading; if that does not happen (the waiting
 * worker was replaced by an even newer one, an installed PWA window, browser
 * quirks) every worker and cache is dropped and the page reloads from the
 * server — the result is always the current build.
 */
interface UpdateState { ready: boolean; busy: boolean }

let state: UpdateState = { ready: false, busy: false }
let registration: ServiceWorkerRegistration | null = null
const listeners = new Set<() => void>()
const set = (next: UpdateState) => { state = next; listeners.forEach((l) => l()) }

export const updateState = () => state
export const markUpdateReady = () => { if (!state.ready) set({ ...state, ready: true }) }
export const setUpdateRegistration = (reg: ServiceWorkerRegistration | null) => { registration = reg }

export function useAppUpdate(): UpdateState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, updateState)
}

export async function applyUpdate() {
  if (!state.ready || state.busy) return
  set({ ready: true, busy: true })
  const sw = navigator.serviceWorker
  let reloaded = false
  const reload = () => { if (!reloaded) { reloaded = true; window.location.reload() } }
  try {
    const reg = registration ?? (await sw?.getRegistration()) ?? null
    // A newer build may have started installing since the button appeared: let it finish.
    const worker = await waitingWorker(reg, 6000)
    if (worker && sw) {
      const claimed = new Promise<boolean>((resolve) => {
        const done = () => resolve(true)
        sw.addEventListener('controllerchange', done, { once: true })
        window.setTimeout(() => { sw.removeEventListener('controllerchange', done); resolve(false) }, 4000)
      })
      worker.postMessage({ type: 'SKIP_WAITING' })
      if (await claimed) { reload(); return }
    }
    // Nothing took over: drop every worker and cache, the reload fetches the current build.
    const regs = await sw?.getRegistrations() ?? []
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* the reload below still gets the new files from the server */
  }
  reload()
}

/** The worker that is ready to take over — waiting now, or installing and about to be. */
function waitingWorker(reg: ServiceWorkerRegistration | null, timeoutMs: number): Promise<ServiceWorker | null> {
  if (!reg) return Promise.resolve(null)
  if (reg.waiting) return Promise.resolve(reg.waiting)
  const installing = reg.installing
  if (!installing) return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(reg.waiting), timeoutMs)
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') { window.clearTimeout(timer); resolve(reg.waiting ?? installing) }
      else if (installing.state === 'redundant') { window.clearTimeout(timer); resolve(reg.waiting) }
    })
  })
}

// QA: show the button without waiting for a real deploy (pressing it still reloads properly).
if (typeof window !== 'undefined') {
  (window as unknown as { __firaUpdatePreview?: () => void }).__firaUpdatePreview = markUpdateReady
}
