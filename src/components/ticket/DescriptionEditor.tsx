import { useRef, useState, ClipboardEvent } from 'react'
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
}

async function uploadPastedImage(file: File, ticketId: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Oturum bulunamadı')

  const timestamp = Date.now()
  const ext = file.type.split('/')[1] ?? 'png'
  const path = `${user.id}/${ticketId}/${timestamp}-paste.${ext}`

  const { error } = await supabase.storage.from('ticket-attachments').upload(path, file)
  if (error) throw error

  const { data: { publicUrl } } = supabase.storage.from('ticket-attachments').getPublicUrl(path)
  return publicUrl
}

export function DescriptionEditor({ value, onChange, onBlur, placeholder, ticketId, readOnly, onClick }: Props) {
  const [uploading, setUploading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Keep a ref to always-current value to avoid stale closure in async handlers
  const valueRef = useRef(value)
  valueRef.current = value

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const before = valueRef.current.substring(0, start)
    const after = valueRef.current.substring(end)
    const newVal = before + text + after
    onChange(newVal)
    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + text.length
      el.focus()
    })
  }

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find((item) => item.type.startsWith('image/'))

    if (!imageItem) return // normal text paste — let it happen naturally

    e.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return

    setUploading(true)
    insertAtCursor('\n![Yükleniyor...]()\n')
    try {
      const url = await uploadPastedImage(file, ticketId)
      // Use valueRef.current so we replace in the latest state (not stale closure)
      onChange(valueRef.current.replace('![Yükleniyor...]()', `![resim](${url})`))
    } catch {
      onChange(valueRef.current.replace('![Yükleniyor...]()', ''))
    } finally {
      setUploading(false)
    }
  }

  if (readOnly) {
    return (
      <div
        onClick={onClick}
        className={`text-sm text-gray-700 min-h-[60px] rounded-lg px-3 py-2 ${onClick ? 'cursor-pointer hover:bg-gray-50' : ''} ${!value ? 'text-gray-300 italic' : ''}`}
      >
        {value ? (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              components={{
                img: ({ src, alt }) => (
                  <img
                    src={src}
                    alt={alt}
                    className="max-w-full rounded-lg border border-gray-200 my-2 max-h-96 object-contain"
                  />
                ),
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>
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
    )
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onPaste={handlePaste}
        placeholder={placeholder ?? 'Açıklama yazın... (Markdown desteklenir, ekran görüntüsü yapıştırabilirsiniz)'}
        rows={6}
        className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
      />
      {uploading && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-lg">
          <span className="text-xs text-blue-600 animate-pulse">Resim yükleniyor...</span>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-1">
        Markdown desteklenir · Ekran görüntüsü için Ctrl+V / Cmd+V kullanın
      </p>
    </div>
  )
}
