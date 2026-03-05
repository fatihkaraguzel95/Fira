import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../types'

interface Props {
  onClose: () => void
  onUpdated: (profile: Profile) => void
}

export function ProfileModal({ onClose, onUpdated }: Props) {
  const qc = useQueryClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [fullName, setFullName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

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
      }
    }
    load()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !profile) return
    setUploading(true)
    setError(null)
    try {
      const ext = file.name.split('.').pop() ?? 'png'
      const path = `avatars/${profile.id}/avatar.${ext}`
      const { error: uploadError } = await supabase.storage.from('ticket-attachments').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('ticket-attachments').getPublicUrl(path)
      setAvatarUrl(`${publicUrl}?t=${Date.now()}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası')
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    setError(null)
    try {
      const updates: Partial<Profile> = { full_name: fullName.trim() || null, avatar_url: avatarUrl }
      const { data: updateResult, error: updateError } = await supabase.from('profiles').update(updates).eq('id', profile.id).select()
      if (updateError) throw updateError
      if (!updateResult || updateResult.length === 0) throw new Error('Profil güncellenemedi')
      const updated = { ...profile, ...updates } as Profile
      onUpdated(updated)
      qc.invalidateQueries({ queryKey: ['tickets'] })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Kaydetme hatası')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setPwError(null)
    setPwSuccess(false)
    if (!newPassword) { setPwError('Yeni şifre boş olamaz'); return }
    if (newPassword !== confirmPassword) { setPwError('Şifreler eşleşmiyor'); return }
    if (newPassword.length < 6) { setPwError('Şifre en az 6 karakter olmalı'); return }
    setChangingPw(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPwSuccess(true)
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : 'Şifre değiştirme hatası')
    } finally {
      setChangingPw(false)
    }
  }

  const initials = fullName.trim()
    ? fullName.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : profile?.email?.[0]?.toUpperCase() ?? '?'

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Profil</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">✕</button>
        </div>

        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="relative">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-16 h-16 rounded-full object-cover ring-2 ring-gray-200 dark:ring-gray-700" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl font-bold">
                {initials}
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
            >
              Fotoğraf yükle
            </button>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">PNG, JPG, GIF (maks. 2MB)</p>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
            Ad Soyad
          </label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Adınız..."
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Kaydediliyor...' : 'Kaydet'}
        </button>

        {/* Password change */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Şifre Değiştir</p>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Yeni şifre"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Yeni şifre (tekrar)"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
          />
          {pwError && <p className="text-xs text-red-500">{pwError}</p>}
          {pwSuccess && <p className="text-xs text-green-600">Şifre başarıyla değiştirildi!</p>}
          <button
            onClick={handleChangePassword}
            disabled={changingPw}
            className="w-full border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {changingPw ? 'Değiştiriliyor...' : 'Şifreyi Değiştir'}
          </button>
        </div>
      </div>
    </div>
  )
}
