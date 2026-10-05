// Keyboard helpers shared by nested overlays (ticket modal → subtask view).
type MarkedKeyEvent = KeyboardEvent & { firaHandled?: boolean }

/** Mark a native key event as consumed by an inner overlay so outer listeners ignore it. */
export const markHandled = (e: KeyboardEvent) => { (e as MarkedKeyEvent).firaHandled = true }
export const wasHandled = (e: KeyboardEvent) => !!(e as MarkedKeyEvent).firaHandled

/** True when the key event originates from a text field / editor. */
export const isEditableTarget = (t: EventTarget | null): t is HTMLElement =>
  t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]')

/**
 * "Esc in a field only leaves the field": after the field's own handlers ran,
 * blur it if it is still focused and nobody claimed the key (defaultPrevented).
 */
export const blurAfterEscape = (e: KeyboardEvent, t: HTMLElement) => {
  requestAnimationFrame(() => {
    if (!e.defaultPrevented && document.activeElement === t) t.blur()
  })
}
