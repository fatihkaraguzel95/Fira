import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useT } from '../../i18n'

// ─── Confirm (typed) modal for destructive actions ───────────────────────────
export function ConfirmDeleteModal({ title, name, warning, onClose, onConfirm }: { title: string; name: string; warning: string; onClose: () => void; onConfirm: () => void }) {
  const t = useT()
  const [typed, setTyped] = useState('')
  const expected = t('board.confirm.phrase', { name })
  const matches = typed.trim().toLowerCase() === expected.toLowerCase()
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center flex-shrink-0">
            <Icon name="warning" size={20} className="text-danger" />
          </div>
          <div>
            <h3 className="font-bold text-fg">{title}</h3>
            <p className="text-xs text-fg-muted mt-0.5">{t('board.confirm.irreversible')}</p>
          </div>
        </div>
        <p className="text-sm text-fg-2 mb-3">{warning} {t('board.confirm.typeExactly')}</p>
        <p className="text-sm font-mono font-semibold text-fg bg-raised rounded-xl px-3 py-2 mb-3 select-all">{expected}</p>
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={expected} className="w-full border border-line rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-danger bg-field text-fg mb-4" />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-line text-fg-2 hover:bg-raised transition-colors">{t('common.giveUp')}</button>
          <button onClick={onConfirm} disabled={!matches} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-danger text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{t('common.delete')}</button>
        </div>
      </div>
    </div>
  )
}
