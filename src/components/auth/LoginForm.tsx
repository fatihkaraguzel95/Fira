import { useState, FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export function LoginForm() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const translateError = (msg: string): string => {
    if (msg.includes('Invalid login credentials')) return 'E-posta veya şifre hatalı.'
    if (msg.includes('Email not confirmed')) return 'E-postanız henüz doğrulanmamış. Lütfen gelen kutunuzu kontrol edin ve doğrulama linkine tıklayın.'
    if (msg.includes('Too many requests')) return 'Çok fazla deneme yapıldı. Lütfen birkaç dakika bekleyin.'
    if (msg.includes('User not found')) return 'Bu e-posta ile kayıtlı hesap bulunamadı.'
    return msg
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Giriş başarısız'
      setError(translateError(msg))
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault()
    setForgotLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setForgotLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setForgotSent(true)
    }
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

  if (forgotMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-blue-600">Fira</h1>
            <p className="text-gray-500 mt-1 text-sm">Şifre Sıfırlama</p>
          </div>

          {forgotSent ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-gray-700 text-sm font-medium mb-1">E-posta gönderildi</p>
              <p className="text-gray-400 text-xs mb-6">
                <span className="font-medium text-gray-600">{forgotEmail}</span> adresine şifre sıfırlama linki gönderildi. Spam klasörünü de kontrol edin.
              </p>
              <button
                onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail('') }}
                className="text-blue-600 text-sm font-medium hover:underline"
              >
                Giriş ekranına dön
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgot} className="space-y-4">
              <p className="text-sm text-gray-500">Kayıtlı e-posta adresinizi girin, şifre sıfırlama linki gönderelim.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-posta</label>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="ad@sirket.com"
                />
              </div>
              {error && (
                <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {forgotLoading ? 'Gönderiliyor...' : 'Sıfırlama Linki Gönder'}
              </button>
              <button
                type="button"
                onClick={() => { setForgotMode(false); setError('') }}
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                Geri dön
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-600">Fira</h1>
          <p className="text-gray-500 mt-1 text-sm">Ticket Yönetim Sistemi</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              E-posta
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="ad@sirket.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Şifre</label>
              <button
                type="button"
                onClick={() => { setForgotMode(true); setForgotEmail(email); setError('') }}
                className="text-xs text-blue-600 hover:underline"
              >
                Şifremi unuttum
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs text-gray-400 bg-white px-2 w-fit mx-auto">
            veya
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.5 2.7 13.5l7.8 6.1C12.4 13.4 17.7 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/>
            <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.8-6.1z"/>
            <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.7 2.3-7.7 2.3-6.3 0-11.6-4-13.5-9.4l-7.8 6.1C6.6 42.5 14.6 48 24 48z"/>
          </svg>
          Google ile Giriş Yap
        </button>

        <p className="text-center text-sm text-gray-500 mt-4">
          Hesabın yok mu?{' '}
          <Link to="/register" className="text-blue-600 font-medium hover:underline">
            Kayıt Ol
          </Link>
        </p>
      </div>
    </div>
  )
}
