import { useRef, useState } from 'react'
import { ICON_KEYS, LIST_ICONS, ListIcon, ListAvatar } from './ListIcon'
import { uploadListLogo } from '../../hooks/useProjects'
import { useT } from '../../i18n'

interface Props {
  icon: string | null
  iconUrl: string | null
  colorHex?: string | null
  onChange: (next: { icon: string | null; icon_url: string | null }) => void
}

/** Preset icon grid + small logo upload (company/customer logo as avatar). */
export function IconPicker({ icon, iconUrl, colorHex, onChange }: Props) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const url = await uploadListLogo(file)
      onChange({ icon: null, icon_url: url })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('team.icon.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <ListAvatar icon={icon} iconUrl={iconUrl} color={colorHex} size="lg" />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-50 transition-colors"
          >
            {uploading ? t('common.loading') : iconUrl ? t('team.icon.changeLogo') : t('team.icon.uploadLogo')}
          </button>
          {iconUrl && (
            <button
              type="button"
              onClick={() => onChange({ icon: icon ?? 'list', icon_url: null })}
              className="text-xs px-2.5 py-1.5 rounded-lg text-fg-muted hover:text-danger hover:bg-danger/10 transition-colors"
            >
              {t('team.icon.removeLogo')}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </div>
      <p className="text-xs text-fg-faint">{t('team.icon.hint')}</p>
      {error && <p className="text-xs text-danger">{error}</p>}

      <div className={`grid grid-cols-8 sm:grid-cols-10 gap-1 ${iconUrl ? 'opacity-40 pointer-events-none' : ''}`}>
        {ICON_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            title={t(LIST_ICONS[k].labelKey)}
            onClick={() => onChange({ icon: k, icon_url: null })}
            className={`h-8 rounded-lg flex items-center justify-center transition-colors ${
              icon === k && !iconUrl ? 'bg-primary-600 text-white' : 'text-fg-2 hover:bg-raised'
            }`}
          >
            <ListIcon name={k} />
          </button>
        ))}
      </div>
    </div>
  )
}
