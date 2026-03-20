import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAcceptInvitation } from '../hooks/useTeams'
import { useAuth } from '../hooks/useAuth'

export function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const acceptInvitation = useAcceptInvitation()
  const [status, setStatus] = useState<'idle' | 'accepting' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (loading) return
    if (!session) {
      // Store token and redirect to login
      sessionStorage.setItem('pendingInviteToken', token ?? '')
      navigate('/login')
      return
    }
    if (status !== 'idle') return

    setStatus('accepting')
    acceptInvitation.mutateAsync(token ?? '')
      .then(() => setStatus('done'))
      .catch((e: Error) => { setErrorMsg(e.message); setStatus('error') })
  }, [session, loading, token])

  if (status === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h2 className="text-xl font-bold mb-2">Takıma Katıldın!</h2>
          <p className="text-gray-500 text-sm mb-6">Davet başarıyla kabul edildi.</p>
          <button
            onClick={() => navigate('/')}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700"
          >
            Panoya Git
          </button>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-red-500 text-5xl mb-4">✕</div>
          <h2 className="text-xl font-bold mb-2">Hata</h2>
          <p className="text-red-500 text-sm mb-6">{errorMsg}</p>
          <button onClick={() => navigate('/')} className="text-blue-600 underline text-sm">Ana sayfaya dön</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mx-auto mb-4" />
        <p className="text-gray-500 text-sm">Davet işleniyor...</p>
      </div>
    </div>
  )
}
