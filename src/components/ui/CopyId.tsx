import { useState } from 'react'
import { useT } from '../../i18n'

/** Faint short id (#ABC123) next to a title; click copies the full id. */
export function CopyId({ id, className = '' }: { id: string; className?: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const short = id.slice(0, 6).toUpperCase()

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea')
      ta.value = id
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? t('common.copied') : `${t('common.copyId')}: ${id}`}
      aria-label={t('common.copyId')}
      className={`tap inline-flex items-center gap-1 h-6 font-mono text-2xs tabular-nums text-fg-muted hover:text-fg px-1 rounded-md transition-colors select-none flex-shrink-0 ${className}`}
    >
      #{short}
      {copied && <span className="text-2xs font-sans text-success">{t('common.copied')}</span>}
    </button>
  )
}
