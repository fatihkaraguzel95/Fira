import { FormEvent, useState } from 'react'
import { useJoinTeamByCode } from '../../hooks/useTeams'

interface Props { onClose: () => void }

export function JoinTeamModal({ onClose }: Props) {
  const [code, setCode] = useState('')
  const { mutateAsync, isPending, error } = useJoinTeamByCode()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await mutateAsync(code.trim())
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Takıma Katıl</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">10 Haneli Takım Kodu</label>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD123456"
              maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 tracking-widest"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{(error as Error).message}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">İptal</button>
            <button type="submit" disabled={isPending || code.length !== 10} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {isPending ? 'Katılınıyor...' : 'Katıl'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
