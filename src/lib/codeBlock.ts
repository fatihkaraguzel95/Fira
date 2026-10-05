import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { t } from '../i18n'
import type * as Highlight from './highlight'
import { getCodeLineNumbers, onCodeLineNumbers } from './codePrefs'
import { markHandled } from './keys'
import { fold } from './fuzzy'

/**
 * Kod bloğu: dil seçimi, kopyala düğmesi, satır kaydırmadan yatay kaydırma ve
 * uzun bloğun kendi içinde kalması (#58789618).
 *
 * Neden ProseMirror düğüm görünümü (React değil): kod bloğu StarterKit'ten
 * geliyor; onu kapatıp ayrı bir paket eklemek yerine düğüm görünümünü bir
 * eklentiden kaydediyoruz. Böylece yeni bağımlılık yok, StarterKit'in kendi
 * giriş kuralları (```), kısayolları ve markdown dönüşümü olduğu gibi kalıyor.
 *
 * Dil listesi kısa tutuldu: markdown çitine yazılan etiket (```sql) burada
 * seçilen değerdir, yani dışarıya da doğru gider. Renklendirme aşağıdaki
 * süsleme eklentisinde; highlight.js **gecikmeli** yükleniyor (bkz. `highlight.ts`).
 */
export const CODE_LANGUAGES = [
  'text', 'abap', 'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'go', 'html',
  'java', 'javascript', 'json', 'kotlin', 'markdown', 'php', 'python', 'ruby',
  'rust', 'sql', 'swift', 'typescript', 'xml', 'yaml',
] as const

/** Bu satır sayısından sonra blok kendi içinde kayar (düzenlerken). */
export const CODE_MAX_LINES = 20

const LABELS: Record<string, string> = {
  csharp: 'C#', cpp: 'C++', javascript: 'JavaScript', typescript: 'TypeScript',
  json: 'JSON', html: 'HTML', css: 'CSS', sql: 'SQL', yaml: 'YAML', xml: 'XML', php: 'PHP',
  abap: 'ABAP', bash: 'Bash', python: 'Python', java: 'Java', go: 'Go', rust: 'Rust',
  ruby: 'Ruby', kotlin: 'Kotlin', swift: 'Swift', markdown: 'Markdown', diff: 'Diff', c: 'C',
}
/** Çağrı anında çevrilir ("Düz metin" dile göre değişiyor). */
export const languageLabel = (id: string | null | undefined) =>
  !id || id === 'text' ? t('ticket.editor.code.plain') : LABELS[id] ?? id

const lineCount = (s: string) => (s ? s.split('\n').length : 1)

const SVG_NS = 'http://www.w3.org/2000/svg'
function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  return svg
}

let pickerSeq = 0

/**
 * Dil seçici (29 Eyl, "syntax selector okunaksız ve temaya uymuyor"): tarayıcının
 * yerleşik `<select>` listesi koyu temada gri üstüne gri çıkıyor ve paletin
 * renklerini almıyordu. WAI-ARIA "select-only combobox": odak düğmede kalır
 * (liste `aria-activedescendant` ile gezilir), böylece editörün odak/blur düzeni
 * eski `<select>`'teki gibi işler. Liste gövdeye taşınır — kod kutusunun
 * `overflow: hidden`'ı ve editörün kaydırma kabı onu kesmesin. Harf yazmak listeyi
 * süzer; Esc önce listeyi, sonra seçiciyi bırakıp koda döner.
 */
class LanguagePicker {
  readonly el: HTMLDivElement
  private label: HTMLSpanElement
  private menu: HTMLDivElement | null = null
  private list: HTMLDivElement | null = null
  private queryRow: HTMLDivElement | null = null
  private items: string[] = []
  private active = 0
  private query = ''
  private value = 'text'
  /** Listede olmayan ama belgede geçen diller (```scala): seçenek olarak kalır. */
  private extras: string[] = []
  private readonly id = `fira-code-lang-${++pickerSeq}`
  private detach: (() => void) | null = null

  constructor(
    private onPick: (id: string) => void,
    private canEdit: () => boolean,
    private onLeave: () => void,
  ) {
    const el = document.createElement('div')
    el.className = 'fira-code-lang'
    el.tabIndex = 0
    el.setAttribute('role', 'combobox')
    el.setAttribute('aria-haspopup', 'listbox')
    el.setAttribute('aria-expanded', 'false')
    el.setAttribute('aria-controls', `${this.id}-list`)
    el.setAttribute('aria-label', t('ticket.editor.code.language'))
    el.title = t('ticket.editor.code.language')
    this.label = document.createElement('span')
    el.append(this.label, icon('m6 9 6 6 6-6'))
    // Tıklama koda düşmesin (imleç atlamasın); tuşlar editöre ve genel kısayollara gitmesin.
    el.addEventListener('mousedown', (e) => e.stopPropagation())
    el.addEventListener('click', (e) => { e.preventDefault(); if (this.menu) this.close(); else this.open() })
    el.addEventListener('keydown', (e) => this.onKey(e))
    this.el = el
  }

  setValue(id: string) {
    this.value = id
    if (!(CODE_LANGUAGES as readonly string[]).includes(id) && !this.extras.includes(id)) this.extras.unshift(id)
    this.label.textContent = languageLabel(id)
    if (this.menu) this.render()
  }

  destroy() { this.close() }

  private options(): string[] { return [...this.extras, ...CODE_LANGUAGES] }

  private onKey(e: KeyboardEvent) {
    e.stopPropagation()
    const open = !!this.menu
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault()
        if (!open) this.open()
        else this.setActive(this.active + (e.key === 'ArrowDown' ? 1 : -1))
        return
      case 'PageDown':
      case 'PageUp':
        if (!open) return
        e.preventDefault()
        this.setActive(this.active + (e.key === 'PageDown' ? 8 : -8))
        return
      case 'Home':
      case 'End':
        if (!open) return
        e.preventDefault()
        this.setActive(e.key === 'Home' ? 0 : this.items.length - 1)
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (!open) this.open()
        else if (this.items.length) this.pick(this.items[this.active])
        return
      case 'Escape':
        // Görev penceresi / tam ekran aynı Esc ile kapanmasın.
        e.preventDefault()
        markHandled(e)
        if (open) this.close()
        else this.onLeave()
        return
      case 'Tab':
        if (open) this.close()
        return
      case 'Backspace':
        if (!open || !this.query) return
        e.preventDefault()
        this.setQuery(this.query.slice(0, -1))
        return
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          if (!open) this.open()
          this.setQuery(this.query + e.key)
        }
    }
  }

  private open() {
    if (this.menu || !this.canEdit()) return
    this.query = ''
    const menu = document.createElement('div')
    menu.className = 'fira-code-menu'
    const queryRow = document.createElement('div')
    queryRow.className = 'fira-code-menu-q'
    queryRow.setAttribute('aria-hidden', 'true')
    const list = document.createElement('div')
    list.className = 'fira-code-menu-list'
    list.id = `${this.id}-list`
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', t('ticket.editor.code.language'))
    menu.append(queryRow, list)
    // Liste odak almaz: tıklayınca odak seçicide kalır.
    menu.addEventListener('mousedown', (e) => e.preventDefault())
    list.addEventListener('click', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]')
      if (opt) this.pick(opt.dataset.lang!)
    })
    list.addEventListener('mousemove', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
      if (opt && Number(opt.dataset.i) !== this.active) this.setActive(Number(opt.dataset.i), false)
    })
    document.body.appendChild(menu)
    this.menu = menu
    this.list = list
    this.queryRow = queryRow
    this.el.setAttribute('aria-expanded', 'true')
    this.active = Math.max(0, this.options().indexOf(this.value))
    this.render()
    this.place()
    this.reveal()

    const outside = (e: PointerEvent) => {
      const target = e.target as Node
      if (!menu.contains(target) && !this.el.contains(target)) this.close()
    }
    // Sayfa kayarsa liste düğmeyi izler; düğme görünümden çıkınca kapanır.
    // Kaydırmada hemen kapatmak olmuyor: seçiciye tıklamak editörden odağı alıyor,
    // editörün çubuğu yer değiştiriyor ve tarayıcının kaydırma sabitlemesi aynı
    // anda bir kaydırma olayı üretiyor — liste açılır açılmaz kapanıyordu.
    let frame = 0
    const follow = (e: Event) => {
      if (e.type === 'scroll' && menu.contains(e.target as Node)) return
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const r = this.el.getBoundingClientRect()
        if (!this.el.isConnected || r.bottom < 0 || r.top > window.innerHeight) this.close()
        else this.place()
      })
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    this.detach = () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }

  private close() {
    this.detach?.()
    this.detach = null
    this.menu?.remove()
    this.menu = this.list = this.queryRow = null
    this.query = ''
    this.el.setAttribute('aria-expanded', 'false')
    this.el.removeAttribute('aria-activedescendant')
  }

  private pick(id: string) {
    this.close()
    if (id !== this.value) this.onPick(id)
  }

  private setQuery(query: string) {
    this.query = query
    this.active = 0
    this.render()
    this.reveal()
  }

  private render() {
    const list = this.list
    const queryRow = this.queryRow
    if (!list || !queryRow) return
    const q = fold(this.query.trim())
    const all = this.options()
    this.items = q ? all.filter((id) => fold(languageLabel(id)).includes(q) || id.includes(q)) : all
    if (this.active >= this.items.length) this.active = Math.max(0, this.items.length - 1)
    queryRow.textContent = this.query || t('ticket.editor.code.filter')
    queryRow.classList.toggle('is-empty', !this.query)
    const rows = this.items.map((id, i) => {
      const opt = document.createElement('div')
      opt.className = `fira-code-opt${i === this.active ? ' is-active' : ''}`
      opt.id = `${this.id}-o${i}`
      opt.setAttribute('role', 'option')
      opt.setAttribute('aria-selected', String(id === this.value))
      opt.dataset.lang = id
      opt.dataset.i = String(i)
      const text = document.createElement('span')
      text.textContent = languageLabel(id)
      opt.append(icon('M20 6 9 17l-5-5'), text)
      return opt
    })
    if (!rows.length) {
      const none = document.createElement('div')
      none.className = 'fira-code-menu-none'
      none.textContent = t('ticket.editor.code.noMatch')
      rows.push(none)
    }
    list.replaceChildren(...rows)
    this.syncActive()
  }

  private setActive(i: number, scroll = true) {
    if (!this.items.length) return
    this.active = Math.min(this.items.length - 1, Math.max(0, i))
    this.list?.querySelectorAll('.fira-code-opt').forEach((o) => o.classList.toggle('is-active', (o as HTMLElement).dataset.i === String(this.active)))
    this.syncActive()
    if (scroll) this.reveal()
  }

  private syncActive() {
    if (this.items.length) this.el.setAttribute('aria-activedescendant', `${this.id}-o${this.active}`)
    else this.el.removeAttribute('aria-activedescendant')
  }

  /** Etkin seçeneği listenin içinde görünür tutar (sayfayı kaydırmadan). */
  private reveal() {
    const list = this.list
    const opt = list?.querySelector<HTMLElement>('.fira-code-opt.is-active')
    if (!list || !opt) return
    const top = opt.offsetTop
    const bottom = top + opt.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }

  /** Düğmenin altına; altta yer yoksa üstüne. */
  private place() {
    const menu = this.menu
    if (!menu) return
    const r = this.el.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const up = below < 220 && above > below
    menu.style.maxHeight = `${Math.max(140, Math.min(320, up ? above : below))}px`
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`
    if (up) { menu.style.top = ''; menu.style.bottom = `${window.innerHeight - r.top + 4}px` }
    else { menu.style.bottom = ''; menu.style.top = `${r.bottom + 4}px` }
  }
}

class CodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private picker: LanguagePicker
  private lines: HTMLElement
  private copy: HTMLButtonElement
  private pre: HTMLElement
  private nums: HTMLElement
  private copyTimer: number | null = null
  private offPrefs: () => void

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('div')
    this.dom.className = 'fira-code'

    const bar = document.createElement('div')
    bar.className = 'fira-code-bar'
    bar.contentEditable = 'false'

    this.picker = new LanguagePicker(
      (language) => this.setLanguage(language),
      () => this.view.editable,
      () => this.view.focus(),
    )

    this.lines = document.createElement('span')
    this.lines.className = 'fira-code-lines'

    this.copy = document.createElement('button')
    this.copy.type = 'button'
    this.copy.className = 'fira-code-copy'
    this.copy.textContent = t('ticket.editor.code.copy')
    this.copy.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
    this.copy.addEventListener('click', (e) => { e.preventDefault(); void this.copyCode() })

    bar.append(this.picker.el, this.lines, this.copy)

    this.pre = document.createElement('pre')
    // Satır numarası ayrı bir sütun: seçime ve kopyalamaya karışmasın diye
    // düzenlenebilir alanın dışında (contentEditable=false).
    this.nums = document.createElement('span')
    this.nums.className = 'fira-code-nums'
    this.nums.contentEditable = 'false'
    this.nums.setAttribute('aria-hidden', 'true')
    const code = document.createElement('code')
    this.pre.append(this.nums, code)
    this.contentDOM = code

    this.dom.append(bar, this.pre)
    this.offPrefs = onCodeLineNumbers(() => this.update(this.node))
    this.update(node)
  }

  private setLanguage(language: string) {
    const pos = this.getPos()
    if (pos === undefined) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, language })
    this.view.dispatch(tr)
  }

  private async copyCode() {
    try {
      await navigator.clipboard.writeText(this.node.textContent)
      this.copy.textContent = t('ticket.editor.code.copied')
      this.copy.classList.add('is-done')
      if (this.copyTimer) window.clearTimeout(this.copyTimer)
      this.copyTimer = window.setTimeout(() => {
        this.copy.textContent = t('ticket.editor.code.copy')
        this.copy.classList.remove('is-done')
      }, 1600)
    } catch {
      this.copy.textContent = t('ticket.editor.code.copyFailed')
    }
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    // Listede olmayan bir dil (dışarıdan yapıştırılan ```scala gibi) kaybolmasın:
    // seçici onu kendi seçeneği olarak tutar, böylece etiketi de korunur.
    this.picker.setValue((node.attrs.language as string) || 'text')
    const n = lineCount(node.textContent)
    this.lines.textContent = t('ticket.editor.code.lines', { n })
    // Uzun blok sayfayı yutmasın: kendi içinde kayar, imleç aşağı indikçe
    // tarayıcı onu görünür tutar (düzenlerken gizlemek imleci kaybettiriyor).
    this.pre.classList.toggle('is-tall', n > CODE_MAX_LINES)
    const withNums = getCodeLineNumbers()
    this.dom.classList.toggle('has-lineno', withNums)
    this.nums.textContent = withNums ? Array.from({ length: n }, (_, i) => String(i + 1)).join('\n') : ''
    return true
  }

  stopEvent(event: Event) {
    // Çubuktaki kontroller editöre ait değil.
    return event.target instanceof HTMLElement && !!event.target.closest('.fira-code-bar')
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
    const el = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement
    return !!el?.closest('.fira-code-bar, .fira-code-nums')
  }

  destroy() {
    if (this.copyTimer) window.clearTimeout(this.copyTimer)
    this.offPrefs()
    this.picker.destroy()
  }
}

/**
 * Renklendirme süslemeleri. highlight.js ilk kod bloğu görülünce yükleniyor;
 * gelene kadar blok düz metin olarak duruyor, sonra tek bir boş işlemle
 * yeniden süsleniyor. Böylece kod okumayan kullanıcı o paketi hiç indirmiyor.
 */
const hlKey = new PluginKey<DecorationSet>('codeHighlight')
let hl: typeof Highlight | null = null
let hlLoading = false

function loadHighlighter(view: EditorView) {
  if (hl || hlLoading) return
  hlLoading = true
  import('./highlight')
    .then((mod) => {
      hl = mod
      hlLoading = false
      // Yüklendi: eklenti kendini yeniden hesaplasın (belge değişmedi).
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(hlKey, true))
    })
    .catch(() => { hlLoading = false })
}

function buildDecorations(state: EditorState, view: EditorView | null): DecorationSet {
  const decos: Decoration[] = []
  let sawCode = false
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return
    const lang = (node.attrs.language as string) || ''
    if (!lang || lang === 'text') return
    sawCode = true
    if (!hl?.canHighlight(lang)) return
    let from = pos + 1
    for (const tok of hl.tokenize(node.textContent, lang)) {
      const to = from + tok.text.length
      if (tok.className) decos.push(Decoration.inline(from, to, { class: tok.className }))
      from = to
    }
  })
  if (sawCode && !hl && view) loadHighlighter(view)
  return DecorationSet.create(state.doc, decos)
}

export const CodeBlockTools = Extension.create({
  name: 'codeBlockTools',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('codeBlockTools'),
        props: {
          nodeViews: {
            codeBlock: (node, view, getPos) => new CodeBlockView(node as PMNode, view as EditorView, getPos as () => number | undefined),
          },
        },
      }),
      new Plugin<DecorationSet>({
        key: hlKey,
        view(view) {
          // İlk çizimde de yükleme tetiklensin (belge açılışta kod içeriyorsa).
          buildDecorations(view.state, view)
          return {}
        },
        state: {
          init: (_config, state) => buildDecorations(state, null),
          apply(tr: Transaction, old: DecorationSet, _oldState: EditorState, newState: EditorState) {
            if (!tr.docChanged && !tr.getMeta(hlKey)) return old.map(tr.mapping, tr.doc)
            return buildDecorations(newState, null)
          },
        },
        props: {
          decorations(state) { return hlKey.getState(state) },
        },
      }),
    ]
  },
})
