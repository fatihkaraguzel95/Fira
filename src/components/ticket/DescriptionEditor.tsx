import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-6"
      onClick={onClose}
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

// ─── Toolbar Button ────────────────────────────────────────────────────────────
function ToolbarBtn({
  label, title, active, onMouseDown,
}: { label: React.ReactNode; title: string; active?: boolean; onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      className={`min-w-[28px] h-7 px-1.5 flex items-center justify-center rounded text-xs font-bold transition-colors select-none ${
        active
          ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
      }`}
    >
      {label}
    </button>
  )
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
  minHeight = '160px',
}: Props) {
  const [lightbox, setLightbox] = useState<string | null>(null)
  const uploading = useRef(false)
  const pendingBlur = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { HTMLAttributes: { class: 'list-disc pl-5' } },
        orderedList: { HTMLAttributes: { class: 'list-decimal pl-5' } },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      TaskList.configure({ HTMLAttributes: { class: 'tiptap-task-list not-prose pl-0' } }),
      TaskItem.configure({ nested: true, HTMLAttributes: { class: 'tiptap-task-item' } }),
      Placeholder.configure({ placeholder: placeholder ?? 'Açıklama yazın…' }),
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: value,
    editable: true,
    onUpdate({ editor }) {
      const md = editor.storage.markdown.getMarkdown()
      onChange(md)
    },
    onBlur() {
      if (uploading.current) { pendingBlur.current = true; return }
      onBlur?.()
    },
    editorProps: {
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items ?? [])
        const imageItem = items.find(i => i.type.startsWith('image/'))
        if (!imageItem) return false
        event.preventDefault()
        const file = imageItem.getAsFile()
        if (!file || uploading.current) return true
        uploading.current = true
        uploadPastedImage(file, ticketId)
          .then(url => {
            const { state } = view
            const node = state.schema.nodes.image.create({ src: url, alt: 'resim' })
            const tr = state.tr.replaceSelectionWith(node)
            view.dispatch(tr)
          })
          .catch(() => {})
          .finally(() => {
            uploading.current = false
            if (pendingBlur.current) {
              pendingBlur.current = false
              onBlur?.()
            }
          })
        return true
      },
    },
  })

  // Sync editor content when value prop changes (e.g. ticket loads after editor mounts)
  useEffect(() => {
    if (!editor) return
    const current = editor.storage.markdown.getMarkdown()
    if (current !== value) {
      editor.commands.setContent(value, false)
    }
  }, [editor, value])

  // ── ReadOnly mode ────────────────────────────────────────────────────────────
  if (readOnly) {
    return (
      <>
        <div
          onClick={onClick}
          style={{ minHeight }}
          className={[
            'text-sm rounded-lg px-3 py-2.5 leading-relaxed',
            onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors' : '',
            !value ? 'text-gray-400 dark:text-gray-500 italic' : 'text-gray-800 dark:text-gray-200',
          ].join(' ')}
        >
          {value ? (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-p:leading-relaxed prose-pre:bg-gray-100 prose-pre:dark:bg-gray-800">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ src, alt }) => (
                    <img
                      src={src}
                      alt={alt}
                      className="max-h-52 max-w-full rounded-lg my-1 object-contain cursor-zoom-in hover:opacity-90 inline-block align-middle border border-gray-200 dark:border-gray-700"
                      onClick={(e) => { e.stopPropagation(); if (src) setLightbox(src) }}
                    />
                  ),
                  p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {children}
                    </a>
                  ),
                  input: ({ checked }) => (
                    <input type="checkbox" checked={checked} readOnly className="mr-1.5 accent-blue-500" />
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

  // ── Edit mode (TipTap) ────────────────────────────────────────────────────────
  return (
    <>
      <div className="border border-blue-300 dark:border-blue-700 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-blue-400">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-2 py-1 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 flex-wrap">
          <ToolbarBtn
            label={<strong>B</strong>}
            title="Kalın (Ctrl+B)"
            active={editor?.isActive('bold')}
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }}
          />
          <ToolbarBtn
            label={<em>I</em>}
            title="İtalik (Ctrl+I)"
            active={editor?.isActive('italic')}
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }}
          />
          <ToolbarBtn
            label={<s>S</s>}
            title="Üstü çizili"
            active={editor?.isActive('strike')}
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleStrike().run() }}
          />
          <ToolbarBtn
            label={<code className="font-mono text-xs">`</code>}
            title="Kod (Ctrl+`)"
            active={editor?.isActive('code')}
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleCode().run() }}
          />
          <div className="w-px h-4 bg-gray-200 dark:bg-gray-600 mx-1 flex-shrink-0" />
          <ToolbarBtn
            label={
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            }
            title="Madde işaretli liste"
            active={editor?.isActive('bulletList')}
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run() }}
          />
          <ToolbarBtn
            label={
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            }
            title="Görev listesi (checkbox)"
            active={editor?.isActive('taskList')}
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleTaskList().run() }}
          />
          <div className="w-px h-4 bg-gray-200 dark:bg-gray-600 mx-1 flex-shrink-0" />
          <span className="text-xs text-gray-400 dark:text-gray-500 select-none px-1">
            Ctrl+V ile görüntü yapıştır
          </span>
        </div>

        {/* Editor */}
        <EditorContent
          editor={editor}
          className="tiptap-editor"
          style={{ minHeight }}
        />
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}
