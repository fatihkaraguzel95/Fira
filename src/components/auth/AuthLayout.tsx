import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { FiraMark, FiraWordmark } from '../ui/Logo'
import { ServerReachBanner } from '../layout/ServerReachBanner'
import { useT } from '../../i18n'

/**
 * The frame every signed-out screen shares: the brand panel on the left,
 * the form on the right (stacked on phones). Login, register and the
 * password-change mode all use it, so they age together from now on.
 */
export function AuthLayout({ title, subtitle, children, footer }: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const t = useT()
  return (
    <div data-wco-pad className="min-h-screen flex bg-app">
      {/* Brand panel — hidden on mobile */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-900 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-72 h-72 bg-white/5 rounded-full -translate-y-1/3 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-white/5 rounded-full translate-y-1/3 -translate-x-1/3" />
        <div className="absolute top-1/2 left-1/2 w-48 h-48 bg-white/5 rounded-full -translate-x-1/2 -translate-y-1/2" />

        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-white/95 shadow-sm flex items-center justify-center">
            <FiraMark size={26} />
          </div>
          <FiraWordmark className="text-white text-2xl" />
        </div>

        <div className="relative z-10">
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            {t('auth.brand.headlineTop')}<br />{t('auth.brand.headlineBottom')}
          </h2>
          <p className="text-primary-200 text-base leading-relaxed mb-8">
            {t('auth.brand.subtitle')}
          </p>
          <ul className="space-y-3.5">
            {[
              t('auth.brand.feature1'),
              t('auth.brand.feature2'),
              t('auth.brand.feature3'),
              t('auth.brand.feature4'),
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon name="check" size={12} className="text-white" />
                </div>
                <span className="text-primary-100 text-sm leading-relaxed">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-primary-300 text-xs">{t('auth.brand.tagline')}</p>
      </div>

      {/* Form panel — sayfanın ana bölgesi; başlık h1 (yalnız telefonda görünen marka h1 değil). */}
      <main className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-[#0B1020] shadow-sm mb-3">
              <FiraMark size={34} />
            </div>
            <p className="text-2xl text-fg"><FiraWordmark /></p>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-fg">{title}</h1>
            {subtitle && <p className="text-fg-muted mt-1 text-sm">{subtitle}</p>}
          </div>

          {/* Sunucuya ulaşılamıyorsa girişi denemeden önce söylenir (#b9e1bb66). */}
          <ServerReachBanner />

          <div className="bg-surface rounded-xl border border-line shadow-sm p-6 space-y-4">
            {children}
          </div>

          {footer && <div className="text-center text-sm text-fg-muted mt-5">{footer}</div>}
        </div>
      </main>
    </div>
  )
}

/** The eye toggle used next to password fields. */
export function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <Icon name="eyeOff" />
  ) : (
    <Icon name="eye" />
  )
}

export const authInput = 'w-full border border-line rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-field text-fg placeholder-fg-faint transition-shadow'
export const authLabel = 'block text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1.5'
export const authPrimary = 'w-full bg-primary-600 text-white py-3 rounded-xl font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm text-sm'
export const eyeButton = 'absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg-2 transition-colors'
