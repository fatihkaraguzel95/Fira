/**
 * The converter's HTML → Fira pages: title, dates, indent level, markdown body,
 * and the images/files each page uses. Browser-only (DOMParser).
 *
 * Images keep OneNote's own OCR text as their alt text, so a picture imported
 * from OneNote is findable by what is written inside it — no OCR on our side.
 * Asset references are left as `fira-asset-N` tokens; the importer swaps in the
 * storage URL once it knows the page id the files are stored under.
 */
import TurndownService from 'turndown'
import type { SectionOutput } from './convert'

export interface OneNoteAsset {
  /** File name inside the section output. */
  name: string
  bytes: Uint8Array
}

export interface OneNotePage {
  /** OneNote page GUID — stable across exports; becomes pages.source_ref. */
  ref: string
  title: string
  /** 1 = top level; 2, 3 = OneNote subpages. */
  level: number
  createdAt: string | null
  updatedAt: string | null
  /** Markdown with `fira-asset-N` tokens where assets[N] goes. */
  markdown: string
  assets: OneNoteAsset[]
  /** How many of the page's images carry OneNote OCR text. */
  ocrImages: number
  /** Who last changed this state in OneNote (as OneNote records it). */
  author: string | null
  /** Earlier states from the file, newest first, each different from the next newer one. */
  history: OneNoteRevision[]
}

export type OneNoteRevision = Omit<OneNotePage, 'history' | 'level' | 'ref'>

export const assetToken = (i: number) => `fira-asset-${i}`
export const ASSET_TOKEN_RE = /fira-asset-(\d+)/g

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

// To-do tag markers: invisible separators around a letter, so turndown neither
// escapes nor merges them; tasksToMarkdown turns them into task items.
const TASK_DONE = '⁣TX⁣'
const TASK_OPEN = '⁣TO⁣'

/** "- ⁣TX⁣ item" → "- [x] item"; a marker that starts a plain line becomes a task item too. */
function tasksToMarkdown(md: string): string {
  return md
    .replace(/^(\s*)[-*+]\s+⁣T([XO])⁣\s*/gm, (_m, indent: string, s: string) => `${indent}- [${s === 'X' ? 'x' : ' '}] `)
    .replace(/^(\s*)⁣T([XO])⁣\s*/gm, (_m, indent: string, s: string) => `${indent}- [${s === 'X' ? 'x' : ' '}] `)
    .replace(/⁣T([XO])⁣\s*/g, (_m, s: string) => (s === 'X' ? '☑ ' : '☐ '))
}

/** Markdown image alt / link text must not break out of its brackets. */
const bracketSafe = (s: string) => oneLine(s).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')

function makeTurndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' })
  td.remove(['style', 'script', 'title', 'meta'] as unknown as TurndownService.Filter)
  // "**Aksiyonlar **" is not bold in markdown: keep the spaces outside the markers.
  const hug = (mark: string) => (content: string) => {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!
    return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : content
  }
  td.addRule('strong', { filter: ['strong', 'b'], replacement: hug('**') })
  td.addRule('em', { filter: ['em', 'i'], replacement: hug('*') })
  td.addRule('strike', {
    filter: ['del', 's'] as unknown as TurndownService.Filter,
    replacement: (content) => (content.trim() ? `~~${content}~~` : ''),
  })
  td.addRule('image', {
    filter: 'img',
    replacement: (_c, node) => {
      const el = node as HTMLImageElement
      const src = el.getAttribute('src') ?? ''
      if (!src) return ''
      return `![${bracketSafe(el.getAttribute('alt') ?? '')}](${src})`
    },
  })
  // Every OneNote table becomes a GFM table (first row as header). A GFM cell
  // is one line, so a line break inside it is written as <br> — the editor and
  // the read-only view both read that back as a line break (DescriptionEditor).
  td.addRule('table', {
    filter: 'table',
    replacement: (_c, node) => {
      const rows = Array.from((node as HTMLTableElement).rows)
      if (!rows.length) return ''
      const cells = rows.map((r) => Array.from(r.cells).map((c) => {
        const md = oneLine(cellTd.turndown(c.innerHTML)).replace(/\|/g, '\\|')
        // A line break in a cell is <br> (the editor reads it back as one); a
        // cell holding only breaks is an empty cell.
        return md.split(CELL_BR).map((x) => x.trim()).join('<br>').replace(/^(<br>)+$/, '') || ' '
      }))
      const width = Math.max(...cells.map((r) => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? ' ').join(' | ')} |`
      return `\n\n${line(cells[0])}\n| ${Array.from({ length: width }, () => '---').join(' | ')} |\n${cells.slice(1).map(line).join('\n')}\n\n`
    },
  })
  return td
}

const td = makeTurndown()
/** Separate instance for cell contents (the table rule must not recurse into itself). */
const cellTd = makeTurndown()
/** Stand-in for a line break inside a cell until the cell is flattened to one line. */
const CELL_BR = '\uE000'
cellTd.addRule('cellBreak', { filter: 'br', replacement: () => CELL_BR })

/**
 * OneNote users line data up with tab stops (SAP table dumps, key/value lists).
 * Markdown collapses tabs, so: two or more consecutive paragraphs that each
 * split into ≥2 cells become a table; any other tab keeps its gap as em spaces
 * (a leading tab is indentation, e.g. in pasted code).
 */
function tabsToTables(doc: Document) {
  const cells = (p: Element) => (p.textContent ?? '').split('\t').map((c) => c.trim())
  const isRow = (p: Element) => cells(p).filter(Boolean).length >= 2 && /\S\t+\S/.test(p.textContent ?? '')
  const box = (p: Element) => p.closest('.outline-element') ?? p
  const groups: Element[][] = []
  for (const p of Array.from(doc.querySelectorAll('p'))) {
    if (!isRow(p)) continue
    const last = groups[groups.length - 1]
    const prev = last?.[last.length - 1]
    if (prev && box(prev).nextElementSibling === box(p)) last.push(p)
    else groups.push([p])
  }
  for (const rows of groups) {
    if (rows.length < 2) continue
    const table = doc.createElement('table')
    for (const p of rows) {
      const tr = table.insertRow()
      for (const c of cells(p)) tr.insertCell().textContent = c
    }
    box(rows[0]).replaceWith(table)
    rows.slice(1).forEach((p) => box(p).remove())
  }
  // Tabs that were not table rows: keep the gap, keep indentation.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue?.includes('\t') && !n.parentElement?.closest('pre')) n.nodeValue = n.nodeValue.replace(/\t/g, '  ')
  }
}

const INLINE = new Set(['STRONG', 'B', 'EM', 'I', 'SPAN', 'U', 'S', 'DEL'])
const styleOf = (el: Element) => (el.getAttribute('style') ?? '').toLowerCase()

/** Fonts code is pasted in (SAP GUI / ABAP editor, VS Code, Visual Studio …). */
const MONO_RE = /font-family:\s*["']?(courier|consolas|lucida console|lucida sans typewriter|menlo|monaco|source code pro|cascadia|fira code|jetbrains mono|monospace)/
/** The font a text node is shown in: the nearest element that sets one. */
const monoText = (n: Node) => {
  for (let el = n.parentElement; el; el = el.parentElement) {
    const st = styleOf(el)
    if (/font-family:/.test(st)) return MONO_RE.test(st)
  }
  return false
}
const hasText = (s: string | null | undefined) => !!(s ?? '').replace(/ /g, ' ').trim()

/**
 * Code pasted into OneNote keeps its editor's monospace font, one paragraph
 * per line, indented with leading spaces (#684A9085: an ABAP SELECT lost its
 * indentation and font). Consecutive paragraphs whose text is all monospace
 * become one fenced code block, spaces and tabs kept as they are (an empty
 * paragraph between two such lines is a blank line of the code). A monospace
 * run inside an ordinary sentence becomes inline code. The syntax colours
 * cannot be carried: markdown has no text colour.
 */
function codeBlocks(doc: Document) {
  const textsOf = (el: Element) => {
    const out: Text[] = []
    const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text)
    return out
  }
  const isCode = (p: Element) => {
    if (p.closest('table, pre') || p.querySelector('img, table')) return false
    const texts = textsOf(p).filter((n) => hasText(n.nodeValue))
    return texts.length > 0 && texts.every(monoText)
  }
  const isBlank = (p: Element) => !hasText(p.textContent) && !p.querySelector('img, table')
  const box = (p: Element) => p.closest('.outline-element') ?? p
  const indentPx = (p: Element) => Number(/margin-left:\s*(\d+(?:\.\d+)?)px/.exec(styleOf(box(p)))?.[1] ?? 0)
  const lineOf = (p: Element) => {
    let s = ''
    const walk = (n: Node) => {
      if (n.nodeType === 3) s += n.nodeValue ?? ''
      else if (n.nodeName === 'BR') s += '\n'
      else n.childNodes.forEach(walk)
    }
    walk(p)
    return s.replace(/ /g, ' ').replace(/\s+$/, '')
  }

  const paras = Array.from(doc.querySelectorAll('p'))
  const groups: Element[][] = []
  let cur: Element[] = []
  let blanks: Element[] = []
  const close = () => { if (cur.length) groups.push(cur); cur = []; blanks = [] }
  for (const p of paras) {
    const prev = cur[cur.length - 1] ?? null
    const follows = (a: Element | null, b: Element) => !!a && (a.nextElementSibling === b || box(a).nextElementSibling === box(b))
    if (isCode(p)) {
      const last = blanks[blanks.length - 1] ?? prev
      if (prev && follows(last, p)) cur.push(...blanks, p)
      else { close(); cur = [p] }
      blanks = []
    } else if (prev && isBlank(p) && follows(blanks[blanks.length - 1] ?? prev, p)) blanks.push(p)
    else close()
  }
  close()

  for (const lines of groups) {
    // OneNote's own indent levels (margin-left) count too, relative to the first line: 4 spaces a step.
    const base = Math.min(...lines.filter(isCode).map(indentPx))
    const text = lines.map((p) => (isBlank(p) ? '' : ' '.repeat(Math.max(0, Math.round((indentPx(p) - base) / 36)) * 4) + lineOf(p))).join('\n')
    const pre = doc.createElement('pre')
    const code = doc.createElement('code')
    code.textContent = text
    pre.appendChild(code)
    box(lines[0]).replaceWith(pre)
    lines.slice(1).forEach((p) => box(p).remove())
  }

  // Monospace words inside ordinary text: inline code.
  for (const el of Array.from(doc.body.querySelectorAll('span[style]'))) {
    if (!el.isConnected || el.closest('pre, code') || !MONO_RE.test(styleOf(el)) || !hasText(el.textContent)) continue
    const code = doc.createElement('code')
    code.textContent = (el.textContent ?? '').replace(/ /g, ' ')
    el.replaceWith(code)
  }
  // Neighbouring runs (each colour is its own span) become one.
  for (const el of Array.from(doc.body.querySelectorAll('code'))) {
    if (!el.isConnected || el.parentElement?.nodeName === 'PRE') continue
    for (let next = el.nextSibling; next?.nodeName === 'CODE'; next = el.nextSibling) {
      el.textContent = (el.textContent ?? '') + (next.textContent ?? '')
      next.parentNode?.removeChild(next)
    }
  }
}

/**
 * OneNote writes most bold and italic as CSS on the paragraph or span
 * (`font-weight: bold`, `font-style: italic`), which turndown ignores: make
 * them real <strong>/<em>. Then tidy what breaks markdown emphasis: line
 * breaks at the edge of a bold run, adjacent runs of the same kind (each
 * colour change starts a new <em>, and "*a**b*" reads as bold), and trailing
 * <br>s that only made room in OneNote.
 */
function inlineStyles(doc: Document) {
  const wrap = (el: Element, tag: 'strong' | 'em', skip: string) => {
    if (el.closest(skip) || !(el.textContent ?? '').replace(/\u00a0/g, ' ').trim()) return false
    el.querySelectorAll(skip).forEach((inner) => inner.replaceWith(...Array.from(inner.childNodes)))
    const w = doc.createElement(tag)
    while (el.firstChild) w.appendChild(el.firstChild)
    el.appendChild(w)
    return true
  }
  for (const el of Array.from(doc.body.querySelectorAll('[style]'))) {
    const st = styleOf(el)
    const inline = INLINE.has(el.tagName) || el.tagName === 'A'
    const b = /font-weight:\s*(bold|[6-9]00)/.test(st) && !/^(STRONG|B|H[1-6]|TH)$/.test(el.tagName) && wrap(el, 'strong', 'strong, b')
    let i = false
    if (/font-style:\s*italic/.test(st) && !/^(EM|I)$/.test(el.tagName)) {
      if (inline && !el.closest('em, i') && (el.textContent ?? '').replace(/ /g, ' ').trim()) {
        // Italic goes around an inline run (a bold word inside an italic
        // sentence), so it can merge with the italic runs beside it below.
        const em = doc.createElement('em')
        el.replaceWith(em)
        em.appendChild(el)
        i = true
      } else i = wrap(el, 'em', 'em, i')
    }
    // A styled span is only a carrier: drop it, keep what it now wraps.
    if ((b || i) && el.tagName === 'SPAN') el.replaceWith(...Array.from(el.childNodes))
  }
  // <br> at the start/end of an inline run moves outside it.
  for (const el of Array.from(doc.body.querySelectorAll('strong, b, em, i, span, u, s, del'))) {
    while (el.lastChild?.nodeName === 'BR') el.after(el.lastChild)
    while (el.firstChild?.nodeName === 'BR') el.before(el.firstChild)
  }
  // Adjacent runs of the same emphasis become one.
  const kind = (n: Node | null) => (n?.nodeName === 'B' ? 'STRONG' : n?.nodeName === 'I' ? 'EM' : n?.nodeName)
  for (const el of Array.from(doc.body.querySelectorAll('strong, b, em, i'))) {
    if (!el.isConnected) continue
    let next = el.nextSibling
    while (next && kind(next) === kind(el)) {
      while (next.firstChild) el.appendChild(next.firstChild)
      const gone = next
      next = next.nextSibling
      gone.parentNode?.removeChild(gone)
    }
  }
  // Trailing line breaks of a block are OneNote spacing. Outside a table they
  // cannot survive markdown anyway; inside a cell they are kept as <br> — the
  // room a template leaves for writing means something (#684A9085).
  for (const el of Array.from(doc.body.querySelectorAll('p, li, td, div'))) {
    if (el.closest('table')) continue
    for (let last = el.lastChild; last && (last.nodeName === 'BR' || (last.nodeType === 3 && !(last.nodeValue ?? '').trim())); last = el.lastChild) {
      if (last.nodeName !== 'BR' && !el.querySelector('br')) break
      el.removeChild(last)
    }
    while (el.lastChild && INLINE.has(el.lastChild.nodeName) && el.lastChild.lastChild?.nodeName === 'BR') el.appendChild(el.lastChild.lastChild)
  }
}

/**
 * OneNote places each outline anywhere on the page; the file lists them in the
 * order they were made. Read them the way the page looks: top to bottom, and
 * boxes that start at about the same height (a note beside a table) left to
 * right.
 */
const ROW_PX = 48
function orderByPosition(doc: Document) {
  const at = (el: Element) => {
    const st = styleOf(el)
    const top = /(?:^|;)\s*top:\s*(-?\d+(?:\.\d+)?)px/.exec(st), left = /(?:^|;)\s*left:\s*(-?\d+(?:\.\d+)?)px/.exec(st)
    return top && left ? { el, top: Number(top[1]), left: Number(left[1]) } : null
  }
  const placed = Array.from(doc.body.children).map(at).filter((x): x is NonNullable<typeof x> => !!x)
  if (placed.length < 2) return
  placed.sort((a, b) => a.top - b.top)
  const rows: (typeof placed)[] = []
  for (const x of placed) {
    const row = rows[rows.length - 1]
    if (row && x.top - row[0].top < ROW_PX) row.push(x)
    else rows.push([x])
  }
  // Everything positioned goes back where the first of them was, in reading order.
  const anchor = doc.createComment('outlines')
  doc.body.insertBefore(anchor, placed.reduce((a, x) => (a.compareDocumentPosition(x.el) & 2 ? x.el : a), placed[0].el))
  for (const row of rows) for (const x of row.sort((a, b) => a.left - b.left)) doc.body.insertBefore(x.el, anchor)
  anchor.remove()
}

/** Section table of contents → ordered page file names with their indent level. */
function readToc(toc: string | null): { file: string; level: number }[] {
  if (!toc) return []
  const doc = new DOMParser().parseFromString(toc, 'text/html')
  return Array.from(doc.querySelectorAll('li')).flatMap((li) => {
    const a = li.querySelector('a[href]')
    if (!a) return []
    const href = decodeURIComponent(a.getAttribute('href') ?? '')
    const level = Number(/\bl(\d)\b/.exec(li.className)?.[1] ?? 1)
    return [{ file: href.slice(href.lastIndexOf('/') + 1), level }]
  })
}

const unixToIso = (v: string | null | undefined) => {
  const n = Number(v)
  return v && Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null
}

function readPage(html: string, level: number, out: SectionOutput): OneNotePage {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const meta = (name: string) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null
  const title = oneLine(doc.querySelector('title')?.textContent ?? '')
  // The title block repeats the title and prints the date: both are fields here.
  doc.querySelectorAll('.title').forEach((el) => el.remove())
  // OneNote tags: a to-do tag keeps its state (becomes a markdown task item
  // below); other tags keep their symbol (⭐, ❗ …) as text.
  doc.querySelectorAll('.note-tag-icon').forEach((el) => {
    if (el.getAttribute('role') === 'checkbox') {
      el.replaceWith(doc.createTextNode(el.getAttribute('aria-checked') === 'true' ? TASK_DONE : TASK_OPEN))
    } else {
      const symbol = oneLine(el.querySelector('.text')?.textContent ?? '')
      el.replaceWith(doc.createTextNode(symbol && symbol.length <= 3 ? `${symbol} ` : ''))
    }
  })

  // A tagged paragraph (💡, ⭐ …) comes as a one-item list; only to-dos are list items.
  doc.querySelectorAll('ul.tagged-list').forEach((ul) => {
    if (ul.textContent?.includes(TASK_DONE) || ul.textContent?.includes(TASK_OPEN)) return
    const items = Array.from(ul.children).map((li) => {
      const p = doc.createElement('p')
      while (li.firstChild) p.appendChild(li.firstChild)
      return p
    })
    ul.replaceWith(...items)
  })

  orderByPosition(doc)
  codeBlocks(doc)   // before tabsToTables: tabs in code are indentation, not columns
  tabsToTables(doc)
  inlineStyles(doc)

  const assets: OneNoteAsset[] = []
  const indexOf = new Map<string, number>()
  const claim = (ref: string | null): string | null => {
    if (!ref || /^[a-z]+:/i.test(ref)) return null // onenote:, http:, mailto: … stay as they are
    const name = decodeURIComponent(ref).split('/').pop() ?? ''
    const bytes = out.assets.get(name)
    if (!bytes) return null
    if (!indexOf.has(name)) { indexOf.set(name, assets.length); assets.push({ name, bytes }) }
    return assetToken(indexOf.get(name)!)
  }

  let ocrImages = 0
  doc.querySelectorAll('img').forEach((img) => {
    const token = claim(img.getAttribute('src'))
    if (!token) { img.remove(); return }
    img.setAttribute('src', token)
    if (oneLine(img.getAttribute('alt') ?? '')) ocrImages++
  })
  doc.querySelectorAll('a[href]').forEach((a) => {
    const token = claim(a.getAttribute('href'))
    if (token) a.setAttribute('href', token)
  })

  const markdown = tasksToMarkdown(td.turndown(doc.body.innerHTML)).replace(/\n{3,}/g, '\n\n').trim()
  return {
    ref: meta('X-Original-Page-Id') ?? '',
    title,
    level,
    createdAt: unixToIso(meta('X-Created-Time')),
    updatedAt: unixToIso(meta('X-Updated-Time')),
    markdown,
    assets,
    ocrImages,
    author: meta('X-Author') || null,
    history: [],
  }
}

/**
 * A page's older states, newest first, dropping any that look exactly like the
 * next newer state. The file does not keep revisions in time order (a copy of
 * the current state can come last), so they are sorted by their own time first;
 * the sort is stable; states without a time go last, in the file's order.
 */
function readHistory(page: OneNotePage, htmls: string[], out: SectionOutput): OneNoteRevision[] {
  const all = htmls.filter(Boolean).map((html) => {
    const { history: _h, level: _l, ref: _r, ...rev } = readPage(html, page.level, out)
    return rev
  })
  const at = (r: OneNoteRevision) => r.updatedAt ?? r.createdAt ?? ''
  all.sort((a, b) => at(b).localeCompare(at(a)))
  const revs: OneNoteRevision[] = []
  let newer = { title: page.title, markdown: page.markdown }
  for (const rev of all) {
    if (rev.title === newer.title && rev.markdown === newer.markdown) continue
    revs.push(rev)
    newer = rev
  }
  return revs
}

/** All pages of a converted section, in OneNote order. */
export function readSection(out: SectionOutput): OneNotePage[] {
  const order = readToc(out.toc)
  const seen = new Set<string>()
  const pages: OneNotePage[] = []
  for (const [i, { file, level }] of order.entries()) {
    const html = out.pages.get(file)
    if (!html || seen.has(file)) continue
    seen.add(file)
    const page = readPage(html, level, out)
    page.history = readHistory(page, out.history.get(i) ?? [], out)
    pages.push(page)
  }
  // Anything the table of contents did not list still comes along, at the top level.
  for (const [file, html] of out.pages) if (!seen.has(file)) pages.push(readPage(html, 1, out))
  // OneNote keeps conflict copies under the same page GUID. Both come along; the
  // second gets a derived ref (stable across runs, since the order is OneNote's).
  const withRef = pages.filter((p) => p.ref)
  const refCount = new Map<string, number>()
  for (const p of withRef) {
    const n = (refCount.get(p.ref) ?? 0) + 1
    refCount.set(p.ref, n)
    if (n > 1) p.ref = `${p.ref}#${n}`
  }
  return withRef
}
