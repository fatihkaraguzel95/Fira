/**
 * Open the top bar's command palette with some text already in it (#9ab8db99):
 * the list header lost its own search box, so "search this list" (the "/" key,
 * the palette's own command) opens the palette narrowed to the open list —
 * `liste:"Web sitesi yenileme" ` — and the user types on from there.
 */
const EVENT = 'fira:palette'

export function openPalette(text = '') {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: text }))
}

export function onOpenPalette(fn: (text: string) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<string>).detail ?? '')
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/** The palette filter that narrows a search to one list (quoted when the name has spaces). */
export const listFilter = (name: string, lang: 'tr' | 'en' | 'de') => {
  const key = lang === 'tr' ? 'liste' : 'list'
  const v = /[\s"]/.test(name) ? `"${name.replace(/"/g, '')}"` : name
  return `${key}:${v} `
}
