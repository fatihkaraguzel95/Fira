import { isEditableTarget } from './keys'

/**
 * Copying out of Fira carries the content, not Fira's look (#55bed0f7).
 *
 * The editor already puts clean HTML on the clipboard (ProseMirror serialises
 * the document). Everywhere else — a comment, a page being read, a title — the
 * browser copies by writing every computed style inline: background, text
 * colour, font, even Tailwind's variables. A comment of a few lines was 69 KB of
 * HTML, and pasted into a mail it kept the theme's background behind the text
 * (a dark box, when copied in the dark theme).
 *
 * So a copy of selected text anywhere outside a field is rebuilt from the
 * selection: the same structure (paragraphs, headings, lists, tables, code,
 * links, bold…) with no styles, classes or interface chrome. The plain-text
 * half stays what the browser would have written.
 */

/** Kept as they are. Anything else is unwrapped (inline) or becomes a plain `div` (block). */
const KEEP = new Set([
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'code', 'pre', 'a', 'img',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
])
/** Never copied: no text of their own, or the interface's rather than the content's. */
const DROP = new Set(['svg', 'script', 'style', 'noscript', 'template', 'select', 'textarea', 'canvas', 'video', 'audio', 'iframe', 'object'])
const VOID = new Set(['br', 'hr', 'img', 'input'])
/** Stays even when empty: an empty cell still holds the table's shape. */
const SHAPE = new Set(['td', 'th'])
/**
 * Context a partial selection keeps from above it: half a bold word is still
 * bold, two list items still need their list, cells need their table.
 */
const CONTEXT = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'code', 'pre', 'a', 'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr'])

const tagOf = (el: Element) => el.tagName.toLowerCase()

function hidden(el: Element): boolean {
  const cs = getComputedStyle(el)
  return cs.display === 'none' || cs.visibility === 'hidden' || cs.userSelect === 'none'
}

/** The element in its clean form: the tag and the few attributes that carry meaning. */
function shell(el: Element): HTMLElement {
  const tag = tagOf(el)
  const out = document.createElement(tag)
  if (tag === 'a') {
    const raw = el.getAttribute('href') ?? ''
    // Relative addresses mean nothing outside Fira; Fira's own schemes (mentions) stay as written.
    if (raw) out.setAttribute('href', /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : (el as HTMLAnchorElement).href || raw)
  } else if (tag === 'img') {
    const src = (el as HTMLImageElement).src || el.getAttribute('src') || ''
    if (src) out.setAttribute('src', src)
    for (const a of ['alt', 'width', 'height']) { const v = el.getAttribute(a); if (v) out.setAttribute(a, v) }
  } else if (tag === 'td' || tag === 'th') {
    for (const a of ['colspan', 'rowspan']) { const v = el.getAttribute(a); if (v && v !== '1') out.setAttribute(a, v) }
  } else if (tag === 'ol') {
    const v = el.getAttribute('start'); if (v) out.setAttribute('start', v)
  } else if (tag === 'code') {
    const lang = Array.from(el.classList).find((c) => c.startsWith('language-'))
    if (lang) out.className = lang
  }
  return out
}

/** The part of `node` inside `range`, cleaned; null when nothing of it is left. */
function clean(node: Node, range: Range): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const data = (node as Text).data
    const from = node === range.startContainer ? range.startOffset : 0
    const to = node === range.endContainer ? range.endOffset : data.length
    const text = data.slice(from, to)
    return text ? document.createTextNode(text) : null
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = tagOf(el)
  if (DROP.has(tag) || hidden(el)) return null
  if (tag === 'input') {
    // A task list's box: the one input that is content.
    if ((el as HTMLInputElement).type !== 'checkbox') return null
    const box = document.createElement('input')
    box.setAttribute('type', 'checkbox')
    if ((el as HTMLInputElement).checked) box.setAttribute('checked', '')
    box.setAttribute('disabled', '')
    return box
  }
  const kids: Node[] = []
  for (const child of Array.from(el.childNodes)) {
    if (!range.intersectsNode(child)) continue
    const c = clean(child, range)
    if (c) kids.push(c)
  }
  if (KEEP.has(tag)) {
    if (!kids.length && !VOID.has(tag) && !SHAPE.has(tag)) return null
    const out = shell(el)
    kids.forEach((k) => out.appendChild(k))
    return out
  }
  if (!kids.length) return null
  // Unknown wrapper: a block keeps its line (a `div`), an inline one dissolves into its content.
  const inline = /^(inline|contents)/.test(getComputedStyle(el).display)
  const out: Node = inline ? document.createDocumentFragment() : document.createElement('div')
  kids.forEach((k) => out.appendChild(k))
  return out
}

/** Clean HTML for what `range` selects; '' when there is nothing to copy. */
export function cleanRangeHtml(range: Range): string {
  const top = range.commonAncestorContainer
  const root = (top.nodeType === Node.ELEMENT_NODE ? top : top.parentElement) as Element | null
  if (!root) return ''
  const box = document.createElement('div')
  if (top.nodeType === Node.TEXT_NODE) {
    const t = clean(top, range)
    if (t) box.appendChild(t)
  } else {
    for (const child of Array.from(root.childNodes)) {
      if (!range.intersectsNode(child)) continue
      const c = clean(child, range)
      if (c) box.appendChild(c)
    }
  }
  if (!box.childNodes.length) return ''
  // Put back what the selection stood in.
  let content: Node[] = Array.from(box.childNodes)
  for (let el: Element | null = root; el && el !== document.body && CONTEXT.has(tagOf(el)); el = el.parentElement) {
    const wrap = shell(el)
    content.forEach((n) => wrap.appendChild(n))
    content = [wrap]
  }
  const out = document.createElement('div')
  content.forEach((n) => out.appendChild(n))
  return out.innerHTML
}

/**
 * One listener for the whole app, after everybody else's: a copy that someone
 * already handled (the editor, a canvas) or that comes from a field is left
 * alone. `data-native-copy` on an ancestor opts a region out.
 */
export function installCleanCopy() {
  document.addEventListener('copy', (e) => {
    if (e.defaultPrevented || !e.clipboardData) return
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const top = range.commonAncestorContainer
    const host = top.nodeType === Node.ELEMENT_NODE ? (top as Element) : top.parentElement
    if (!host || host.closest('[data-native-copy], .ProseMirror, .excalidraw')) return
    const text = sel.toString()
    if (!text) return
    let html = ''
    try { html = cleanRangeHtml(range) } catch { return }   // the browser's own copy is the fallback
    if (!html) return
    e.clipboardData.setData('text/html', html)
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  })
}
