import { FormEvent, useState } from 'react'
import { useComments, useAddComment, useDeleteComment } from '../../hooks/useComments'
import { useAuth } from '../../hooks/useAuth'
import { UserAvatar } from './UserAvatar'

interface Props {
  ticketId: string
}

export function CommentSection({ ticketId }: Props) {
  const { user } = useAuth()
  const { data: comments, isLoading } = useComments(ticketId)
  const addComment = useAddComment()
  const deleteComment = useDeleteComment()
  const [content, setContent] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    await addComment.mutateAsync({ ticketId, content: content.trim() })
    setContent('')
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-3">Yorumlar</h4>

      {isLoading ? (
        <p className="text-xs text-gray-400">Yükleniyor...</p>
      ) : (
        <div className="space-y-3 mb-4">
          {comments?.map((comment) => (
            <div key={comment.id} className="flex gap-3 group">
              <UserAvatar user={comment.author} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-700">
                    {comment.author?.full_name || comment.author?.email || 'Bilinmiyor'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(comment.created_at).toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 break-words">
                  {comment.content}
                </p>
              </div>

              {user?.id === comment.author_id && (
                <button
                  onClick={() => deleteComment.mutate({ id: comment.id, ticketId })}
                  className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 transition-all self-start mt-1"
                >
                  Sil
                </button>
              )}
            </div>
          ))}

          {!comments?.length && (
            <p className="text-xs text-gray-400">Henüz yorum yok</p>
          )}
        </div>
      )}

      {/* Add comment */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Yorum ekle..."
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!content.trim() || addComment.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          Gönder
        </button>
      </form>
    </div>
  )
}
