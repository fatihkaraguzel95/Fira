import { useEffect, useRef, useState } from 'react'
import { useAvatarColor } from '../../lib/avatarTone'
import { displayUrl } from '../../lib/storage'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../types'
import { resizeImage, formatBytes } from '../../lib/image'
import { useT } from '../../i18n'
import { useImageOk } from '../../hooks/useImageOk'

/** Account details: avatar, name, password, and signing out everywhere. */
export function ProfileSettings({ onUpdated }: { onUpdated: (p: Profile) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [fullName, setFullName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFullUrl, setAvatarFullUrl] = useState<string | null>(null)
  const [sizeHint, setSizeHint] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photo = useImageOk(avatarUrl)
  const tone = useAvatarColor(profile?.id)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [changingPw, setChangingPw] = useState(false)
  const [signingOutAll, setSigningOutAll] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      if (data) {
        setProfile(data as Profile)
        setFullName(data.full_name ?? '')
        setAvatarUrl(data.avatar_url ?? null)
        setAvatarFullUrl((data as Profile).avatar_full_url ?? null)
      }
    }
    load()
  }, [])

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !profile) return
    setUploading(true)
    setError(null)
    try {
      if (!file.type.startsWith('image/')) throw new Error(t('settings.profile.pickImage'))
      // Never store the original: a small square WebP for the UI and a bounded copy for the detail view.
      const [small, full] = await Promise.all([
        resizeImage(file, { max: 256, square: true, quality: 0.85 }),
        resizeImage(file, { max: 1024, quality: 0.85 }),
      ])
      const bucket = supabase.storage.from('ticket-attachments')
      const smallPath = `avatars/${profile.id}/avatar.webp`
      const fullPath = `avatars/${profile.id}/avatar-full.webp`
      const opts = { upsert: true, contentType: 'image/webp', cacheControl: '31536000' }
      const [{ error: e1 }, { error: e2 }] = await Promise.all([bucket.upload(smallPath, small, opts), bucket.upload(fullPath, full, opts)])
      if (e1) throw e1
      if (e2) throw e2
      const stamp = Date.now()
      setAvatarUrl(`${bucket.getPublicUrl(smallPath).data.publicUrl}?t=${stamp}`)
      setAvatarFullUrl(`${bucket.getPublicUrl(fullPath).data.publicUrl}?t=${stamp}`)
      setSizeHint(t('settings.profile.sizeHint', { from: formatBytes(file.size), small: formatBytes(small.size), full: formatBytes(full.size) }))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('settings.profile.uploadError'))
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const updates: Partial<Profile> = { full_name: fullName.trim() || null, avatar_url: avatarUrl, avatar_full_url: avatarFullUrl }
      const { data: updateResult, error: updateError } = await supabase.from('profiles').update(updates).eq('id', profile.id).select()
      if (updateError) throw updateError
      if (!updateResult || updateResult.length === 0) throw new Error(t('settings.profile.updateFailed'))
      onUpdated({ ...profile, ...updates } as Profile)
      qc.invalidateQueries({ queryKey: ['tickets'] })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('settings.profile.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setPwError(null)
    setPwSuccess(false)
    if (!newPassword) { setPwError(t('settings.profile.pwEmpty')); return }
    if (newPassword !== confirmPassword) { setPwError(t('settings.profile.pwMismatch')); return }
    if (newPassword.length < 6) { setPwError(t('settings.profile.pwTooShort')); return }
    setChangingPw(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPwSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : t('settings.profile.pwError'))
    } finally {
      setChangingPw(false)
    }
  }

  const initials = fullName.trim()
    ? fullName.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : profile?.email?.[0]?.toUpperCase() ?? '?'

  const input = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-field text-fg focus:outline-none focus:ring-2 focus:ring-primary-500'
  const label = 'block text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1.5'

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-fg">{t('settings.profile.title')}</h3>
        <div className="flex items-center gap-4">
          <div className="relative">
            {photo.ok ? (
              <img src={displayUrl(avatarUrl) ?? ''} alt="" onError={photo.onError} className="w-16 h-16 rounded-full object-cover ring-2 ring-line" />
            ) : (
              <div style={{ backgroundColor: tone }} className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold">
                {initials}
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50">
                {t('settings.profile.uploadPhoto')}
              </button>
              {avatarFullUrl && (
                <a href={avatarFullUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-fg-muted hover:text-fg-2">{t('settings.profile.openFull')}</a>
              )}
            </div>
            <p className="text-xs text-fg-faint mt-0.5">{sizeHint ?? t('settings.profile.photoHint')}</p>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>{t('settings.profile.fullName')}</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('settings.profile.namePlaceholder')} className={input} />
          </div>
          <div>
            <label className={label}>{t('settings.profile.email')}</label>
            <input value={profile?.email ?? ''} readOnly disabled className={`${input} opacity-70 cursor-not-allowed`} />
          </div>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
            {saving ? t('common.saving') : t('common.save')}
          </button>
          {saved && <span className="text-xs text-success">{t('common.saved')}</span>}
        </div>
      </section>

      <section className="border-t border-line-soft pt-5 space-y-3">
        <h3 className="text-sm font-semibold text-fg">{t('settings.profile.password')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('settings.profile.newPassword')} className={input} />
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t('settings.profile.newPasswordAgain')} className={input} />
        </div>
        {pwError && <p className="text-xs text-danger">{pwError}</p>}
        {pwSuccess && <p className="text-xs text-success">{t('settings.profile.pwChanged')}</p>}
        <button onClick={handleChangePassword} disabled={changingPw} className="border border-line text-fg-2 px-4 py-2 rounded-lg text-sm font-medium hover:bg-raised disabled:opacity-50">
          {changingPw ? t('settings.profile.changing') : t('settings.profile.changePassword')}
        </button>
      </section>

      <section className="border-t border-line-soft pt-5 space-y-2">
        <h3 className="text-sm font-semibold text-fg">{t('settings.sessions.title')}</h3>
        <p className="text-xs text-fg-muted">{t('settings.sessions.hint')}</p>
        <button
          onClick={async () => { setSigningOutAll(true); await supabase.auth.signOut({ scope: 'global' }); window.location.assign('/login') }}
          disabled={signingOutAll}
          className="border border-line text-danger px-4 py-2 rounded-lg text-sm font-medium hover:bg-danger/10 disabled:opacity-50"
        >
          {signingOutAll ? t('settings.sessions.signingOut') : t('settings.sessions.signOutAll')}
        </button>
      </section>
    </div>
  )
}
