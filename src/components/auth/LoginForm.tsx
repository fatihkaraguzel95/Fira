import { useState, FormEvent } from 'react'
import { Icon } from '../ui/Icon'
import { useAuth } from '../../hooks/useAuth'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AuthLayout, EyeIcon, authInput, authLabel, authPrimary, eyeButton } from './AuthLayout'
import { useT, type TranslationKey } from '../../i18n'

interface LoginFormProps {
  changeMode: boolean
  onChangeModeToggle: (value: boolean) => void
}

/**
 * Google sign-in needs GoTrue configured with a Google client (see the
 * "Google ile giriş" ticket) — until then the button would only produce an
 * error, so it is behind a build flag. Set VITE_GOOGLE_LOGIN=1 once the
 * provider is enabled on the server.
 */
const GOOGLE_LOGIN = import.meta.env.VITE_GOOGLE_LOGIN === '1'

/** GoTrue's own wording mapped to a key we can show in the reader's language.
 *  Anything unrecognised is left exactly as the server sent it. */
function errorKey(msg: string): TranslationKey | null {
  if (msg.includes('Invalid login credentials')) return 'auth.error.invalidCredentials'
  if (msg.includes('Email not confirmed')) return 'auth.error.emailNotConfirmed'
  if (msg.includes('Too many requests')) return 'auth.error.tooManyRequests'
  if (msg.includes('User not found')) return 'auth.error.userNotFound'
  return null
}

export function LoginForm({ changeMode, onChangeModeToggle }: LoginFormProps) {
  const t = useT()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [changeEmail, setChangeEmail] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [changed, setChanged] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('auth.error.signInFailed')
      const key = errorKey(msg)
      setError(key ? t(key) : msg)
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 6) {
      setError(t('auth.error.passwordMin'))
      return
    }
    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: changeEmail, password: oldPassword })
    if (signInError) {
      setError(t('auth.error.oldPasswordWrong'))
      setLoading(false)
      return
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }
    await supabase.auth.signOut()
    setLoading(false)
    setChanged(true)
  }

  const handleGoogle = async () => {
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  const errorBox = error && (
    <div className="bg-danger/10 border border-danger/30 rounded-xl px-3.5 py-3">
      <p className="text-danger text-sm">{error}</p>
    </div>
  )

  // ── Change password mode ───────────────────────────────────────────────────
  if (changeMode) {
    const leave = () => { onChangeModeToggle(false); setChanged(false); setError(''); setOldPassword(''); setNewPassword(''); setChangeEmail('') }
    return (
      <AuthLayout title={t('auth.changePassword.title')} subtitle={t('auth.changePassword.subtitle')}>
        {changed ? (
          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
              <Icon name="check" size={28} className="text-success" />
            </div>
            <p className="text-fg-2 text-sm font-medium mb-5">{t('auth.changePassword.done')}</p>
            <button onClick={leave} className={authPrimary}>{t('auth.signIn')}</button>
          </div>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className={authLabel}>{t('auth.email')}</label>
              <input type="email" value={changeEmail} onChange={(e) => setChangeEmail(e.target.value)} required autoFocus autoComplete="email" className={authInput} placeholder={t('auth.emailPlaceholder')} />
            </div>
            <div>
              <label className={authLabel}>{t('auth.oldPassword')}</label>
              <div className="relative">
                <input type={showOldPassword ? 'text' : 'password'} value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required autoComplete="current-password" className={`${authInput} pr-10`} placeholder="••••••••" />
                <button type="button" onClick={() => setShowOldPassword(!showOldPassword)} className={eyeButton} aria-label={t('auth.togglePassword')}><EyeIcon open={showOldPassword} /></button>
              </div>
            </div>
            <div>
              <label className={authLabel}>{t('auth.newPassword')}</label>
              <div className="relative">
                <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} autoComplete="new-password" className={`${authInput} pr-10`} placeholder={t('auth.minChars')} />
                <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className={eyeButton} aria-label={t('auth.togglePassword')}><EyeIcon open={showNewPassword} /></button>
              </div>
            </div>
            {errorBox}
            <button type="submit" disabled={loading} className={authPrimary}>
              {loading ? t('auth.updating') : t('auth.updatePassword')}
            </button>
            <button type="button" onClick={leave} className="w-full text-sm text-fg-muted hover:text-fg-2 py-2 transition-colors">
              ← {t('auth.backToSignIn')}
            </button>
          </form>
        )}
      </AuthLayout>
    )
  }

  // ── Sign in ────────────────────────────────────────────────────────────────
  return (
    <AuthLayout
      title={t('auth.welcomeBack')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="text-primary-600 dark:text-primary-400 font-semibold hover:underline">{t('auth.register')}</Link>
        </>
      }
    >
      {GOOGLE_LOGIN && (
        <>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 border border-line rounded-xl px-4 py-3 text-sm font-medium text-fg-2 hover:bg-raised disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.5 2.7 13.5l7.8 6.1C12.4 13.4 17.7 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/>
              <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.8-6.1z"/>
              <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.7 2.3-7.7 2.3-6.3 0-11.6-4-13.5-9.4l-7.8 6.1C6.6 42.5 14.6 48 24 48z"/>
            </svg>
            {t('auth.googleSignIn')}
          </button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-line" /></div>
            <div className="relative flex justify-center"><span className="text-xs text-fg-faint bg-surface px-3">{t('auth.orEmail')}</span></div>
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={authLabel}>{t('auth.email')}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" className={authInput} placeholder={t('auth.emailPlaceholder')} />
        </div>

        <div>
          <label className={authLabel}>{t('auth.password')}</label>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className={`${authInput} pr-10`} placeholder="••••••••" />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className={eyeButton} aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}>
              <EyeIcon open={showPassword} />
            </button>
          </div>
        </div>

        {errorBox}

        <button type="submit" disabled={loading} className={authPrimary}>
          {loading ? t('auth.signingIn') : t('auth.signIn')}
        </button>

        {/* Comes AFTER the submit button in tab order: e-mail → password → sign in → this link */}
        <button
          type="button"
          onClick={() => { onChangeModeToggle(true); setChangeEmail(email); setError('') }}
          className="w-full text-center text-xs text-fg-muted hover:text-primary-600 dark:hover:text-primary-400 font-medium hover:underline py-1"
        >
          {t('auth.changeMyPassword')}
        </button>
      </form>
    </AuthLayout>
  )
}
