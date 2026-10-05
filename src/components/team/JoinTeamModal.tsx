import { FormEvent, useState } from 'react'
import { useJoinTeamByCode } from '../../hooks/useTeams'
import { useT } from '../../i18n'

interface Props { onClose: () => void }

export function JoinTeamModal({ onClose }: Props) {
  const t = useT()
  const [code, setCode] = useState('')
  const { mutateAsync, isPending, error } = useJoinTeamByCode()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await mutateAsync(code.trim())
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-soft">
          <h2 className="text-base font-semibold text-fg">{t('team.join.title')}</h2>
          <button onClick={onClose} className="text-fg-faint hover:text-fg-2">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg-2 mb-1">{t('team.join.codeLabel')}</label>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD123456"
              maxLength={10}
              className="w-full border border-line bg-field text-fg rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary-500 tracking-widest"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{(error as Error).message}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="text-sm text-fg-muted hover:text-fg-2 px-4 py-2">{t('common.cancel')}</button>
            <button type="submit" disabled={isPending || code.length !== 10} className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
              {isPending ? t('team.join.joining') : t('team.join.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
