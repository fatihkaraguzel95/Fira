import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon as SetIcon, type IconName } from '../ui/Icon'
import { usePrefs } from '../../hooks/usePrefs'
import { createPortal } from 'react-dom'
import { markHandled, isEditableTarget } from '../../lib/keys'
import { anchorFor } from '../../lib/blockAnchor'
import { copyLink, pageUrl } from '../../lib/shareLink'
// `staticT` is the non-React translator: the slash table and the tiptap
// placeholder callback run outside a component, and both are evaluated at call
// time so they follow the current language.
import { t as staticT, useT } from '../../i18n'
import { currentUser } from '../../lib/session'
import type { EditorView } from '@tiptap/pm/view'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import HardBreak from '@tiptap/extension-hard-break'
import { mergeAttributes } from '@tiptap/core'
import { uploadWithProgress, isVideoFile, VIDEO_URL_RE } from '../../lib/uploads'
import { isFileDragActive, nodeFor, onFileDragChange, onInsertFile, readFileDrag, type InsertSlot } from '../../lib/fileInsert'
import { emitError } from '../../lib/errorToast'
import { storagePathFromUrl, displayUrl } from '../../lib/storage'
import { InlineFilePreview } from './InlineFilePreview'
import { formatBytes } from '../../lib/image'
import { Markdown } from 'tiptap-markdown'
import { MixedLists } from '../../lib/markdownLists'
import { CodeBlockTools } from '../../lib/codeBlock'
import { ImageTools, readImageTitle } from '../../lib/imageSize'
import { CodeBlock } from '../ui/CodeBlock'
import { useCodeLineNumbers } from '../../hooks/useCodePrefs'
import { TableWidthMarkers, withTableWidths, readTableWidths, isTableWidth } from '../../lib/tableWidth'
import { TableAlign, tableAligns, alignedTables, currentAlign, setColumnAlign } from '../../lib/tableAlign'
import { MentionNode, mentionIdFromHref, type MentionItem } from '../../lib/mentions'
import { mentionSuggestion } from './MentionPopup'
import { useTeamMemberProfiles } from '../../hooks/useTeams'
import { Extension, InputRule } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Long descriptions and comment threads outgrow the ticket window. "Tam ekran"
 * lifts the same element to a fixed overlay (no remount: editor state, undo
 * history and pending uploads survive); Esc leaves fullscreen before it does
 * anything else. Below the file viewer (9999), above the ticket window.
 */
export const FULLSCREEN_CLASS = 'fixed inset-0 z-[9000] bg-surface flex flex-col'

/**
 * Esc leaves fullscreen — unless a field has focus, in which case the field's own
 * rule applies first (the editor blurs, a menu closes) and the next Esc leaves.
 * Captured on document so it wins over the ticket window's "Esc closes" listener,
 * which is told to ignore the key via markHandled.
 */
export function useFullscreenEscape(active: boolean, exit: () => void) {
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isEditableTarget(e.target)) return
      markHandled(e)
      e.preventDefault()
      exit()
    }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [active, exit])
}

/** The ticket window animates in with a transform, which would pin a fixed child to it: fullscreen renders at body level. */
export const inBody = (node: React.ReactNode, fullscreen: boolean) => (fullscreen ? createPortal(node, document.body) : node)

/** Tam ekran görünümünün üst çubuğu (başlık + kapat). */
export function FullscreenBar({ title, onClose, wide, onToggleWide }: { title: string; onClose: () => void; wide?: boolean; onToggleWide?: () => void }) {
  const t = useT()
  return (
    <div data-wco-bar className="flex items-center gap-2 px-4 py-2 border-b border-line-soft bg-surface">
      <span className="text-sm font-semibold text-fg">{title}</span>
      <span className="text-xs text-fg-faint">{t('ticket.editor.escExits')}</span>
      <span className="flex-1" />
      {/* Reading column (~900px) or the whole window — for wide tables (#1E605419). Remembered in the account. */}
      {onToggleWide && (
        <button
          type="button"
          onClick={onToggleWide}
          aria-pressed={!!wide}
          className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${wide ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300' : 'border-line text-fg-2 hover:bg-raised'}`}
        >
          {wide ? t('ticket.editor.readingColumn') : t('ticket.editor.wideView')}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        title={t('ticket.editor.exitFullscreen')}
        className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-raised transition-colors"
      >
        <Icon k="compress" />
      </button>
    </div>
  )
}

interface Props {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  /** The ticket images upload against. Absent when the editor is used outside a
   *  ticket context — image paste/drop is disabled until a ticket id exists. */
  ticketId?: string
  readOnly?: boolean
  onClick?: () => void
  minHeight?: string
  /** Stop growing at this height and scroll inside instead — a comment box that
   *  grows past the panel pushes its own "Gönder" button off screen. */
  maxHeight?: string
  /** What the fullscreen bar calls this text (default: "Açıklama"). */
  fullscreenTitle?: string
  /** Whose members the "@" popup offers (#3461B7F0). Without it, typing @ is just text. */
  teamId?: string | null
  /** Called after a file added to the editor was uploaded (url is the public storage URL; inText = false for "upload only"). */
  onUploaded?: (url: string, file: File, inText: boolean) => void
  /** No frame: the text sits straight on the surface, aligned with what is around it.
   *  For a view where the editor is the only content (a page, #33E0AA19). */
  bare?: boolean
  /** Blok bağlantılarını açan kimlik: sayfa, görev ya da yorum (#d46f6d70). */
  anchorsFor?: string | null
  /** O çapa için paylaşılacak adres; verilmezse sayfa adresi kurulur. */
  anchorUrl?: (anchor: string) => string
  /**
   * Dosyalar panelinden gelen "açıklamaya/yoruma ekle" isteklerini bu editör mü
   * karşılasın (#489eda17). Aynı görevde iki editör var (açıklama ve yorum
   * kutusu); yuva adı hangisinin alacağını söyler. Sürükle-bırak yuvadan
   * bağımsız çalışır: dosya nereye bırakıldıysa oraya girer.
   */
  insertSlot?: InsertSlot
  /**
   * Araç çubuğu yalnız odak kutunun içindeyken (#e8bafa89). Görev penceresinde
   * açıklama ve boş yorum kutusu okunurken iki satırlık çubuk göstermiyor; tıklayınca
   * (ya da Tab ile girince) çıkıyor. Açılır pencereler (bağlantı, markdown, tablo
   * genişliği) kutunun içinde çizildiği için odakları çubuğu açık tutar.
   */
  toolbarOnFocus?: boolean
}

/** En yakın dikey kaydırılan üst öğe (çubuk açılınca metnin yerinde kalması için). */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

// ─── Line breaks in table cells ─────────────────────────────────────────────
/**
 * A GFM table cell is one line, so a line break inside a cell is written as
 * `<br>` and read back as a line break (#684A9825: "Aksiyonlar" ⏎ its hint,
 * the blank lines a template leaves for writing). Only `<br>` is let through —
 * other HTML stays escaped text (html: false), so "<LLXXX>" in a page is kept.
 * Without this tiptap-markdown wrote a cell's line break as "[hardBreak]".
 */
type MdState = { inTable?: boolean; write: (s: string) => void }
type MdNode = { type: unknown; childCount: number; child: (i: number) => { type: unknown } }
type MdInline = { src: string; pos: number; push: (type: string, tag: string, nesting: number) => unknown }
const BR_RE = /^<br\s*\/?>/i
const TableAwareHardBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: { type: unknown }, parent: MdNode, index: number) {
          // In a cell every break counts, trailing ones too (they are the room left to write).
          if (state.inTable) { state.write('<br>'); return }
          for (let i = index + 1; i < parent.childCount; i++) {
            // Markdown hard break: a backslash, then the newline (tiptap-markdown's own form).
            if (parent.child(i).type !== node.type) { state.write('\\\n'); return }
          }
        },
        parse: {
          setup(markdownit: { inline: { ruler: { before: (name: string, rule: string, fn: (s: MdInline, silent: boolean) => boolean) => void } } }) {
            markdownit.inline.ruler.before('text', 'fira_br', (st, silent) => {
              if (st.src.charCodeAt(st.pos) !== 0x3c) return false
              const m = BR_RE.exec(st.src.slice(st.pos))
              if (!m) return false
              if (!silent) st.push('hardbreak', 'br', 0)
              st.pos += m[0].length
              return true
            })
          },
        },
      },
    }
  },
})

/** The same for the read-only view: `<br>` (raw HTML to remark) becomes a line break. */
type MdastNode = { type: string; value?: string; children?: MdastNode[] }
function remarkBr() {
  const walk = (node: MdastNode) => {
    if (!node.children) return
    node.children = node.children.map((c) => (c.type === 'html' && BR_RE.test(c.value ?? '') && /^<br\s*\/?>$/i.test((c.value ?? '').trim()) ? { type: 'break' } : c))
    node.children.forEach(walk)
  }
  return (tree: MdastNode) => walk(tree)
}

// ─── Upload ───────────────────────────────────────────────────────────────────
const MIME_EXT: Record<string, string> = { jpeg: 'jpg', quicktime: 'mov', 'x-matroska': 'mkv', 'x-m4v': 'm4v' }
/** A file added to the editor (image, video or any document), stored under the ticket / page id. */
async function uploadEditorFile(file: File, ticketId: string, onProgress: (loaded: number, total: number) => void): Promise<string> {
  const user = await currentUser()
  if (!user) throw new Error('Oturum bulunamadı')
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1]?.toLowerCase()
  const sub = file.type.split('/')[1] ?? 'bin'
  const ext = fromName ?? MIME_EXT[sub] ?? sub
  const path = `${user.id}/${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  return uploadWithProgress(file, path, ticketId, { name: file.name || (isVideoFile(file) ? 'video' : 'görsel'), onProgress })
}
const isMedia = (f: { type?: string; name?: string }) => (f.type ?? '').startsWith('image/') || isVideoFile(f)

// ─── Upload placeholders ──────────────────────────────────────────────────────
/**
 * While a file goes up, a small chip with a progress ring sits exactly where it
 * was pasted — in this editor only (#FB541A31: a comment's upload must not show
 * under the description). It is a decoration, not content: nothing half-done
 * is ever saved, and edits around it move it along. When the file is in, the
 * image / video / link replaces it at its current position.
 */
const uploadKey = new PluginKey<DecorationSet>('firaUploads')
type UploadMeta = { add?: { id: string; pos: number; el: HTMLElement } ; remove?: string }
const UploadPlaceholders = Extension.create({
  name: 'firaUploadPlaceholders',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: uploadKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          set = set.map(tr.mapping, tr.doc)
          const meta = tr.getMeta(uploadKey) as UploadMeta | undefined
          if (meta?.add) set = set.add(tr.doc, [Decoration.widget(meta.add.pos, meta.add.el, { id: meta.add.id, side: -1 })])
          if (meta?.remove) set = set.remove(set.find(undefined, undefined, (spec) => spec.id === meta.remove))
          return set
        },
      },
      props: { decorations(state) { return uploadKey.getState(state) } },
    })]
  },
})
const placeholderPos = (editor: Editor, id: string): number | null => {
  const found = uploadKey.getState(editor.state)?.find(undefined, undefined, (spec) => spec.id === id) ?? []
  return found.length ? found[0].from : null
}
const RING = 2 * Math.PI * 6
function placeholderElement(name: string): { el: HTMLElement; set: (pct: number) => void } {
  const el = document.createElement('span')
  el.className = 'fira-upload-ph'
  el.contentEditable = 'false'
  el.setAttribute('role', 'status')
  const safe = name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  el.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke-width="2.5" class="ring-bg"/><circle cx="8" cy="8" r="6" fill="none" stroke-width="2.5" stroke-linecap="round" class="ring" stroke-dasharray="${RING}" stroke-dashoffset="${RING}" transform="rotate(-90 8 8)"/></svg><span class="name">${safe}</span><span class="pct">0%</span>`
  const ring = el.querySelector('.ring') as SVGCircleElement, pct = el.querySelector('.pct') as HTMLElement
  return { el, set: (p) => { ring.setAttribute('stroke-dashoffset', String(RING * (1 - p / 100))); pct.textContent = `${p}%` } }
}

/**
 * An image node whose file is a video renders as a player. Markdown keeps it as
 * `![name](….mp4)` (no video syntax in markdown); the read view does the same.
 */
type MdImgState = { write: (s: string) => void; esc: (s: string) => string; closeBlock: (node: unknown) => void }
type MdImgNode = { isBlock: boolean; attrs: { src: string; alt?: string | null; title?: string | null } }
const MediaImage = Image.extend({
  // Images are block nodes here (inline: false), but tiptap-markdown writes them
  // with the inline serializer, which never closes the block: whatever followed
  // an image was saved on the same line ("![..](url)### Heading") and lost its
  // own meaning on the next load. Close the block after a block image.
  addStorage() {
    return {
      markdown: {
        serialize(state: MdImgState, node: MdImgNode) {
          const { src, alt, title } = node.attrs
          state.write(`![${state.esc(alt || '')}](${src.replace(/[()]/g, '\\$&')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`)
          if (node.isBlock) state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
  renderHTML({ HTMLAttributes }) {
    const src = displayUrl(String(HTMLAttributes.src ?? ''))
    if (VIDEO_URL_RE.test(src)) return ['video', mergeAttributes({ controls: 'true', preload: 'metadata', class: 'fira-video' }, { src, title: HTMLAttributes.alt ?? '' })]
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src })]
  },
})

// ─── Markdown link input rule: typing "[text](url) " turns into a link ────────
const MarkdownLinkInput = Extension.create({
  name: 'markdownLinkInput',
  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\]]+)\]\((\S+)\)$/,
        handler: ({ state, range, match }) => {
          const [, text, href] = match
          const linkType = state.schema.marks.link
          if (!linkType) return
          state.tr.replaceWith(range.from, range.to, state.schema.text(text, [linkType.create({ href })]))
        },
      }),
    ]
  },
})

// ─── Icons ────────────────────────────────────────────────────────────────────
// The toolbar's own keys, each an icon of the interface set (#089a79f7): the toolbar used to carry
// 23 drawings of its own on a 20 px grid.
const I = {
  bold: 'bold', italic: 'italic', strike: 'strike', code: 'code', link: 'link', bullet: 'list', ordered: 'listOrdered', task: 'checklist',
  quote: 'quote', codeblock: 'codeBlock', hr: 'minus', table: 'table', image: 'image', attach: 'attach', h1: 'h1', h2: 'h2', h3: 'h3',
  text: 'type', undo: 'undo', redo: 'redo', paste: 'paste', expand: 'maximize', compress: 'minimize',
} as const satisfies Record<string, IconName>
type IconKey = keyof typeof I
function Icon({ k, className = '' }: { k: IconKey; className?: string }) {
  return <SetIcon name={I[k]} className={className} />
}

// ─── Toolbar button ───────────────────────────────────────────────────────────
function TBtn({
  icon, title, active, disabled, onClick, className = '',
}: { icon: IconKey; title: string; active?: boolean; disabled?: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick() }}
      className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        active
          ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
          : 'text-fg-muted hover:bg-raised hover:text-fg'
      } ${className}`}
    >
      <Icon k={icon} />
    </button>
  )
}
const Sep = () => <div className="w-px h-4 bg-line mx-1 flex-shrink-0" aria-hidden />

// ─── Slash commands ───────────────────────────────────────────────────────────
interface SlashItem {
  id: string
  label: string
  hint: string
  icon: IconKey
  keywords: string
  run: (editor: Editor) => void
}
/**
 * Built on demand, never at import time: the labels are translated, so a table
 * frozen at module load would keep the language it was first read in.
 * `keywords` are search aliases, not shown anywhere — they stay as typed, and
 * the translated label is matched too, so each language finds its own words.
 */
/**
 * Panodan gelen düz metin markdown'a benziyor mu? (#937e2840) Yanlış pozitif
 * pahalı değil (yalnız bir teklif çıkar), ama tek bir yıldızlı satır yüzünden
 * teklif çıkmasın diye en az iki işaret arıyoruz: başlık, liste, tablo, kod
 * çiti, alıntı, bağlantı ya da kalın/eğik.
 */
function looksLikeMarkdown(text: string) {
  const t = (text ?? '').trim()
  if (t.length < 12 || t.length > 200_000) return false
  // Onay kutusu tek başına yeter (#58789618): "- [ ] madde" düz metinde hiçbir
  // işe yaramıyor, yani yanlış pozitif riski yok. Eskiden yalnız "madde
  // listesi" işaretine giriyordu ve iki işaret şartına takılıp teklif çıkmıyordu.
  if (/(^|\n)\s*[-*+]\s\[[ xX]\]\s/.test(t)) return true
  const signals = [
    /(^|\n)#{1,6}\s\S/,            // başlık
    /(^|\n)\s*[-*+]\s\S/,          // madde listesi
    /(^|\n)\s*\d+\.\s\S/,          // numaralı liste
    /(^|\n)\s*>\s\S/,              // alıntı
    /(^|\n)\s*\|.+\|/,             // tablo satırı
    /```/,                         // kod çiti
    /\[[^\]]+\]\([^)]+\)/,         // bağlantı
    /\*\*[^*\n]+\*\*/,             // kalın
    /(^|\n)\s*[-*_]{3,}\s*(\n|$)/, // ayırıcı
  ].filter((re) => re.test(t)).length
  return signals >= 2
}

const slashItems = (): SlashItem[] => [
  { id: 'p',  label: staticT('ticket.editor.slash.text'),  hint: staticT('ticket.editor.slash.textHint'),  icon: 'text',      keywords: 'metin text paragraf p',        run: e => e.chain().focus().setParagraph().run() },
  { id: 'h1', label: staticT('ticket.editor.slash.h1'),    hint: staticT('ticket.editor.slash.h1Hint'),    icon: 'h1',        keywords: 'baslik heading h1 #',          run: e => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', label: staticT('ticket.editor.slash.h2'),    hint: staticT('ticket.editor.slash.h2Hint'),    icon: 'h2',        keywords: 'baslik heading h2 ##',         run: e => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', label: staticT('ticket.editor.slash.h3'),    hint: staticT('ticket.editor.slash.h3Hint'),    icon: 'h3',        keywords: 'baslik heading h3 ###',        run: e => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'ul', label: staticT('ticket.editor.slash.ul'),    hint: staticT('ticket.editor.slash.ulHint'),    icon: 'bullet',    keywords: 'liste bullet madde ul -',      run: e => e.chain().focus().toggleBulletList().run() },
  { id: 'ol', label: staticT('ticket.editor.slash.ol'),    hint: staticT('ticket.editor.slash.olHint'),    icon: 'ordered',   keywords: 'liste numarali ordered ol 1.', run: e => e.chain().focus().toggleOrderedList().run() },
  { id: 'todo', label: staticT('ticket.editor.slash.todo'), hint: staticT('ticket.editor.slash.todoHint'), icon: 'task',      keywords: 'gorev task todo checkbox []',  run: e => e.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: staticT('ticket.editor.slash.quote'), hint: staticT('ticket.editor.slash.quoteHint'), icon: 'quote', keywords: 'alinti quote blockquote >',    run: e => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: staticT('ticket.editor.slash.code'), hint: staticT('ticket.editor.slash.codeHint'), icon: 'codeblock', keywords: 'kod code block ```',           run: e => e.chain().focus().toggleCodeBlock().run() },
  { id: 'hr', label: staticT('ticket.editor.slash.hr'),    hint: staticT('ticket.editor.slash.hrHint'),    icon: 'hr',        keywords: 'ayirici divider hr ---',       run: e => e.chain().focus().setHorizontalRule().run() },
  { id: 'table', label: staticT('ticket.editor.slash.table'), hint: staticT('ticket.editor.slash.tableHint'), icon: 'table',  keywords: 'tablo table',                  run: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'markdown', label: staticT('ticket.editor.slash.markdown'), hint: staticT('ticket.editor.slash.markdownHint'), icon: 'paste', keywords: 'markdown md yapistir paste import', run: () => { /* handled in runSlash: opens the paste popover */ } },
]
function normalize(s: string) {
  return s.toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
}
function filterSlash(query: string) {
  const items = slashItems()
  const q = normalize(query.trim())
  if (!q) return items
  return items.filter(i => normalize(i.label).includes(q) || normalize(i.keywords).includes(q))
}

interface SlashState { query: string; from: number; to: number; left: number; top: number }
interface BubbleState { left: number; top: number }
interface LinkState { left: number; top: number; href: string }

/**
 * "Geniş tablo": type a width (px / rem / %) for the table the cursor is in, or
 * leave it empty to let the table fit the text again.
 */
function TableWidthBox({ editor }: { editor: Editor }) {
  const t = useT()
  const current = (editor.getAttributes('table').width as string | null) ?? ''
  const [draft, setDraft] = useState(current)
  const [seen, setSeen] = useState(current)
  // Follow the table under the cursor without fighting what is being typed.
  if (current !== seen) { setSeen(current); setDraft(current) }
  const apply = (raw: string) => {
    const v = raw.trim()
    if (v === '') { editor.chain().focus().updateAttributes('table', { width: null }).run(); return }
    const withUnit = /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v
    if (!isTableWidth(withUnit)) return
    setDraft(withUnit)
    editor.chain().focus().updateAttributes('table', { width: withUnit }).run()
  }
  return (
    <span className="flex items-center gap-1 pl-1.5">
      <label className="text-xs text-fg-muted select-none" htmlFor="fira-table-width">{t('ticket.editor.tableWidth')}</label>
      <input
        id="fira-table-width"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); apply(draft) }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(current) }
        }}
        onBlur={() => apply(draft)}
        placeholder={t('ticket.editor.tableWidthHint')}
        title={t('ticket.editor.tableWidthTitle')}
        className="h-7 w-24 text-xs rounded-md border border-line bg-field px-2 text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-primary-500"
      />
      {current && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); setDraft(''); editor.chain().focus().updateAttributes('table', { width: null }).run() }}
          className="h-7 px-2 rounded-md hover:bg-raised cursor-pointer text-fg-muted"
        >
          {t('ticket.editor.tableFit')}
        </button>
      )}
    </span>
  )
}

// ─── Read-only markdown view ──────────────────────────────────────────────────
/** `onFileClick` gets the url of a clicked image or of a link to one of our
 *  files (→ `InlineFilePreview`); other links open in a new tab. */
/** Blok metni: çapa kurmak için çocuk düğümlerdeki yazı toplanır. */
function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object' && 'props' in (node as { props?: unknown }) ) {
    const props = (node as { props?: { children?: React.ReactNode } }).props
    return nodeText(props?.children)
  }
  return ''
}

/** Bloğun solunda beliren zincir düğmesi: o bloğa giden adresi kopyalar. */
function BlockAnchor({ href }: { href: string }) {
  const t = useT()
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className="fira-anchor"
      title={ok ? t('common.copied') : t('page.copyBlockLink')}
      aria-label={t('page.copyBlockLink')}
      onClick={async (e) => {
        e.stopPropagation()
        const own = (e.currentTarget.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim()
        await copyLink(href, own.slice(0, 70) || document.title)
        setOk(true)
        window.setTimeout(() => setOk(false), 1200)
      }}
    >
      <SetIcon name={ok ? 'check' : 'link'} />
    </button>
  )
}

export function MarkdownView({ value, onFileClick, anchorsFor, anchorUrl }: { value: string; onFileClick: (url: string) => void; anchorsFor?: string | null; anchorUrl?: (anchor: string) => string }) {
  const lineNumbers = useCodeLineNumbers()
  // Table widths ride along as `{width=…}` lines (#1E605419): take them out of
  // the text and hand them to the tables in order, each in its own scroller so
  // a wide table never stretches the comment or page around it.
  const { markdown, widths } = readTableWidths(value)
  const seen = { n: 0 }
  // Blok çapaları (#d46f6d70): en üst seviye bloklar sırayla numaralanır, her biri
  // üzerine gelince "bağlantıyı kopyala" düğmesi gösterir. Adresi çağıran verir
  // (#d46f6d70 2. tur): sayfada sayfanın, görevde görevin ya da yorumun adresi.
  const blockNo = { n: 0 }
  const linkFor = anchorUrl ?? ((a: string) => pageUrl(anchorsFor ?? '', a))
  const anchored = (tag: 'p' | 'h1' | 'h2' | 'h3' | 'h4', children: React.ReactNode) => {
    if (!anchorsFor) return createElement(tag, null, children)
    const text = nodeText(children)
    const id = anchorFor(text, blockNo.n++)
    return createElement(tag, { id, className: 'fira-anchored' },
      children,
      <BlockAnchor key="anchor" href={linkFor(id)} />)
  }
  return (
    <div className="md-view" data-anchors={anchorsFor ? '' : undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBr]}
        components={{
          table: ({ children }) => {
            const w = widths[seen.n++]
            return (
              <div className={w ? 'overflow-x-auto max-w-full' : undefined}>
                <table data-width={w ?? undefined} style={w ? ({ '--table-w': w } as React.CSSProperties) : undefined}>{children}</table>
              </div>
            )
          },
          // Genişlik markdown başlığında taşınıyor (#58789618): `![a](u "w=360")`.
          img: ({ src, alt, title }) => {
            const { width } = readImageTitle(typeof title === 'string' ? title : null)
            // Elle verilen genişlikte yükseklik sınırı yok (#0bb7ea0f; editördeki ImageView ile aynı).
            const style = width ? { width, maxWidth: '100%', maxHeight: 'none' } : undefined
            return (typeof src === 'string' && VIDEO_URL_RE.test(src)) ? (
              <video src={displayUrl(src)} title={alt ?? ''} controls preload="metadata" className="fira-video" style={style} onClick={(e) => e.stopPropagation()} />
            ) : (
              <img
                src={displayUrl(src)}
                alt={alt}
                style={style}
                className="cursor-zoom-in"
                onClick={(e) => { e.stopPropagation(); if (typeof src === 'string') onFileClick(src) }}
              />
            )
          },
          a: ({ href, children }) => mentionIdFromHref(href) ? (
            <span className="mention" data-id={mentionIdFromHref(href)}>{children}</span>
          ) : (
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => {
              e.stopPropagation()
              if (href && storagePathFromUrl(href)) { e.preventDefault(); onFileClick(href) }
            }}>{children}</a>
          ),
          input: ({ checked }) => <input type="checkbox" checked={!!checked} readOnly />,
          p: ({ children }) => anchored('p', children),
          h1: ({ children }) => anchored('h1', children),
          h2: ({ children }) => anchored('h2', children),
          h3: ({ children }) => anchored('h3', children),
          h4: ({ children }) => anchored('h4', children),
          // Kod bloğu kendi kutusuna geçiyor (#58789618): dil etiketi, kopyala
          // düğmesi, kaydırmasız satırlar ve uzun blokta "Devamını göster".
          // `pre` üzerinden alınıyor çünkü dil sınıfı içteki `code`'da duruyor.
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children
            const props = (child as { props?: { className?: string; children?: React.ReactNode } })?.props
            const lang = /language-([\w-]+)/.exec(props?.className ?? '')?.[1] ?? null
            const text = String(props?.children ?? '').replace(/\n$/, '')
            return <CodeBlock code={text} language={lang} lineNumbers={lineNumbers} />
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

/**
 * The document as markdown, with each table's own width written after it
 * (#1E605419) — markdown has no attribute for it, so it travels as a
 * `{width=…}` line that this app writes and reads back.
 */
function markdownOf(editor: Editor): string | null {
  // tiptap 3.31: `destroy()` empties the extension storage (3.20 kept it). An
  // effect can still hold the editor it just replaced — reading it then crashed
  // the page ("reading 'getMarkdown'", #8a26d207). A destroyed editor has no
  // markdown; the caller skips.
  const storage = (editor as unknown as { destroyed?: boolean }).destroyed ? null
    : (editor.storage as unknown as { markdown?: { getMarkdown?: () => string } } | undefined)?.markdown
  if (!storage?.getMarkdown) return null
  const md = storage.getMarkdown()
  const widths: (string | null)[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') widths.push((node.attrs.width as string | null) ?? null)
    return true
  })
  // Hizalama ayraç satırında taşınır (GFM); tiptap-markdown hep `---` yazıyor.
  return withTableWidths(alignedTables(md, tableAligns(editor)), widths)
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DescriptionEditor({
  value, onChange, onBlur, placeholder, ticketId, readOnly, onClick, minHeight = '160px', maxHeight, onUploaded, bare, fullscreenTitle, teamId,
  anchorsFor, anchorUrl, insertSlot, toolbarOnFocus = false,
}: Props) {
  const t = useT()
  // Satır numarası tercihini düğüm görünümünün okuduğu modüle taşır (#58789618).
  useCodeLineNumbers()
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  // Araç çubuğu odakta (toolbarOnFocus, #e8bafa89). Kapanış fare bırakılana kadar
  // bekler: çubuk kalkınca içerik yukarı kayıyor, basılı tıklama başka öğeye düşüyordu.
  // Açılış tıklamayla olduysa kaydırma kabı çubuğun boyu kadar kayar, tıklanan metin yerinde kalır.
  const [barOpen, setBarOpen] = useState(!toolbarOnFocus)
  const pointerDown = useRef(false)
  const barFromPointer = useRef(false)
  useEffect(() => {
    if (!toolbarOnFocus) return
    const down = () => { pointerDown.current = true }
    const up = () => { pointerDown.current = false }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [toolbarOnFocus])
  // Fullscreen width: the reading column by default, the whole window on request.
  const fsPrefs = usePrefs('global')
  const wide = !!(fsPrefs.prefs as { fullscreenWide?: boolean }).fullscreenWide
  const toggleWide = () => fsPrefs.patch({ fullscreenWide: !wide })
  const fullscreenRef = useRef(false)
  fullscreenRef.current = fullscreen
  const exitFullscreen = useCallback(() => setFullscreen(false), [])
  useFullscreenEscape(fullscreen, exitFullscreen)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const [linkPop, setLinkPop] = useState<LinkState | null>(null)
  const [mdPop, setMdPop] = useState<{ left: number; top: number; text: string } | null>(null)
  /**
   * Düz metin olarak yapıştırılan bir şey markdown'a benziyorsa (#937e2840):
   * yapıştırma olduğu gibi kalır, altında tek tıkla "Markdown olarak
   * biçimlendir" teklifi çıkar. Her yapıştırmayı kendiliğinden ayrıştırmak
   * riskli — kod parçası ya da içinde # geçen düz metin bozulurdu.
   */
  const [mdOffer, setMdOffer] = useState<{ from: number; to: number; text: string; left: number; top: number } | null>(null)
  const mdInputRef = useRef<HTMLTextAreaElement>(null)
  const [uploading, setUploading] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const attachRef = useRef<HTMLInputElement>(null)
  // Çubuk artık akışta duruyor; yüksekliği ölçmeye gerek yok (yalnız tablo
  // satırı açılıp kapandığında kendiliğinden büyüyüp küçülüyor).
  const toolbarRef = useRef<HTMLDivElement>(null)
  // Çubuk tıklamayla açıldıysa (toolbarOnFocus) içerik onun boyu kadar aşağı itilir;
  // kaydırma kabı aynı kadar kayar ki tıklanan satır imlecin altında kalsın.
  // Kapanırken de aynı miktar geri alınır: odaklanıp çıkınca sayfa başladığı yere döner.
  const barShift = useRef(0)
  useLayoutEffect(() => {
    if (!toolbarOnFocus) return
    const sc = scrollParentOf(wrapRef.current)
    if (!barOpen) {
      if (sc && barShift.current) sc.scrollTop -= barShift.current
      barShift.current = 0
      return
    }
    if (!barFromPointer.current) return
    barFromPointer.current = false
    const h = toolbarRef.current?.offsetHeight ?? 0
    if (!sc || !h) return
    const before = sc.scrollTop
    sc.scrollTop += h
    barShift.current = sc.scrollTop - before
  }, [barOpen, toolbarOnFocus])

  const linkInputRef = useRef<HTMLInputElement>(null)
  const uploadingRef = useRef(false)
  const uploadingCount = useRef(0)
  const pendingBlur = useRef(false)
  const slashRef = useRef<SlashState | null>(null)
  const slashIndexRef = useRef(0)
  // Filled by the slash detection in onUpdate, before the menu can be navigated.
  const filteredRef = useRef<SlashItem[]>([])
  slashRef.current = slash
  slashIndexRef.current = slashIndex

  const relCoords = (view: { coordsAtPos: (p: number, side?: number) => { left: number; top: number; bottom: number } }, pos: number, side = 1) => {
    const c = view.coordsAtPos(pos, side)
    const w = wrapRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    return { left: c.left - w.left, top: c.top - w.top, bottom: c.bottom - w.top }
  }
  const relCoordsRef = useRef(relCoords); relCoordsRef.current = relCoords

  // Latest props/handlers, readable from the (stable) editor options below.
  const propsRef = useRef({ onChange, onBlur, placeholder, ticketId, onUploaded })
  propsRef.current = { onChange, onBlur, placeholder, ticketId, onUploaded }
  // The "@" popup's people: read through a ref, so the list can arrive after the editor exists.
  const members = useTeamMemberProfiles(teamId ?? null)
  const mentionRef = useRef<MentionItem[]>([])
  mentionRef.current = members.map((m) => ({ id: m.id, label: m.full_name || m.email || '?', avatar: m.avatar_url }))
  const editorRef = useRef<Editor | null>(null)
  const bubbleRef = useRef<BubbleState | null>(null)
  bubbleRef.current = bubble

  /**
   * Uploads `file` with a placeholder at `at` (default: the cursor) and then
   * puts what `place` returns there: an image/video node, or a link. `place`
   * null = upload only (the file goes to the ticket's Files, nothing in the text).
   */
  const uploadInto = useCallback(async (editor: Editor, file: File, place: ((url: string) => object) | null, at?: number) => {
    // No ticket yet (draft): nowhere to store the file, so skip it.
    const tid = propsRef.current.ticketId
    if (!tid) return
    // Several files can go up at once; the editor waits for all before a pending save.
    uploadingCount.current++
    uploadingRef.current = true
    setUploading(true)
    const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const ph = placeholderElement(file.name || t('ticket.editor.fileFallback'))
    const pos = at ?? editor.state.selection.to
    editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { add: { id, pos, el: ph.el } } satisfies UploadMeta))
    try {
      const url = await uploadEditorFile(file, tid, (loaded, total) => ph.set(total ? Math.round((loaded / total) * 100) : 0))
      const where = placeholderPos(editor, id)
      editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: id } satisfies UploadMeta))
      if (place) editor.chain().insertContentAt(where ?? editor.state.selection.to, place(url)).run()
      propsRef.current.onUploaded?.(url, file, !!place)
    } catch (e) {
      editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: id } satisfies UploadMeta))
      emitError(e)
    } finally {
      uploadingCount.current--
      uploadingRef.current = uploadingCount.current > 0
      setUploading(uploadingRef.current)
      if (!uploadingRef.current && pendingBlur.current) { pendingBlur.current = false; propsRef.current.onBlur?.() }
    }
  }, [t])
  const insertImage = useCallback((editor: Editor, file: File) =>
    uploadInto(editor, file, (url) => ({ type: 'image', attrs: { src: url, alt: file.name } })), [uploadInto])

  /**
   * Any other file (PDF, spreadsheet …): ask first (#FB541A31) — put a link to
   * it at the cursor, or only upload it (to the ticket's Files). The link text
   * is editable before it goes in.
   */
  const [fileAsk, setFileAsk] = useState<{ files: File[]; pos: number; text: string; left: number; top: number } | null>(null)
  const askFiles = useCallback((editor: Editor, files: File[]) => {
    if (!files.length || !propsRef.current.ticketId) return
    const pos = editor.state.selection.to
    const c = relCoordsRef.current(editor.view, pos)
    setFileAsk({ files, pos, text: files[0].name, left: c.left, top: c.bottom + 6 })
  }, [])
  const addFiles = useCallback((editor: Editor, files: File[]) => {
    files.filter(isMedia).forEach((f) => insertImage(editor, f))
    askFiles(editor, files.filter((f) => !isMedia(f)))
  }, [insertImage, askFiles])
  const addFilesRef = useRef(addFiles); addFilesRef.current = addFiles

  // IMPORTANT: useEditor re-applies options (setOptions → view.updateState) whenever
  // the options object changes between renders. That re-syncs the DOM selection,
  // which fires selectionUpdate again → setState → render → … an infinite loop.
  // So the options object is created exactly once; everything dynamic goes through refs.
  const editorOptions = useMemo(() => ({
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Bırakma imleci markanın rengiyle (#489eda17): varsayılan `currentColor`
        // koyu temada beyaza dönüyor ve uygulamanın diğer bırakma işaretlerine
        // (hepsi primary tonunda) benzemiyordu.
        dropcursor: { color: '#6366f1', width: 2 },
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
        underline: false, // no markdown equivalent
        hardBreak: false, // TableAwareHardBreak below
      }),
      TableAwareHardBreak,
      MediaImage.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      MixedLists,
      CodeBlockTools,
      ImageTools,
      MentionNode.configure({ suggestion: mentionSuggestion(() => mentionRef.current) }),
      TableKit.configure({ table: { resizable: false } }),
      TableWidthMarkers,
      TableAlign,
      Placeholder.configure({
        // Only the node that holds the cursor gets a hint (never every empty line).
        showOnlyCurrent: true,
        includeChildren: false,
        placeholder: ({ editor, node }) => {
          if (node.type.name === 'heading') return staticT('ticket.editor.headingLevel', { n: node.attrs.level })
          if (node.type.name !== 'paragraph') return ''
          // Empty document → full descriptive hint; empty line inside content → short hint
          if (editor.isEmpty) return propsRef.current.placeholder ?? staticT('ticket.editor.defaultPlaceholder')
          return staticT('ticket.editor.slashHint')
        },
      }),
      MarkdownLinkInput,
      UploadPlaceholders,
      Markdown.configure({
        html: false,
        tightLists: true,
        linkify: true,
        // Kopyalarken panoya markdown YAZMA (#937e2840): panoya zengin metin
        // (text/html) ve sade düz metin gider. Böylece Fira'dan Fira'ya kopyala
        // yapıştır biçimi korur, dışarıya (şifre, kullanıcı adı, bir cümle)
        // yapıştırırken ** ve ` işaretleri bulaşmaz.
        transformCopiedText: false,
        transformPastedText: true,
      }),
    ],
    content: value,
    editable: !readOnly,
    onUpdate({ editor }: { editor: Editor }) {
      const md = markdownOf(editor)
      if (md !== null) propsRef.current.onChange(md)
      // slash detection
      const { $from, empty } = editor.state.selection
      if (!empty) { setSlash(null); return }
      const parentType = $from.parent.type.name
      if (parentType !== 'paragraph' && parentType !== 'heading') { setSlash(null); return }
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const m = /(?:^|\s)\/([^\s/]*)$/.exec(before)
      if (m) {
        const from = $from.pos - m[1].length - 1
        const c = relCoords(editor.view, from)
        filteredRef.current = filterSlash(m[1])
        setSlash({ query: m[1], from, to: $from.pos, left: c.left, top: c.bottom + 4 })
        setSlashIndex(0)
      } else {
        setSlash(null)
      }
    },
    onSelectionUpdate({ editor }: { editor: Editor }) {
      const { from, to, empty } = editor.state.selection
      const isNode = 'node' in editor.state.selection
      if (empty || isNode || editor.isActive('codeBlock')) {
        if (bubbleRef.current) setBubble(null)
        return
      }
      const a = relCoords(editor.view, from, 1)
      const b = relCoords(editor.view, to, -1)
      // Prefer above the selection; if that would cover the toolbar, go below.
      const above = Math.min(a.top, b.top) - 40
      const next = { left: Math.min(a.left, b.left), top: above < 40 ? Math.max(a.bottom, b.bottom) + 8 : above }
      const cur = bubbleRef.current
      if (!cur || cur.left !== next.left || cur.top !== next.top) setBubble(next)
      if (slashRef.current) setSlash(null)
    },
    onBlur() {
      if (uploadingRef.current) { pendingBlur.current = true; return }
      propsRef.current.onBlur?.()
    },
    onFocus() { if (bubbleRef.current) setBubble(null) },
    editorProps: {
      attributes: { class: 'ProseMirror-fira' },
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        // Slash menu navigation
        const s = slashRef.current
        if (s) {
          const items = filteredRef.current
          if (event.key === 'ArrowDown') { setSlashIndex(i => (i + 1) % Math.max(items.length, 1)); return true }
          if (event.key === 'ArrowUp') { setSlashIndex(i => (i - 1 + items.length) % Math.max(items.length, 1)); return true }
          if (event.key === 'Escape') { setSlash(null); return true }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const item = items[slashIndexRef.current]
            if (item) { runSlashRef.current(item); return true }
          }
        }
        if (event.key === 'Escape' && bubbleRef.current) { setBubble(null); return true }
        if (event.key === 'Escape' && fullscreenRef.current) { event.preventDefault(); setFullscreen(false); return true }
        // Esc or Ctrl/Cmd+Enter → finish editing: leave the editor (blur commits via onBlur).
        // preventDefault keeps the outer modal from treating the same Esc as "close".
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault()
          view.dom.blur()
          return true
        }
        // Ctrl/Cmd+K → link
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          openLinkRef.current()
          return true
        }
        // Reset stored marks after Enter so bold/italic don't leak into new paragraph
        if (event.key === 'Enter' && !event.shiftKey) {
          requestAnimationFrame(() => {
            if (view.isDestroyed) return
            view.dispatch(view.state.tr.setStoredMarks([]))
          })
        }
        return false
      },
      handlePaste(view: EditorView, event: ClipboardEvent) {
        const items = Array.from(event.clipboardData?.items ?? [])
        // Plain text that reads like Markdown: let it land as it is, then offer
        // to format it (#937e2840). HTML on the clipboard is already rich, so
        // this only looks at text-only pastes.
        const text = event.clipboardData?.getData('text/plain') ?? ''
        const html = event.clipboardData?.getData('text/html') ?? ''
        if (!html && looksLikeMarkdown(text) && editorRef.current) {
          const from = view.state.selection.from
          window.setTimeout(() => {
            const ed = editorRef.current
            if (!ed) return
            const to = ed.state.selection.from
            const c = relCoordsRef.current(ed.view, to)
            setMdOffer({ from, to, text, left: Math.max(0, c.left), top: c.bottom + 6 })
          }, 0)
          return false
        }
        // Images and videos go into the text (a video as a player); any other
        // file asks: a link at the cursor, or only upload it.
        const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f)
        if (!files.length || !editorRef.current) return false
        event.preventDefault()
        addFilesRef.current(editorRef.current, files)
        return true
      },
      handleDrop(view: EditorView, event: DragEvent) {
        // Dosyalar panelinden sürüklenen, zaten yüklü bir belge (#489eda17):
        // yeniden yükleme yok, bırakıldığı yere düğüm olarak girer.
        const known = readFileDrag(event.dataTransfer)
        if (known && editorRef.current) {
          event.preventDefault()
          const spot = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const chain = editorRef.current.chain().focus()
          if (spot) chain.setTextSelection(spot.pos)
          chain.insertContent(nodeFor(known)).run()
          return true
        }
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length === 0 || !editorRef.current) return false
        event.preventDefault()
        // Put the cursor where the files were dropped.
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (at) editorRef.current.commands.setTextSelection(at.pos)
        addFilesRef.current(editorRef.current, files)
        return true
      },
      // A click on an image or on a link to one of our files opens the Files
      // viewer (#0E2B2AB8). The click still selects/places the cursor as usual,
      // so after closing it the image is selected (Delete removes it).
      handleClick(view: EditorView, _pos: number, event: MouseEvent) {
        // Only the primary button (#6740c2b3): the editor reports a "click" for every mouse button,
        // so a right click (the context menu), the wheel and the side buttons opened the viewer too.
        // Ctrl+click on a Mac is its right click.
        if (event.button !== 0 || (event.ctrlKey && /Mac|iPhone|iPad/.test(navigator.platform))) return false
        const el = event.target instanceof Element ? event.target : null
        const img = el?.closest('img')
        const href = el?.closest('a[href]')?.getAttribute('href')
        const url = img && view.dom.contains(img) ? img.getAttribute('src') : href && storagePathFromUrl(href) ? href : null
        if (url) setLightbox(url)
        return false
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  const editor = useEditor(editorOptions)
  editorRef.current = editor

  // Dosyalar panelinden bir dosya sürüklenirken editör "buraya bırakabilirsin"
  // diye işaretlenir (#489eda17, ikinci tur).
  const [fileDragging, setFileDragging] = useState(isFileDragActive())
  useEffect(() => onFileDragChange(setFileDragging), [])

  // Dosyalar panelinin "açıklamaya / yoruma ekle" isteği (#489eda17): yuvası ve
  // görevi tutan editör dosyayı imlecin olduğu yere koyar ve odağı alır.
  useEffect(() => onInsertFile(({ ticketId: tid, slot, file }) => {
    const ed = editorRef.current
    if (!ed || readOnly || !insertSlot || slot !== insertSlot || tid !== propsRef.current.ticketId) return
    // Önce içerik, sonra odak. `chain().focus().insertContent()` odak alınamayan
    // (ör. görünür alandan çıkmış) editörde zinciri düşürüyor ve hiçbir şey
    // eklenmiyordu; ekleme odaktan bağımsız olmalı.
    const at = ed.state.selection.to
    ed.commands.insertContentAt(at, nodeFor(file))
    ed.commands.focus()
    ed.view.dom.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }), [insertSlot, readOnly])

  // ── Slash execution ──────────────────────────────────────────────────────────
  const runSlashRef = useRef<(item: SlashItem) => void>(() => {})
  runSlashRef.current = (item) => {
    const s = slashRef.current
    if (!editor || !s) return
    editor.chain().focus().deleteRange({ from: s.from, to: s.to }).run()
    setSlash(null)
    if (item.id === 'markdown') {
      setMdPop({ left: s.left, top: s.top, text: '' })
      setTimeout(() => mdInputRef.current?.focus(), 0)
      return
    }
    item.run(editor)
  }

  // ── Markdown paste popover ("/markdown") ─────────────────────────────────────
  const insertMarkdown = () => {
    if (!editor || !mdPop) return
    const text = mdPop.text.trim()
    // tiptap-markdown patches insertContent: a string is parsed as Markdown
    if (text) editor.chain().focus().insertContent(text).run()
    setMdPop(null)
  }

  /** Teklifi kabul: yapıştırılan aralığı biçimli hâliyle değiştirir. */
  const applyMdOffer = () => {
    if (!editor || !mdOffer) return
    editor.chain().focus().deleteRange({ from: mdOffer.from, to: mdOffer.to }).insertContent(mdOffer.text.trim()).run()
    setMdOffer(null)
  }
  // Teklif tek yapıştırmalıktır: bir sonraki değişiklikte ya da odak gidince kalkar.
  useEffect(() => {
    if (!mdOffer || !editor) return
    const drop = () => setMdOffer(null)
    const h = window.setTimeout(drop, 12000)
    editor.on('selectionUpdate', drop)
    editor.on('blur', drop)
    return () => { window.clearTimeout(h); editor.off('selectionUpdate', drop); editor.off('blur', drop) }
  }, [mdOffer, editor])

  // ── Link popover ─────────────────────────────────────────────────────────────
  const openLinkRef = useRef<() => void>(() => {})
  openLinkRef.current = () => {
    if (!editor) return
    const { from } = editor.state.selection
    const c = relCoords(editor.view, from)
    setLinkPop({ left: c.left, top: c.bottom + 6, href: editor.getAttributes('link').href ?? '' })
    setBubble(null)
    setTimeout(() => linkInputRef.current?.focus(), 0)
  }
  /**
   * İmleç bir kelimenin içindeyken o kelimenin sınırları (#d46f6d70 2. tur).
   * Seçim yapmadan bağlantı düğmesine basınca eskiden imlecin olduğu yere çıplak
   * bir adres yazılıyordu; beklenen, üzerinde durduğun kelimenin bağlantı olması.
   */
  const wordAround = () => {
    if (!editor) return null
    const { $from, empty } = editor.state.selection
    if (!empty) return null
    const text = $from.parent.textContent
    const off = $from.parentOffset
    const isWord = (c: string | undefined) => !!c && !/\s/.test(c)
    let a = off, b = off
    while (a > 0 && isWord(text[a - 1])) a--
    while (b < text.length && isWord(text[b])) b++
    return b > a ? { from: $from.start() + a, to: $from.start() + b } : null
  }
  const applyLink = () => {
    if (!editor || !linkPop) return
    const href = linkPop.href.trim()
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      const url = /^(https?:\/\/|mailto:|\/)/i.test(href) ? href : `https://${href}`
      const word = editor.isActive('link') ? null : wordAround()
      if (word) {
        editor.chain().focus().setTextSelection(word).setLink({ href: url }).run()
      } else if (editor.state.selection.empty && !editor.isActive('link')) {
        // Boşlukta duruyorsa yazacak bir kelime yok: adresin kendisi metin olur.
        editor.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      }
    }
    setLinkPop(null)
  }

  // ── Sync external value → editor (e.g. ticket loads after mount) ────────────
  useEffect(() => {
    if (!editor) return
    const current = markdownOf(editor)
    if (current === null) return   // the editor was just replaced; the new one syncs itself
    if (current !== value && !editor.isFocused) {
      editor.commands.setContent(value, { emitUpdate: false })
      // setContent leaves the selection at the end of the text; when the text ends with an image,
      // that is the image itself: it was drawn as selected in a task opened from the board, and the
      // first key after tabbing into the editor would have replaced it.
      if (editor.state.selection instanceof NodeSelection) editor.commands.setTextSelection(editor.state.doc.content.size)
    }
  }, [editor, value])

  // Close popovers on outside click
  useEffect(() => {
    if (!slash && !bubble && !linkPop && !mdPop && !fileAsk) return
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setSlash(null); setBubble(null); setLinkPop(null); setMdPop(null); setFileAsk(null)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [slash, bubble, linkPop, mdPop, fileAsk])

  /** The file question's answer: a link at the saved spot, or upload only. Next file (if several) asks in turn. */
  const answerFile = (mode: 'link' | 'upload' | 'skip') => {
    if (!fileAsk || !editor) return
    const [file, ...rest] = fileAsk.files
    const text = fileAsk.text.trim() || file.name
    if (mode === 'link') {
      void uploadInto(editor, file, (url) => [{ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] }, { type: 'text', text: ' ' }], fileAsk.pos)
    } else if (mode === 'upload') void uploadInto(editor, file, null, fileAsk.pos)
    if (rest.length) setFileAsk({ ...fileAsk, files: rest, text: rest[0].name })
    else { setFileAsk(null); editor.commands.focus() }
  }

  /** Seçimin içinde bulunduğu en üst seviye bloğun adresini panoya koyar. */
  const copyBlockLink = async () => {
    if (!anchorsFor) return
    const root = document.querySelector('article .ProseMirror') ?? document.querySelector('.ProseMirror')
    const sel = window.getSelection()
    let node: Node | null = sel?.anchorNode ?? null
    while (node && node.parentElement && node.parentElement !== root) node = node.parentElement
    const block = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
    if (!root || !block) return
    const index = [...root.children].indexOf(block)
    const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim()
    // Etiket bloğun kendi metni: sohbete yapıştırılınca neye götürdüğü okunur.
    const anchor = anchorFor(text, Math.max(0, index))
    await copyLink(anchorUrl ? anchorUrl(anchor) : pageUrl(anchorsFor, anchor), text.slice(0, 70) || document.title)
  }

  // ── Read-only ────────────────────────────────────────────────────────────────
  if (readOnly) {
    return (
      <>
        {inBody(<div className={fullscreen ? FULLSCREEN_CLASS : 'relative group/ro'}>
          {fullscreen && <FullscreenBar wide={wide} onToggleWide={toggleWide} title={fullscreenTitle ?? t('ticket.description')} onClose={exitFullscreen} />}
          <div
            onClick={onClick}
            style={fullscreen ? undefined : { minHeight }}
            className={[
              bare ? 'text-sm py-1 leading-relaxed' : 'text-sm rounded-lg px-3 py-2.5 leading-relaxed',
              fullscreen ? `flex-1 min-h-0 overflow-y-auto scrollbar-thin w-full mx-auto md:px-8 md:py-6 ${wide ? '' : 'max-w-4xl'}` : '',
              onClick ? 'cursor-pointer hover:bg-raised/50 transition-colors' : '',
              !value ? 'text-fg-faint italic' : 'text-fg',
            ].join(' ')}
          >
            {value ? <MarkdownView value={value} onFileClick={setLightbox} anchorsFor={anchorsFor} anchorUrl={anchorUrl} /> : (placeholder ?? t('ticket.noDescription'))}
          </div>
          {!fullscreen && !!value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFullscreen(true) }}
              title={t('common.fullscreen')}
              className="absolute top-1 right-1 p-1 rounded-md text-fg-faint hover:text-fg hover:bg-raised opacity-0 group-hover/ro:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              <Icon k="expand" />
            </button>
          )}
        </div>, fullscreen)}
        {lightbox && <InlineFilePreview ticketId={ticketId} content={value} url={lightbox} onClose={() => setLightbox(null)} />}
      </>
    )
  }

  // ── Edit mode ────────────────────────────────────────────────────────────────
  const filtered = filterSlash(slash?.query ?? '')
  // Tablo satırındaki hizalama düğmeleri imlecin sütununu gösterir.
  const columnAlign = editor && editor.isActive('table') ? currentAlign(editor) : null
  const blockValue = editor?.isActive('heading', { level: 1 }) ? 'h1'
    : editor?.isActive('heading', { level: 2 }) ? 'h2'
    : editor?.isActive('heading', { level: 3 }) ? 'h3'
    : 'p'

  return (
    <>
      {inBody(<div
        ref={wrapRef}
        data-insert-slot={insertSlot}
        onFocus={toolbarOnFocus ? () => { if (!barOpen) { barFromPointer.current = pointerDown.current; setBarOpen(true) } } : undefined}
        onBlur={toolbarOnFocus ? (e) => {
          const next = e.relatedTarget as Node | null
          if (next && wrapRef.current?.contains(next)) return
          const hide = () => { if (!wrapRef.current?.contains(document.activeElement)) setBarOpen(false) }
          if (pointerDown.current) window.addEventListener('pointerup', () => window.setTimeout(hide, 0), { once: true, capture: true })
          else hide()
        } : undefined}
        data-file-drop={fileDragging && !readOnly ? '' : undefined}
        className={fullscreen
          ? `group ${FULLSCREEN_CLASS}`
          : bare
            ? 'group relative'
            : 'group relative rounded-lg border border-line bg-surface transition-shadow focus-within:border-primary-400 dark:focus-within:border-primary-600 focus-within:ring-2 focus-within:ring-primary-500/30'}
      >
        {/* ── Toolbar ── Bileşenin **içinde**, akışta (#58789618).
            Eskiden alanın üstünde yüzen, yer kalmayınca altına geçen, uzun
            metinde gövdeye portal'lanıp sabitlenen bir katmandı; üç ayrı yol
            hem kırılgandı hem de kapanırken altındaki metnin bir pikselini
            gösteriyordu (kullanıcı raporu). Şimdi kutunun üstünde duran,
            kaydırınca kendi kutusunun üstüne yapışan sıradan bir satır. */}
        {!readOnly && (barOpen || fullscreen) && (
        <div
          ref={toolbarRef}
          data-editor-bar="inline"
          data-wco-bar={fullscreen ? '' : undefined}
          className={fullscreen
            ? 'bg-surface border-b border-line-soft rounded-t-lg'
            : 'sticky top-0 z-20 bg-surface border-b border-line-soft rounded-t-lg'}
        >
        <div className="flex items-center gap-0.5 px-1.5 py-1 flex-wrap">
          <select
            value={blockValue}
            title={t('ticket.editor.textStyle')}
            aria-label={t('ticket.editor.textStyle')}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'p') editor?.chain().focus().setParagraph().run()
              else editor?.chain().focus().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run()
            }}
            className="h-7 text-xs rounded-md border border-transparent hover:border-slate-200 dark:hover:border-gray-700 bg-transparent text-fg-2 px-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
          >
            <option value="p">{t('ticket.editor.slash.text')}</option>
            <option value="h1">{t('ticket.editor.slash.h1')}</option>
            <option value="h2">{t('ticket.editor.slash.h2')}</option>
            <option value="h3">{t('ticket.editor.slash.h3')}</option>
          </select>
          <Sep />
          <TBtn icon="bold" title={t('ticket.editor.boldTitle')} active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} />
          <TBtn icon="italic" title={t('ticket.editor.italicTitle')} active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} />
          <TBtn icon="strike" title={t('ticket.editor.strikeTitle')} active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()} />
          <TBtn icon="code" title={t('ticket.editor.codeTitle')} active={editor?.isActive('code')} onClick={() => editor?.chain().focus().toggleCode().run()} />
          <TBtn icon="link" title={t('ticket.editor.linkTitle')} active={editor?.isActive('link')} onClick={() => openLinkRef.current()} />
          <Sep />
          <TBtn icon="bullet" title={t('ticket.editor.slash.ul')} active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
          <TBtn icon="ordered" title={t('ticket.editor.slash.ol')} active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
          <TBtn icon="task" title={t('ticket.editor.slash.todo')} active={editor?.isActive('taskList')} onClick={() => editor?.chain().focus().toggleTaskList().run()} />
          <Sep />
          <TBtn icon="quote" title={t('ticket.editor.slash.quote')} active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
          <TBtn icon="codeblock" title={t('ticket.editor.slash.code')} active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
          <TBtn icon="hr" title={t('ticket.editor.slash.hr')} onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
          <TBtn icon="table" title={t('ticket.editor.insertTable')} active={editor?.isActive('table')} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          <TBtn icon="image" title={t('ticket.editor.uploadImage')} disabled={uploading} onClick={() => fileRef.current?.click()} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f && editor) insertImage(editor, f)
              e.target.value = ''
            }}
          />
          {/* Any file: images/videos go in, others ask (link or upload only). */}
          <TBtn icon="attach" title={t('ticket.editor.attachFile')} onClick={() => attachRef.current?.click()} />
          <input
            ref={attachRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length && editor) addFiles(editor, files)
              e.target.value = ''
            }}
          />
          <div className="flex-1" />
          <TBtn icon="undo" title={t('ticket.editor.undo')} disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()} />
          <TBtn icon="redo" title={t('ticket.editor.redo')} disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()} />
          <Sep />
          <TBtn
            icon={fullscreen ? 'compress' : 'expand'}
            title={fullscreen ? t('ticket.editor.exitFullscreen') : t('common.fullscreen')}
            active={fullscreen}
            onClick={() => { setFullscreen((f) => !f); editor?.commands.focus() }}
          />
          {fullscreen && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); toggleWide() }}
              aria-pressed={wide}
              className={`h-7 text-xs px-2 rounded-md border transition-colors ${wide ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300' : 'border-line text-fg-2 hover:bg-raised'}`}
            >
              {wide ? t('ticket.editor.readingColumn') : t('ticket.editor.wideView')}
            </button>
          )}
          <span className="hidden md:inline text-xs text-fg-faint select-none px-1.5 whitespace-nowrap">
            {uploading ? t('ticket.editor.uploading') : fullscreen ? t('ticket.editor.fullscreenHint') : t('ticket.editor.hint')}
          </span>
        </div>
        {/* ── Table controls ── A second toolbar row while the cursor is in a
            table (#0E2B2AB8): as part of the sticky toolbar they stay on screen
            even when the table sits at the top of a long text. */}
        {editor?.isActive('table') && (
          <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-t border-line-soft text-xs text-fg-2">
            <span className="text-xs font-semibold text-fg-muted px-1.5 select-none">{t('ticket.editor.table')}</span>
            {([
              ['addRow', t('ticket.editor.addRow'), () => editor.chain().focus().addRowAfter().run()],
              ['delRow', t('ticket.editor.delRow'), () => editor.chain().focus().deleteRow().run()],
              ['addCol', t('ticket.editor.addCol'), () => editor.chain().focus().addColumnAfter().run()],
              ['delCol', t('ticket.editor.delCol'), () => editor.chain().focus().deleteColumn().run()],
              ['headerRow', t('ticket.editor.headerRow'), () => editor.chain().focus().toggleHeaderRow().run()],
            ] as const).map(([id, label, fn]) => (
              <button
                key={id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); fn() }}
                className="h-7 px-2 rounded-md hover:bg-raised cursor-pointer"
              >
                {label}
              </button>
            ))}
            {/* Sütun hizalaması (#58789618): markdown'ın `:---:` ayracına yazılır. */}
            <span className="inline-flex items-center gap-0.5 pl-1 ml-1 border-l border-line-soft">
              <span className="text-xs text-fg-muted px-1 select-none">{t('ticket.editor.align')}</span>
              {([
                ['left', t('ticket.editor.alignLeft'), 'alignLeft'],
                ['center', t('ticket.editor.alignCenter'), 'alignCenter'],
                ['right', t('ticket.editor.alignRight'), 'alignRight'],
              ] as const).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={columnAlign === value}
                  onMouseDown={(e) => { e.preventDefault(); setColumnAlign(editor, columnAlign === value ? null : value) }}
                  className={`h-7 w-7 rounded-md flex items-center justify-center cursor-pointer ${columnAlign === value ? 'bg-primary-600 text-white' : 'hover:bg-raised'}`}
                >
                  <SetIcon name={icon} />
                </button>
              ))}
            </span>
            {/* Wide table (#1E605419): the table gets its own width and scrolls
                sideways inside the text instead of squeezing into the column. */}
            <TableWidthBox editor={editor} />
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteTable().run() }}
              className="h-7 px-2 rounded-md hover:bg-raised cursor-pointer text-danger ml-auto"
            >
              {t('ticket.editor.deleteTable')}
            </button>
          </div>
        )}
        </div>
        )}

        {/* ── Editor ── */}
        <EditorContent
          editor={editor}
          className={fullscreen
            ? `tiptap-editor flex-1 min-h-0 overflow-y-auto scrollbar-thin [&_.ProseMirror]:mx-auto [&_.ProseMirror]:md:px-8 [&_.ProseMirror]:md:py-6 [&_.ProseMirror]:min-h-full ${wide ? '' : '[&_.ProseMirror]:max-w-4xl'}`
            : `${bare ? 'tiptap-editor tiptap-bare' : 'tiptap-editor'}${maxHeight ? ' overflow-y-auto scrollbar-thin' : ''}`}
          style={fullscreen ? undefined : { minHeight, maxHeight }}
        />
        {/* ── Bubble toolbar (text selection) ──
            Çubuk uygulamanın yüzey renklerini kullanır (#7490192f). Eskiden ters
            bir koyu pastildi: rengini `bg-fg`den, simgelerini sabit bir gri
            tondan alıyordu — koyu temada zemin beyaza dönüp simgeler açık gri
            kalınca okunmaz oluyordu. Düğmelerin kendi tema sınıfları (TBtn) iki
            temada da doğru; artık üstlerine yazılmıyor. */}
        {bubble && editor && (
          <div
            role="toolbar"
            aria-label={t('ticket.editor.formatting')}
            style={{ left: Math.max(0, bubble.left), top: Math.max(0, bubble.top) }}
            className="absolute z-30 flex items-center gap-0.5 px-1 py-1 rounded-xl bg-surface border border-line shadow-2xl animate-fade-in"
          >
            <TBtn icon="bold" title={t('ticket.editor.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
            <TBtn icon="italic" title={t('ticket.editor.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <TBtn icon="strike" title={t('ticket.editor.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
            <TBtn icon="code" title={t('ticket.editor.code')} active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} />
            <TBtn icon="link" title={t('ticket.editor.link')} active={editor.isActive('link')} onClick={() => openLinkRef.current()} />
            <Sep />
            <TBtn icon="h2" title={t('ticket.editor.heading')} active={editor.isActive('heading')} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
            <TBtn icon="bullet" title={t('ticket.editor.list')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <TBtn icon="quote" title={t('ticket.editor.slash.quote')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
            {/* Sayfada: seçili bloğa giden adresi kopyala (#d46f6d70). Yazma yetkisi
                olanlar sayfayı hep editörde görüyor, okuma görünümündeki zincir
                düğmesi onlara hiç çıkmıyor; bu yüzden aynı iş burada da duruyor. */}
            {anchorsFor && (
              <>
                <Sep />
                <button
                  type="button"
                  title={t('page.copyBlockLink')}
                  aria-label={t('page.copyBlockLink')}
                  className="w-7 h-7 rounded-md inline-flex items-center justify-center text-fg-muted hover:bg-raised hover:text-fg transition-colors"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void copyBlockLink()}
                >
                  <SetIcon name="link" />
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Slash menu ── */}
        {slash && (
          <div
            role="listbox"
            aria-label={t('ticket.editor.insertBlock')}
            style={{ left: Math.max(0, slash.left), top: slash.top }}
            className="absolute z-30 w-64 max-h-72 overflow-y-auto rounded-xl bg-surface border border-line shadow-lg p-1 animate-fade-in scrollbar-thin"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fg-faint">{t('ticket.editor.noResults')}</p>
            ) : filtered.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={i === slashIndex}
                onMouseEnter={() => setSlashIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); runSlashRef.current(item) }}
                className={`w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  i === slashIndex ? 'bg-primary-50 dark:bg-primary-950/40' : 'hover:bg-raised'
                }`}
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-md bg-raised text-fg-2 flex-shrink-0">
                  <Icon k={item.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-fg leading-tight">{item.label}</span>
                  <span className="block text-2xs text-fg-faint font-mono truncate">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── Link popover ── */}
        {linkPop && (
          <div
            style={{ left: Math.max(0, linkPop.left), top: linkPop.top }}
            className="absolute z-30 flex items-center gap-1.5 p-1.5 rounded-lg bg-surface border border-line shadow-lg animate-fade-in"
          >
            <input
              ref={linkInputRef}
              value={linkPop.href}
              onChange={(e) => setLinkPop({ ...linkPop, href: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); applyLink() }
                if (e.key === 'Escape') { setLinkPop(null); editor?.commands.focus() }
              }}
              placeholder="https://…"
              className="w-56 text-xs px-2 py-1.5 rounded-md border border-line bg-field text-fg focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <button type="button" onMouseDown={(e) => { e.preventDefault(); applyLink() }} className="text-xs px-2 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700">
              {linkPop.href ? t('ticket.editor.apply') : t('common.remove')}
            </button>
            {/* Bağlantıyı kaldırmak için kutuyu boşaltıp Enter'a basmak gerekiyordu;
                kimse bulamaz. Bağlantının üstündeyken yazılı düğme duruyor. */}
            {editor?.isActive('link') && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkPop(null) }}
                className="text-xs px-2 py-1.5 rounded-md text-fg-2 hover:bg-raised hover:text-danger"
              >
                {t('ticket.editor.linkRemove')}
              </button>
            )}
          </div>
        )}

        {/* ── A document was added: link at the cursor, or upload only ── */}
        {fileAsk && (
          <div
            role="dialog"
            aria-label={t('ticket.editor.fileAsk.title')}
            style={{ left: Math.max(0, Math.min(fileAsk.left, (wrapRef.current?.clientWidth ?? 400) - 328)), top: fileAsk.top }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { markHandled(e.nativeEvent); answerFile('skip') } }}
            className="absolute z-30 w-80 p-3 rounded-xl bg-surface border border-line shadow-lg animate-fade-in"
          >
            <p className="text-xs font-semibold text-fg truncate" title={fileAsk.files[0].name}>{fileAsk.files[0].name}</p>
            <p className="text-2xs text-fg-faint mb-2 tabular-nums">
              {formatBytes(fileAsk.files[0].size)}
              {fileAsk.files.length > 1 ? ` · ${t('ticket.editor.fileAsk.more', { n: fileAsk.files.length - 1 })}` : ''}
            </p>
            <label className="block text-xs font-semibold text-fg-muted mb-1" htmlFor="fira-file-link-text">{t('ticket.editor.fileAsk.linkText')}</label>
            <input
              id="fira-file-link-text"
              autoFocus
              value={fileAsk.text}
              onChange={(e) => setFileAsk({ ...fileAsk, text: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); answerFile('link') } }}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-line bg-field text-fg focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <div className="flex items-center gap-1.5 mt-2.5">
              <button type="button" onClick={() => answerFile('link')} className="text-xs px-2.5 py-1.5 rounded-md bg-primary-600 text-white font-medium hover:bg-primary-700">{t('ticket.editor.fileAsk.insertLink')}</button>
              {/* Only where the file has somewhere to live besides the text (a ticket's Files). */}
              {propsRef.current.onUploaded && (
                <button type="button" onClick={() => answerFile('upload')} className="text-xs px-2.5 py-1.5 rounded-md border border-line text-fg-2 hover:bg-raised" title={t('ticket.editor.fileAsk.uploadOnlyHint')}>{t('ticket.editor.fileAsk.uploadOnly')}</button>
              )}
              <button type="button" onClick={() => answerFile('skip')} className="ml-auto text-xs px-2 py-1.5 rounded-md text-fg-muted hover:text-fg">{t('common.cancel')}</button>
            </div>
          </div>
        )}

        {/* ── Yapıştırılan metin markdown'a benziyorsa: tek tıkla biçimlendir (#937e2840) ── */}
        {mdOffer && (
          <div
            style={{ left: Math.max(0, mdOffer.left), top: mdOffer.top }}
            className="absolute z-30 flex items-center gap-1.5 px-2 py-1 rounded-xl bg-surface border border-line text-fg-2 shadow-2xl animate-fade-in text-xs"
            data-md-offer
          >
            <span className="text-fg-muted">{t('ticket.editor.mdOffer')}</span>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); applyMdOffer() }}
              className="font-semibold px-1.5 py-0.5 rounded-md bg-primary-600 text-white hover:bg-primary-700"
              data-md-offer-apply
            >
              {t('ticket.editor.mdOfferApply')}
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setMdOffer(null) }}
              aria-label={t('common.close')}
              className="px-1 text-fg-faint hover:text-fg"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Markdown paste popover ── */}
        {mdPop && (
          <div
            style={{ left: Math.max(0, Math.min(mdPop.left, 40)), top: mdPop.top }}
            onKeyDown={(e) => e.stopPropagation()}
            className="absolute z-30 right-2 max-w-[560px] p-2.5 rounded-xl bg-surface border border-line shadow-lg animate-fade-in"
          >
            <p className="text-xs font-semibold text-fg-muted mb-1.5">
              {t('ticket.editor.mdPaste')}
            </p>
            <textarea
              ref={mdInputRef}
              value={mdPop.text}
              onChange={(e) => setMdPop({ ...mdPop, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setMdPop(null); editor?.commands.focus() }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); insertMarkdown() }
              }}
              rows={7}
              spellCheck={false}
              placeholder={t('ticket.editor.mdSample')}
              className="w-full text-xs font-mono leading-relaxed px-2.5 py-2 rounded-md border border-line bg-raised text-fg placeholder-fg-faint focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y"
            />
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <span className="text-xs text-fg-faint">{t('ticket.editor.mdHint')}</span>
              <span className="flex gap-1.5">
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setMdPop(null); editor?.commands.focus() }}
                  className="text-xs px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-raised"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertMarkdown() }}
                  disabled={!mdPop.text.trim()}
                  className="text-xs px-2.5 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {t('common.add')}
                </button>
              </span>
            </div>
          </div>
        )}
      </div>, fullscreen)}

      {lightbox && <InlineFilePreview ticketId={ticketId} content={value} url={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}
