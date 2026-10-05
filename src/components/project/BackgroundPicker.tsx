import { useMemo, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { createPortal } from 'react-dom'
import { generateBackgrounds, svgDataUrl } from '../../lib/backgrounds'
import { uploadListBackground } from '../../hooks/useProjects'
import { resizeImage } from '../../lib/image'
import { useT } from '../../i18n'

/**
 * Twenty background suggestions for a list, with a refresh for twenty more.
 * The suggestions are generated locally (see lib/backgrounds.ts); a custom photo
 * can be uploaded instead. Whatever is chosen is stored as a file, so the board
 * only renders a URL.
 */
export function BackgroundPicker({ current, onPick, onClose }: {
  current: string | null
  onPick: (url: string | null, credit: string | null) => void
  onClose: () => void
}) {
  const t = useT()
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const suggestions = useMemo(() => generateBackgrounds(seed, 20), [seed])

  const choose = async (svg: string, label: string) => {
    try {
      setError(null); setBusy(label)
      const file = new File([svg], 'arkaplan.svg', { type: 'image/svg+xml' })
      onPick(await uploadListBackground(file), label)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(null) }
  }

  const upload = async (f: File | undefined) => {
    if (!f) return
    try {
      setError(null); setBusy('upload')
      // Board backgrounds are decorative: 2000px wide webp is plenty and keeps the page light.
      const blob = await resizeImage(f, { max: 2000, type: 'image/webp', quality: 0.8 })
      const file = new File([blob], 'arkaplan.webp', { type: 'image/webp' })
      onPick(await uploadListBackground(file), f.name)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(null) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-line rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line-soft">
          <div>
            <h3 className="text-sm font-semibold text-fg">{t('team.background.title')}</h3>
            <p className="text-xs text-fg-muted">{t('team.background.desc')}</p>
          </div>
          <button onClick={onClose} className="text-fg-faint hover:text-fg-2 text-lg leading-none px-1" aria-label={t('common.close')}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
          {error && <p className="text-xs text-danger mb-2">{error}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {suggestions.map((s) => (
              <button
                key={s.id}
                disabled={!!busy}
                onClick={() => choose(s.svg, s.label)}
                title={s.label}
                className="group relative aspect-[16/10] rounded-xl overflow-hidden border border-line hover:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
              >
                {/* Zoomed crop: the full 1600px scene shrunk into a thumbnail would look blank. */}
                <span
                  className="block w-full h-full"
                  style={{ backgroundImage: `url("${svgDataUrl(s.svg)}")`, backgroundSize: '320% auto', backgroundPosition: 'center' }}
                />
                <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-2xs text-white bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity truncate">
                  {busy === s.label ? t('team.background.applying') : s.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-line-soft">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSeed(Math.floor(Math.random() * 1e6))}
              disabled={!!busy}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Icon name="refresh" />
              {t('team.background.newSuggestions')}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-50">
              {busy === 'upload' ? t('common.loading') : t('team.background.uploadOwn')}
            </button>
          </div>
          {current && (
            <button onClick={() => { onPick(null, null); onClose() }} className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-danger hover:bg-danger/10">
              {t('team.background.remove')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
