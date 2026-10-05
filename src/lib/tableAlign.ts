import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/react'

/**
 * Markdown tablosunda sütun hizalaması (#58789618, "neden olmasın?").
 *
 * GFM hizalamayı ayraç satırında taşır: `:---` sol, `:---:` orta, `---:` sağ.
 * tiptap-markdown'ın tablo yazıcısı ayraç satırını her zaman `---` basıyor,
 * yani dışarıdan gelen hizalama kaydedince siliniyordu. Burada iki yön de var:
 *
 *  • Okuma: markdown-it hücreye `style="text-align:…"` koyuyor; aşağıdaki
 *    genel öznitelik bunu hücrenin `align` niteliğine alıyor (ve geri yazıyor).
 *  • Yazma: `alignedTables` markdown çıktısındaki ayraç satırlarını belgedeki
 *    hizalamalara göre yeniden yazıyor — tablo genişliğindeki (#1E605419)
 *    yaklaşımın aynısı, metni satır satır işliyoruz.
 */
export type CellAlign = 'left' | 'center' | 'right' | null

/** Hücrelere `align` niteliği: DOM'da `style="text-align:…"` olarak durur. */
export const TableAlign = Extension.create({
  name: 'tableAlign',
  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          align: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = (element.style.textAlign || element.getAttribute('align') || '').toLowerCase()
              return v === 'center' || v === 'right' || v === 'left' ? v : null
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.align ? { style: `text-align: ${String(attrs.align)}` } : {},
          },
        },
      },
    ]
  },
})

/** İmlecin bulunduğu hücrenin hizalaması (çubuktaki düğmeler bunu gösterir). */
export function currentAlign(editor: Editor): CellAlign {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') return (node.attrs.align as CellAlign) ?? null
  }
  return null
}

/**
 * Hizalama GFM'de **sütunun** özelliği, hücrenin değil: imlecin olduğu sütunun
 * bütün hücreleri birlikte yazılır, yoksa kaydedince yalnız ilk satır kalırdı.
 */
export function setColumnAlign(editor: Editor, align: CellAlign) {
  const { state } = editor
  const { $from } = state.selection
  let cellDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') { cellDepth = d; break }
  }
  if (cellDepth < 2) return
  const tableDepth = cellDepth - 2
  const table = $from.node(tableDepth)
  if (table.type.name !== 'table') return
  const tablePos = $from.before(tableDepth)
  const cellPos = $from.before(cellDepth)
  const rowStart = $from.before(cellDepth - 1)

  // İmlecin sütun sırası (birleşmiş hücre yok: markdown tablosu zaten kabul etmiyor).
  let col = -1
  let idx = 0
  $from.node(cellDepth - 1).forEach((_cell, offset) => {
    if (rowStart + 1 + offset === cellPos) col = idx
    idx += 1
  })
  if (col < 0) return

  const tr = state.tr
  let rowPos = tablePos + 1
  table.forEach((row) => {
    let i = 0
    row.forEach((cell, offset) => {
      if (i === col) tr.setNodeMarkup(rowPos + 1 + offset, undefined, { ...cell.attrs, align })
      i += 1
    })
    rowPos += row.nodeSize
  })
  editor.view.dispatch(tr.scrollIntoView())
}

const marker = (align: CellAlign, width = 3) => {
  const dashes = '-'.repeat(Math.max(3, width))
  if (align === 'center') return `:${dashes}:`
  if (align === 'right') return `${dashes}:`
  if (align === 'left') return `:${dashes}`
  return dashes
}

/** Belgedeki her tablonun ilk satırındaki hizalamalar, belge sırasıyla. */
export function tableAligns(editor: Editor): CellAlign[][] {
  const out: CellAlign[][] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true
    const first = node.firstChild
    const row: CellAlign[] = []
    first?.forEach((cell) => row.push((cell.attrs.align as CellAlign) ?? null))
    out.push(row)
    return true
  })
  return out
}

/** Bir satır tablo ayraç satırı mı (`| --- | --- |`). */
const isDelimiter = (line: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)

/**
 * Markdown çıktısındaki ayraç satırlarını hizalamalarla değiştirir. `aligns`
 * belge sırasında: metindeki N. tablo, belgedeki N. tablo.
 */
export function alignedTables(md: string, aligns: CellAlign[][]): string {
  if (!aligns.some((row) => row.some(Boolean))) return md
  const lines = md.split('\n')
  let table = 0
  return lines
    .map((line) => {
      if (!isDelimiter(line)) return line
      const row = aligns[table++] ?? []
      if (!row.some(Boolean)) return line
      const cells = line.trim().slice(1, -1).split('|')
      return `| ${cells.map((cell, i) => marker(row[i] ?? null, cell.trim().length)).join(' | ')} |`
    })
    .join('\n')
}
