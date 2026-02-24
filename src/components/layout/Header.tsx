import { useAuth } from '../../hooks/useAuth'
import type { ViewMode, Project, Team } from '../../types'
import { UserAvatar } from '../ticket/UserAvatar'
import { StatusManager } from '../board/StatusManager'
import { useState } from 'react'

interface Props {
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  onNewTicket: () => void
  currentUserProfile: { id: string; email: string; full_name: string | null; avatar_url: string | null } | null
  project: Project | null
  team: Team | null
}

export function Header({ view, onViewChange, onNewTicket, currentUserProfile, project, team }: Props) {
  const { signOut } = useAuth()
  const [showStatuses, setShowStatuses] = useState(false)

  return (
    <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
      {/* Left: Project name + View Toggle */}
      <div className="flex items-center gap-4">
        {project ? (
          <div>
            <p className="text-xs text-gray-400">{team?.name}</p>
            <h1 className="text-sm font-semibold text-gray-800 leading-tight">{project.name}</h1>
          </div>
        ) : (
          <span className="text-sm text-gray-400">Proje seç</span>
        )}

        {project && (
          <>
            {/* View Tabs */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => onViewChange('board')}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${view === 'board' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Kanban
              </button>
              <button
                onClick={() => onViewChange('list')}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${view === 'list' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Liste
              </button>
            </div>

            {/* Status manager */}
            <div className="relative">
              <button
                onClick={() => setShowStatuses(!showStatuses)}
                className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-1"
              >
                Durumlar ⚙
              </button>
              {showStatuses && (
                <div className="absolute left-0 top-10 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-64">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700">Durum Yönetimi</p>
                    <button onClick={() => setShowStatuses(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                  </div>
                  <StatusManager projectId={project.id} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: New Ticket + User */}
      <div className="flex items-center gap-3">
        {project && (
          <button
            onClick={onNewTicket}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <span className="text-base leading-none">+</span> Yeni Ticket
          </button>
        )}

        {currentUserProfile && (
          <div className="flex items-center gap-2">
            <UserAvatar user={currentUserProfile as Parameters<typeof UserAvatar>[0]['user']} size="sm" showName />
            <button
              onClick={signOut}
              className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            >
              Çıkış
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
