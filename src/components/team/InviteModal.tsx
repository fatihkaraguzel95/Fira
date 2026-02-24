import { FormEvent, useState } from 'react'
import { useCreateInvitation, useTeamMembers } from '../../hooks/useTeams'
import type { Team } from '../../types'
import { UserAvatar } from '../ticket/UserAvatar'

interface Props {
  team: Team
  onClose: () => void
}

export function InviteModal({ team, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const { mutateAsync: createInvitation, isPending } = useCreateInvitation()
  const { data: members } = useTeamMembers(team.id)

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault()
    const inv = await createInvitation({ teamId: team.id, email: email.trim() || undefined })
    const link = `${window.location.origin}/invite/${inv.token}`
    setInviteLink(link)

    // Open email client with prefilled link
    if (email.trim()) {
      window.open(
        `mailto:${email.trim()}?subject=${encodeURIComponent(`Fira - ${team.name} Daveti`)}&body=${encodeURIComponent(`Merhaba,\n\nSizi "${team.name}" takımına davet ediyorum.\n\nKatılmak için:\n${link}\n\nTakım kodu: ${team.code}`)}`
      )
    }
  }

  const copyLink = () => {
    if (inviteLink) navigator.clipboard.writeText(inviteLink)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{team.name} — Üye Davet Et</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Team code */}
          <div className="bg-blue-50 rounded-xl p-4 text-center">
            <p className="text-xs text-blue-600 font-medium mb-1">Takım Kodu</p>
            <p className="text-2xl font-bold text-blue-700 tracking-widest font-mono">{team.code}</p>
            <p className="text-xs text-blue-500 mt-1">Bu kodu paylaşarak katılım sağlanabilir</p>
          </div>

          {/* Invite by email */}
          <form onSubmit={handleInvite} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="eposta@sirket.com (isteğe bağlı)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {isPending ? '...' : 'Davet Oluştur'}
            </button>
          </form>

          {inviteLink && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-2 font-medium">Davet Linki</p>
              <div className="flex gap-2 items-center">
                <p className="text-xs text-gray-700 flex-1 break-all font-mono">{inviteLink}</p>
                <button
                  onClick={copyLink}
                  className="text-xs bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap"
                >
                  Kopyala
                </button>
              </div>
            </div>
          )}

          {/* Current members */}
          {members && members.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Mevcut Üyeler</p>
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between">
                    <UserAvatar user={m.user ?? null} size="sm" showName />
                    <span className={`text-xs px-2 py-0.5 rounded-full ${m.role === 'owner' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {m.role === 'owner' ? 'Sahip' : 'Üye'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
