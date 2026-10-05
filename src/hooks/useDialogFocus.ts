import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',')

/**
 * The keyboard contract of a dialog (WCAG 2.1.2 / 2.4.3): focus moves into it
 * when it opens, Tab and Shift+Tab cycle inside it, and when it closes focus
 * returns to whatever opened it. Pass `initial` to choose the first target;
 * the default is the first focusable element, else the container itself.
 *
 * Popovers rendered through a portal (assignees, link picker, fullscreen
 * editor) live outside the container: while focus is in one of them the trap
 * stays out of the way, so they keep their own keyboard behaviour.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  open = true,
  initial?: () => HTMLElement | null | undefined,
) {
  useEffect(() => {
    if (!open) return
    const root = ref.current
    if (!root) return
    const opener = document.activeElement as HTMLElement | null
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)

    // After the first layout, so the open animation does not fight the scroll.
    const t = window.setTimeout(() => {
      if (root.contains(document.activeElement)) return
      const first = initial?.() ?? focusables()[0] ?? root
      first.focus({ preventScroll: true })
    }, 0)

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !root.contains(e.target as Node)) return
      const list = focusables()
      if (!list.length) { e.preventDefault(); root.focus(); return }
      const i = list.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus() }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
    // `initial` is a picker, not a dependency: re-running on every render would re-focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, open])
}
