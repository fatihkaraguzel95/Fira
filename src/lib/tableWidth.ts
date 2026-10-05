import { Extension } from '@tiptap/core'

/**
 * Per-table width (#1E605419). A table in Fira fills the column it sits in and
 * wraps its cells; a wide table (many columns, long values) is then unreadable,
 * and even fullscreen letterboxes it to the reading column. So a table can be
 * given its own width — "90rem", "1400px" — and scrolls sideways inside the
 * text it belongs to, without stretching the comment, description or page.
 *
 * Markdown has no place for that, so the width is written on its own line right
 * after the table:
 *
 *     | a | b |
 *     |---|---|
 *     | 1 | 2 |
 *     {width=1200px}
 *
 * Nothing else in the file changes, and a reader without Fira sees one odd line
 * instead of a mangled table. Both directions live here: markers go in when the
 * editor saves, and come out (onto the table) when the text is read.
 */

/** A width the app is willing to apply: a number with a css unit, nothing else. */
const VALUE = /^\d{1,5}(?:\.\d+)?(px|rem|em|%|ch|vw)$/

export const isTableWidth = (v: string) => VALUE.test(v.trim())

const MARKER = /^\{width=([^}\s]+)\}$/

/** The marker line for one table, or '' when the table has no width of its own. */
export const widthMarker = (width?: string | null) => (width && isTableWidth(width) ? `{width=${width.trim()}}` : '')

/**
 * Walks markdown line by line and hands back the table blocks in order. A table
 * block is a run of lines starting with "|" (GFM); that is exactly what
 * tiptap-markdown writes.
 */
function tableBlocks(md: string): { start: number; end: number }[] {
  const lines = md.split('\n')
  const blocks: { start: number; end: number }[] = []
  let start = -1
  lines.forEach((line, i) => {
    const isRow = line.trimStart().startsWith('|')
    if (isRow && start === -1) start = i
    if (!isRow && start !== -1) { blocks.push({ start, end: i - 1 }); start = -1 }
  })
  if (start !== -1) blocks.push({ start, end: lines.length - 1 })
  return blocks
}

/**
 * Puts a `{width=…}` line after every table that has one. `widths` is in
 * document order — the Nth table block in the text is the Nth table node.
 */
export function withTableWidths(md: string, widths: (string | null | undefined)[]): string {
  if (!widths.some(Boolean)) return md
  const lines = md.split('\n')
  const blocks = tableBlocks(md)
  // Back to front, so earlier insertions do not shift later line numbers.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const marker = widthMarker(widths[i])
    if (!marker) continue
    // A blank line first: a line straight after a table is read as another row.
    lines.splice(blocks[i].end + 1, 0, '', marker)
  }
  return lines.join('\n')
}

/** Takes the markers back out; returns the clean markdown and the widths in order. */
export function readTableWidths(md: string): { markdown: string; widths: (string | null)[] } {
  if (!md.includes('{width=')) return { markdown: md, widths: [] }
  const lines = md.split('\n')
  const widths: (string | null)[] = []
  const out: string[] = []
  let inTable = false
  // The table a marker would belong to: the last one, as long as only blank
  // lines have gone by since.
  let pending = -1
  for (const line of lines) {
    const trimmed = line.trim()
    const isRow = line.trimStart().startsWith('|')
    const m = MARKER.exec(trimmed)
    if (m && !isRow && pending >= 0 && isTableWidth(m[1])) {
      widths[pending] = m[1]
      pending = -1
      // Drop the marker and the blank line that was put in front of it.
      if (out.length && out[out.length - 1].trim() === '') out.pop()
      continue
    }
    if (isRow) {
      if (!inTable) { inTable = true; widths.push(null); pending = widths.length - 1 }
    } else {
      inTable = false
      if (trimmed !== '') pending = -1
    }
    out.push(line)
  }
  return { markdown: out.join('\n'), widths }
}

/**
 * Hooks the markers into tiptap-markdown's parse step: the marker arrives as a
 * paragraph right after the table, and moves onto the table element as
 * `data-width` (where the Table node picks it up as an attribute).
 */
export const TableWidthMarkers = Extension.create({
  name: 'tableWidthMarkers',
  priority: 50,
  addGlobalAttributes() {
    return [{
      types: ['table'],
      attributes: {
        width: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-width'),
          renderHTML: (attrs: Record<string, unknown>) => {
            const w = typeof attrs.width === 'string' && isTableWidth(attrs.width) ? attrs.width : null
            return w ? { 'data-width': w, style: `--table-w:${w}` } : {}
          },
        },
      },
    }]
  },
  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('table').forEach((table) => {
              const next = table.nextElementSibling
              const text = next?.textContent?.trim() ?? ''
              const m = MARKER.exec(text)
              if (next && m && isTableWidth(m[1])) {
                table.setAttribute('data-width', m[1])
                next.remove()
              }
            })
          },
        },
      },
    }
  },
})
