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
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hover:text-gray-800 dark:hover:text-gray-200 transition-colors flex-1 text-left"
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
                  ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-sm bg-current opacity-50 flex-shrink-0" />
              {project.name}
            </button>
          ))}

          <button
            onClick={() => onCreateProject(team)}
            className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
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
    <aside className="w-56 flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full">
      <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-800">
        <span className="text-lg font-bold text-blue-600">Fira</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {isLoading ? (
          <div className="px-4 py-2 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
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

      <div className="border-t border-gray-100 dark:border-gray-800 p-3 space-y-2">
        <button
          onClick={onCreateTeam}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-sm"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Takım Oluştur
        </button>
        <button
          onClick={onJoinTeam}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          Koda Göre Katıl
        </button>
      </div>
    </aside>
  )
}
