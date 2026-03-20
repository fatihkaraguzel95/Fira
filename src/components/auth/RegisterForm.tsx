import { useState, FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function translateError(msg: string): string {
  if (msg.includes('User already registered') || msg.includes('already been registered'))
    return 'Bu e-posta adresi zaten kayıtlı. Giriş yapmayı deneyin.'
  if (msg.includes('Password should be at least'))
    return 'Şifre en az 6 karakter olmalıdır.'
  if (msg.includes('Unable to validate email'))
    return 'Geçersiz e-posta adresi.'
  if (msg.includes('Signup is disabled'))
    return 'Kayıt şu anda kapalı. Lütfen yöneticiye başvurun.'
  if (msg.includes('rate limit') || msg.includes('Too many') || msg.includes('over_email_send_rate_limit'))
    return 'E-posta gönderme limiti aşıldı. Lütfen birkaç dakika bekleyin.'
  return msg
}

export function RegisterForm() {
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
      const msg = err instanceof Error ? err.message : 'Kayıt başarısız'
      setError(translateError(msg))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gray-950 px-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-200/60 dark:border-gray-800 shadow-card-hover p-8 w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-gray-100 mb-2">Kayıt Başarılı!</h2>
          <p className="text-slate-500 dark:text-gray-400 text-sm mb-1">
            <span className="font-semibold text-slate-700 dark:text-gray-200">{email}</span> adresine doğrulama linki gönderildi.
          </p>
          <p className="text-slate-400 dark:text-gray-500 text-xs mb-6">
            E-postanızı doğruladıktan sonra giriş yapabilirsiniz. Spam klasörünü de kontrol edin.
          </p>
          <Link
            to="/login"
            className="inline-block bg-primary-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-primary-700 transition-colors text-sm"
          >
            Giriş Yap
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gray-950 px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm mb-4">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-gray-100">Fira'ya Katıl</h1>
          <p className="text-slate-500 dark:text-gray-400 mt-1 text-sm">Hesabını oluştur, projeye başla</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-200/60 dark:border-gray-800 shadow-card p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full name */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Ad Soyad
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
                className="w-full border border-slate-200 dark:border-gray-700 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-gray-200 placeholder-slate-400 dark:placeholder-gray-500 transition-shadow"
                placeholder="Adınız Soyadınız"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                E-posta
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-slate-200 dark:border-gray-700 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-gray-200 placeholder-slate-400 dark:placeholder-gray-500 transition-shadow"
                placeholder="ad@sirket.com"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Şifre
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full border border-slate-200 dark:border-gray-700 rounded-xl px-3.5 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-gray-200 placeholder-slate-400 dark:placeholder-gray-500 transition-shadow"
                  placeholder="En az 6 karakter"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-xl px-3.5 py-3">
                <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 text-white py-3 rounded-xl font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm text-sm mt-2"
            >
              {loading ? 'Kayıt olunuyor...' : 'Hesap Oluştur'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-500 dark:text-gray-400 mt-5">
          Zaten hesabın var mı?{' '}
          <Link to="/login" className="text-primary-600 font-semibold hover:text-primary-700 hover:underline">
            Giriş Yap
          </Link>
        </p>
      </div>
    </div>
  )
}
