import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { CODE_MAX_LINES, languageLabel } from '../../lib/codeBlock'
import type * as Highlight from '../../lib/highlight'

/**
 * Okuma tarafındaki kod bloğu (#58789618): dil etiketi, kopyala düğmesi,
 * satır kaydırmadan yatay kaydırma, satır numarası ve uzun blokta
 * "Devamını göster".
 *
 * Düzenleyicideki karşılığı `lib/codeBlock.ts`; ikisi aynı CSS'i ve aynı
 * renklendiriciyi kullanıyor, tek fark burada bloğun katlanabilmesi (okurken
 * imleç derdi yok). highlight.js burada da **gecikmeli** yükleniyor.
 */

/** Bir kez yüklenen modül; her blok yeniden indirmesin. */
let cached: typeof Highlight | null = null

export function CodeBlock({ code, language, lineNumbers = false }: { code: string; language: string | null; lineNumbers?: boolean }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState<typeof Highlight | null>(cached)
  const timer = useRef<number | null>(null)
  const lines = useMemo(() => (code ? code.split('\n').length : 1), [code])
  const long = lines > CODE_MAX_LINES

  useEffect(() => {
    if (cached || !language || language === 'text') return
    let alive = true
    void import('../../lib/highlight').then((mod) => { cached = mod; if (alive) setHl(mod) }).catch(() => {})
    return () => { alive = false }
  }, [language])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch { /* pano yoksa sessiz geç */ }
  }

  const body = hl && language && hl.canHighlight(language)
    ? hl.tokenize(code, language).map((tok, i) => (tok.className ? <span key={i} className={tok.className}>{tok.text}</span> : <span key={i}>{tok.text}</span>))
    : code

  return (
    <div className={`fira-code${lineNumbers ? ' has-lineno' : ''}`}>
      <div className="fira-code-bar">
        <span className="fira-code-lang-label">{languageLabel(language)}</span>
        <span className="fira-code-lines">{t('ticket.editor.code.lines', { n: lines })}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); void copy() }} className={`fira-code-copy${copied ? ' is-done' : ''}`}>
          {copied ? t('ticket.editor.code.copied') : t('ticket.editor.code.copy')}
        </button>
      </div>
      <pre className={long && !open ? 'is-clipped' : long ? 'is-tall' : undefined}>
        {/* Satır numarası ayrı bir sütun: kopyalamaya karışmaz (seçime girmez). */}
        {lineNumbers && (
          <span className="fira-code-nums" aria-hidden>{Array.from({ length: lines }, (_, i) => String(i + 1)).join('\n')}</span>
        )}
        <code>{body}</code>
      </pre>
      {long && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }} className="fira-code-more">
          {open ? t('ticket.editor.code.less') : t('ticket.editor.code.more', { n: lines - CODE_MAX_LINES })}
        </button>
      )}
    </div>
  )
}
