import { useSyncExternalStore } from 'react'

/**
 * Is the window at least Tailwind's `md` wide (768 px)? For layouts that exist
 * twice — a desktop version and a phone version — and whose content is too
 * heavy to mount in both and hide one with CSS: the sidebar's panel drew every
 * team's tree twice, once inside the phone drawer nobody could see (#20c4ed37).
 */
const QUERY = '(min-width: 768px)'
const subscribe = (onChange: () => void) => {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => true)
}
