import { useState } from 'react'
import { useMyTeams } from '../../hooks/useTeams'
import { useProjects } from '../../hooks/useProjects'
import type { Team, Project } from '../../types'

interface Props {
  selectedProjectId: string | null
  onSelectProject: (project: Project, team: Team) => void
  onCreateTeam: () => void
  onJoinTeam: () => void
  onCreateProject: (team: Team) => void
  onInvite: (team: Team) => void
}

function TeamRow({
  team,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onInvite,
}: {
  team: Team
  selectedProjectId: string | null
  onSelectProject: (project: Project, team: Team) => void
  onCreateProject: (team: Team) => void
  onInvite: (team: Team) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const { data: projects } = useProjects(team.id)

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1.5 group">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-800 transition-colors flex-1 text-left"
        >
          <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
          {team.name}
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onInvite(team)}
            title="Üye davet et"
            className="text-gray-400 hover:text-blue-500 text-sm px-1"
          >
            +
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ml-3 mb-1">
          {projects?.map((project) => (
            <button
              key={project.id}
              onClick={() => onSelectProject(project, team)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                selectedProjectId === project.id
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-sm bg-current opacity-50 flex-shrink-0" />
              {project.name}
            </button>
          ))}

          <button
            onClick={() => onCreateProject(team)}
            className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1"
          >
            <span>+</span> Proje ekle
          </button>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ selectedProjectId, onSelectProject, onCreateTeam, onJoinTeam, onCreateProject, onInvite }: Props) {
  const { data: teams, isLoading } = useMyTeams()

  return (
    <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="px-4 py-4 border-b border-gray-100">
        <span className="text-lg font-bold text-blue-600">Fira</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {isLoading ? (
          <div className="px-4 py-2 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : teams && teams.length > 0 ? (
          <div className="space-y-1">
            {teams.map((team) => (
              <TeamRow
                key={team.id}
                team={team}
                selectedProjectId={selectedProjectId}
                onSelectProject={onSelectProject}
                onCreateProject={onCreateProject}
                onInvite={onInvite}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-gray-400 mb-3">Henüz takımın yok</p>
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-gray-100 p-3 space-y-1">
        <button
          onClick={onCreateTeam}
          className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors flex items-center gap-2"
        >
          <span className="text-gray-400">+</span> Takım Oluştur
        </button>
        <button
          onClick={onJoinTeam}
          className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors flex items-center gap-2"
        >
          <span className="text-gray-400">→</span> Koda Göre Katıl
        </button>
      </div>
    </aside>
  )
}
