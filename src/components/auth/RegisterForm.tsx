import { useState, FormEvent } from 'react'
import { Icon } from '../ui/Icon'
import { useAuth } from '../../hooks/useAuth'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AuthLayout, EyeIcon, authInput, authLabel, authPrimary, eyeButton } from './AuthLayout'
import { useT, type TranslationKey } from '../../i18n'

/** GoTrue's own wording mapped to a key we can show in the reader's language.
 *  Anything unrecognised is left exactly as the server sent it. */
function errorKey(msg: string): TranslationKey | null {
  if (msg.includes('User already registered') || msg.includes('already been registered'))
    return 'auth.error.alreadyRegistered'
  if (msg.includes('Password should be at least'))
    return 'auth.error.passwordTooShort'
  if (msg.includes('Unable to validate email'))
    return 'auth.error.invalidEmail'
  if (msg.includes('Signup is disabled'))
    return 'auth.error.signupDisabled'
  if (msg.includes('rate limit') || msg.includes('Too many') || msg.includes('over_email_send_rate_limit'))
    return 'auth.error.emailRateLimit'
  return null
}

export function RegisterForm() {
  const t = useT()
  const { signUp } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signUp(email, password, fullName)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        window.location.href = '/'
      } else {
        setSuccess(true)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('auth.error.signUpFailed')
      const key = errorKey(msg)
      setError(key ? t(key) : msg)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthLayout title={t('auth.registerDone.title')} subtitle={t('auth.registerDone.subtitle')}>
        <div className="text-center py-2">
          <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
            <Icon name="check" size={28} className="text-success" />
          </div>
          <p className="text-fg-muted text-sm mb-1">
            {t('auth.registerDone.sentBefore')}
            <span className="font-semibold text-fg-2">{email}</span>
            {t('auth.registerDone.sentAfter')}
          </p>
          <p className="text-fg-faint text-xs mb-6">
            {t('auth.registerDone.hint')}
          </p>
          <Link to="/login" className="inline-block bg-primary-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-primary-700 transition-colors text-sm">
            {t('auth.signIn')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('auth.join.title')}
      subtitle={t('auth.join.subtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="text-primary-600 dark:text-primary-400 font-semibold hover:underline">{t('auth.signIn')}</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={authLabel}>{t('auth.fullName')}</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            autoFocus
            autoComplete="name"
            className={authInput}
            placeholder={t('auth.fullNamePlaceholder')}
          />
        </div>

        <div>
          <label className={authLabel}>{t('auth.email')}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className={authInput}
            placeholder={t('auth.emailPlaceholder')}
          />
        </div>

        <div>
          <label className={authLabel}>{t('auth.password')}</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className={`${authInput} pr-10`}
              placeholder={t('auth.minChars')}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className={eyeButton} aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}>
              <EyeIcon open={showPassword} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-xl px-3.5 py-3">
            <p className="text-danger text-sm">{error}</p>
          </div>
        )}

        <button type="submit" disabled={loading} className={`${authPrimary} mt-2`}>
          {loading ? t('auth.registering') : t('auth.createAccount')}
        </button>

        <p className="text-xs text-fg-faint text-center">
          {t('auth.inviteHint')}
        </p>
      </form>
    </AuthLayout>
  )
}
