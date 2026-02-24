import { useRef, DragEvent, useState } from 'react'
import { useAttachments, useUpload, useDeleteAttachment } from '../../hooks/useUpload'
import { useAuth } from '../../hooks/useAuth'

interface Props {
  ticketId: string
}

export function AttachmentUpload({ ticketId }: Props) {
  const { user } = useAuth()
  const { data: attachments, isLoading } = useAttachments(ticketId)
  const upload = useUpload()
  const deleteAttachment = useDeleteAttachment()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      await upload.mutateAsync({ file, ticketId })
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const isImage = (url: string) => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-3">Dosyalar</h4>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {upload.isPending ? (
          <p className="text-sm text-blue-500">Yükleniyor...</p>
        ) : (
          <p className="text-sm text-gray-400">
            Dosya sürükleyin veya <span className="text-blue-500 font-medium">tıklayın</span>
          </p>
        )}
      </div>

      {/* Attachment list */}
      {isLoading ? (
        <div className="mt-3 text-xs text-gray-400">Yükleniyor...</div>
      ) : attachments && attachments.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="group relative border border-gray-200 rounded-lg overflow-hidden">
              {isImage(att.file_url) ? (
                <a href={att.file_url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={att.file_url}
                    alt={att.file_name}
                    className="w-full h-24 object-cover"
                  />
                </a>
              ) : (
                <a
                  href={att.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-3"
                >
                  <span className="text-2xl">📎</span>
                  <span className="text-xs text-gray-600 truncate">{att.file_name}</span>
                </a>
              )}

              {/* Delete button (only for uploader) */}
              {user?.id === att.uploaded_by && (
                <button
                  onClick={() => deleteAttachment.mutate({ id: att.id, ticketId })}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs items-center justify-center hidden group-hover:flex"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-400">Henüz dosya yok</p>
      )}
    </div>
  )
}
