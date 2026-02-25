import { useRef, useState, useLayoutEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { supabase } from '../../lib/supabase'

interface Props {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  ticketId: string
  readOnly?: boolean
  onClick?: () => void
  minHeight?: string
}

// ─── Upload ───────────────────────────────────────────────────────────────────
async function uploadPastedImage(file: File, ticketId: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Oturum bulunamadı')
  const ext = file.type.split('/')[1] ?? 'png'
  const path = `${user.id}/${ticketId}/${Date.now()}-paste.${ext}`
  const { error } = await supabase.storage.from('ticket-attachments').upload(path, file)
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('ticket-attachments').getPublicUrl(path)
  return publicUrl
}

// ─── Markdown ↔ HTML conversions ─────────────────────────────────────────────
const IMG_STYLE =
  'max-height:200px;max-width:100%;border-radius:8px;border:1px solid rgba(128,128,128,0.25);object-fit:contain;margin:2px 2px;display:inline-block;vertical-align:middle;cursor:zoom-in;'

function markdownToHtml(md: string): string {
  if (!md) return ''
  return md
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, `<img src="$2" alt="$1" style="${IMG_STYLE}" />`)
    .split('\n')
    .map((line) => (line === '' ? '<br>' : line))
    .join('<br>')
}

function htmlToMarkdown(el: HTMLDivElement): string {
  const parts: string[] = []

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const elem = node as HTMLElement
    const tag = elem.tagName.toLowerCase()

    if (tag === 'img') {
      const src = elem.getAttribute('src') ?? ''
      const alt = elem.getAttribute('alt') ?? 'resim'
      parts.push(`![${alt}](${src})`)
      return
    }
    if (tag === 'br') {
      parts.push('\n')
      return
    }
    if (tag === 'div' || tag === 'p') {
      if (parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n')
      elem.childNodes.forEach(walk)
      if (parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n')
      return
    }
    elem.childNodes.forEach(walk)
  }

  el.childNodes.forEach(walk)
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-6"
      onClick={onClose}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-2xl leading-none hover:text-gray-300 bg-black/50 rounded-full w-10 h-10 flex items-center justify-center"
      >
        ✕
      </button>
      <img
        src={src}
        alt="Tam ekran"
        className="max-w-full max-h-full rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

// ─── Insert node at current caret ─────────────────────────────────────────────
function insertNodeAtCursor(node: Node) {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  range.insertNode(node)
  range.setStartAfter(node)
  range.setEndAfter(node)
  sel.removeAllRanges()
  sel.addRange(range)
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DescriptionEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  ticketId,
  readOnly,
  onClick,
  minHeight = '140px',
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null)

  // lightbox is the ONLY React state — no state for empty/content (avoids re-renders that reset contenteditable)
  const [lightbox, setLightbox] = useState<string | null>(null)

  // Refs for async paste stability
  const isPasting = useRef(false)   // blocks onInput during paste
  const isUploading = useRef(false) // blocks onBlur during upload
  const pendingBlur = useRef(false) // deferred blur request

  // Always-fresh ref so useLayoutEffect never reads a stale closure value
  const initValueRef = useRef(value)
  initValueRef.current = value

  // ── Init: on mount and when ticketId changes (parent uses key-based remount on mode switch) ──
  useLayoutEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = markdownToHtml(initValueRef.current)
    el.dataset.empty = initValueRef.current ? 'false' : 'true'
  }, [ticketId]) // re-run only on ticket change; mode switch is handled by key remount in parent

  // ── Sync DOM → markdown: updates data-empty via DOM, NOT via setState ──
  const syncMarkdown = () => {
    const el = editorRef.current
    if (!el) return
    const md = htmlToMarkdown(el)
    el.dataset.empty = md ? 'false' : 'true'
    onChange(md)
  }

  // ── onInput: fired by user typing ──
  const handleInput = () => {
    if (isPasting.current) return
    syncMarkdown()
  }

  // ── onBlur: defer if upload is in progress ──
  const handleBlur = () => {
    if (isUploading.current) {
      pendingBlur.current = true
      return
    }
    onBlur?.()
  }

  // ── Paste: handle images, let text paste through normally ──
  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith('image/')
    )
    if (!imageItem) return // normal text paste — let browser handle it

    e.preventDefault()
    const file = imageItem.getAsFile()
    if (!file || isUploading.current) return

    isPasting.current = true
    isUploading.current = true

    // Capture element ref before async (component might unmount)
    const editorEl = editorRef.current

    // Insert loading placeholder at cursor
    const loadingEl = document.createElement('span')
    loadingEl.textContent = ' [yükleniyor…] '
    loadingEl.style.cssText = 'color:#3b82f6;font-size:13px;font-style:italic;'
    loadingEl.dataset.loading = 'true'
    insertNodeAtCursor(loadingEl)

    try {
      const url = await uploadPastedImage(file, ticketId)

      const img = document.createElement('img')
      img.src = url
      img.alt = 'resim'
      img.style.cssText = IMG_STYLE

      const ph = editorEl?.querySelector('[data-loading="true"]')
      if (ph) ph.replaceWith(img)

      if (editorRef.current) {
        syncMarkdown()
      } else if (editorEl) {
        onChange(htmlToMarkdown(editorEl))
      }
    } catch {
      editorEl?.querySelector('[data-loading="true"]')?.remove()
      if (editorRef.current) syncMarkdown()
    } finally {
      isPasting.current = false
      isUploading.current = false
      if (pendingBlur.current) {
        pendingBlur.current = false
        onBlur?.()
      }
    }
  }

  // ── Image click → lightbox ──
  const handleImgClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG') {
      e.preventDefault()
      setLightbox((target as HTMLImageElement).src)
    }
  }

  // ── ReadOnly mode ─────────────────────────────────────────────────────────
  if (readOnly) {
    return (
      <>
        <div
          onClick={onClick}
          className={`text-sm text-gray-700 dark:text-gray-300 min-h-[60px] rounded-lg px-3 py-2 leading-relaxed
            ${onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800' : ''}
            ${!value ? 'text-gray-400 dark:text-gray-500 italic' : ''}`}
        >
          {value ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown
                components={{
                  img: ({ src, alt }) => (
                    <img
                      src={src}
                      alt={alt}
                      className="max-h-48 max-w-full rounded-lg my-1 object-contain cursor-zoom-in hover:opacity-90 inline-block align-middle"
                      style={{ border: '1px solid rgba(128,128,128,0.25)' }}
                      onClick={(e) => { e.stopPropagation(); if (src) setLightbox(src) }}
                    />
                  ),
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {children}
                    </a>
                  ),
                }}
              >
                {value}
              </ReactMarkdown>
            </div>
          ) : (
            placeholder ?? 'Açıklama yok'
          )}
        </div>
        {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      </>
    )
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  return (
    <>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-empty={value ? 'false' : 'true'}
        data-placeholder={placeholder ?? 'Açıklama yazın… (Ctrl+V ile ekran görüntüsü ekleyebilirsiniz)'}
        onInput={handleInput}
        onPaste={handlePaste}
        onBlur={handleBlur}
        onClick={handleImgClick}
        className="w-full border border-blue-300 dark:border-blue-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 overflow-auto text-gray-900 dark:text-gray-100"
        style={{ minHeight, lineHeight: '1.7', wordBreak: 'break-word', backgroundColor: 'inherit' }}
      />
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
        Ctrl+V ile ekran görüntüsü · Resimlere tıklayarak büyütebilirsiniz
      </p>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}
