import { useEffect, useState } from 'react'
import { Icon } from '../components/ui/Icon'
import { useNavigate, useParams } from 'react-router-dom'
import { useAcceptInvitation, useInvitationPreview } from '../hooks/useTeams'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS } from '../types'
import { useT } from '../i18n'

/** /invite/:token — shows which team/role the link grants, then joins on confirm. */
export function InvitePage() {
  const t = useT()
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const { data: preview, isLoading: previewLoading } = useInvitationPreview(token)
  const accept = useAcceptInvitation()
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!session) {
      sessionStorage.setItem('pendingInviteToken', token ?? '')
      navigate('/login')
    }
  }, [session, loading, token, navigate])

  const handleAccept = async () => {
    setError(null)
    try {
      const team = await accept.mutateAsync(token ?? '')
      setDone(team.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.invite.failed'))
    }
  }

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex items-center justify-center bg-app px-4">
      <div className="bg-surface border border-line rounded-xl shadow-2xl p-8 w-full max-w-sm text-center">{children}</div>
    </div>
  )

  if (loading || !session || previewLoading) {
    return (
      <Card>
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary-600 border-t-transparent mx-auto mb-4" />
        <p className="text-fg-muted text-sm">{t('auth.invite.checking')}</p>
      </Card>
    )
  }

  if (done) {
    return (
      <Card>
        <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
          <Icon name="check" size={28} className="text-success" />
        </div>
        <h2 className="text-xl font-bold text-fg mb-2">{t('auth.invite.joined')}</h2>
        <p className="text-fg-muted text-sm mb-6">{t('auth.invite.joinedBefore')}<span className="font-semibold text-fg">{done}</span>{t('auth.invite.joinedAfter')}</p>
        <button onClick={() => navigate('/', { replace: true })} className="bg-primary-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-primary-700 text-sm">{t('auth.invite.toBoard')}</button>
      </Card>
    )
  }

  if (!preview || !preview.valid) {
    return (
      <Card>
        <div className="w-14 h-14 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-4">
          <Icon name="close" size={28} className="text-danger" />
        </div>
        <h2 className="text-xl font-bold text-fg mb-2">{t('auth.invite.invalid')}</h2>
        <p className="text-fg-muted text-sm mb-6">{t('auth.invite.invalidBody')}</p>
        <button onClick={() => navigate('/', { replace: true })} className="text-primary-600 underline text-sm">{t('auth.invite.home')}</button>
      </Card>
    )
  }

  return (
    <Card>
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mx-auto mb-4 shadow-sm">
        <span className="text-white text-xl font-bold">{preview.team_name.charAt(0).toUpperCase()}</span>
      </div>
      <h2 className="text-xl font-bold text-fg mb-1">{preview.team_name}</h2>
      <p className="text-fg-muted text-sm mb-6">{t('auth.invite.roleBefore')}<span className="font-semibold text-fg">{t(ROLE_LABELS[preview.role])}</span>{t('auth.invite.roleAfter')}</p>
      {error && <p className="text-danger text-sm mb-4">{error}</p>}
      <div className="flex gap-3">
        <button onClick={() => navigate('/', { replace: true })} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-line text-fg-2 hover:bg-raised">{t('common.giveUp')}</button>
        <button onClick={handleAccept} disabled={accept.isPending} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
          {accept.isPending ? t('auth.invite.joining') : t('auth.invite.join')}
        </button>
      </div>
    </Card>
  )
}
