import { useState } from 'react'
import { useMyTeams, useDeleteTeam } from '../../hooks/useTeams'
import { useProjects } from '../../hooks/useProjects'
import type { Team, Project } from '../../types'

// ─── Delete Team Confirm Modal ────────────────────────────────────────────────
function DeleteTeamModal({ team, onClose, onConfirm }: { team: Team; onClose: () => void; onConfirm: () => void }) {
  const [step, setStep] = useState<'confirm' | 'type'>('confirm')
  const [typed, setTyped] = useState('')
  const expected = `eminim ${team.name}`
  const matches = typed.trim().toLowerCase() === expected.toLowerCase()

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-100">Takımı Sil</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Bu işlem geri alınamaz</p>
          </div>
        </div>

        {step === 'confirm' ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              <span className="font-semibold text-gray-900 dark:text-gray-100">"{team.name}"</span> takımını silmek istediğinden emin misin?
              Tüm projeler ve veriler kalıcı olarak silinecek.
            </p>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Vazgeç
              </button>
              <button
                onClick={() => setStep('type')}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Evet, devam et
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Onaylamak için aşağıya tam olarak şunu yaz:
            </p>
            <p className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 mb-3 select-all">
              eminim {team.name}
            </p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`eminim ${team.name}`}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-transparent dark:text-gray-200 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Vazgeç
              </button>
              <button
                onClick={onConfirm}
                disabled={!matches}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Takımı Sil
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Team Row ─────────────────────────────────────────────────────────────────
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
  const [showDelete, setShowDelete] = useState(false)
  const { data: projects } = useProjects(team.id)
  const deleteTeam = useDeleteTeam()

  const handleDelete = async () => {
    await deleteTeam.mutateAsync(team.id)
    setShowDelete(false)
  }

  return (
    <>
      <div className="mb-1">
        {/* Team header */}
        <div className="flex items-center gap-1 px-3 py-1.5 group rounded-lg mx-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 flex-1 text-left min-w-0"
          >
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
              <span className="text-white text-xs font-bold leading-none">
                {team.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide truncate">
              {team.name}
            </span>
            <svg
              className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onInvite(team)}
              title="Üye davet et"
              className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-xs font-bold"
            >
              +
            </button>
            <button
              onClick={() => setShowDelete(true)}
              title="Takımı sil"
              className="w-6 h-6 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Projects */}
        {expanded && (
          <div className="ml-4 mr-2 mt-0.5 mb-1 pl-4 border-l-2 border-gray-100 dark:border-gray-800">
            {projects?.map((project) => {
              const isActive = selectedProjectId === project.id
              return (
                <button
                  key={project.id}
                  onClick={() => onSelectProject(project, team)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all flex items-center gap-2 my-0.5 ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  <svg
                    className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-blue-200' : 'text-gray-400 dark:text-gray-500'}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="truncate font-medium text-xs">{project.name}</span>
                </button>
              )
            })}

            <button
              onClick={() => onCreateProject(team)}
              className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-colors flex items-center gap-2 my-0.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Proje ekle
            </button>
          </div>
        )}
      </div>

      {showDelete && (
        <DeleteTeamModal
          team={team}
          onClose={() => setShowDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
interface Props {
  selectedProjectId: string | null
  onSelectProject: (project: Project, team: Team) => void
  onCreateTeam: () => void
  onJoinTeam: () => void
  onCreateProject: (team: Team) => void
  onInvite: (team: Team) => void
}

export function Sidebar({ selectedProjectId, onSelectProject, onCreateTeam, onJoinTeam, onCreateProject, onInvite }: Props) {
  const { data: teams, isLoading } = useMyTeams()

  return (
    <aside className="w-60 flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <span className="text-base font-bold text-gray-900 dark:text-gray-100">Fira</span>
      </div>

      {/* Teams section label */}
      <div className="px-4 pt-4 pb-1">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
          Takımlar
        </p>
      </div>

      {/* Team list */}
      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
        {isLoading ? (
          <div className="px-4 py-3 space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse flex-shrink-0" />
                <div className="h-3 flex-1 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : teams && teams.length > 0 ? (
          <div>
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
          <div className="px-4 py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">Henüz takımın yok</p>
            <p className="text-xs text-gray-300 dark:text-gray-600 mt-0.5">Aşağıdan oluştur veya katıl</p>
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-gray-100 dark:border-gray-800 p-3 space-y-2">
        <button
          onClick={onCreateTeam}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Takım Oluştur
        </button>
        <button
          onClick={onJoinTeam}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-750 hover:border-gray-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          Koda Göre Katıl
        </button>
      </div>
    </aside>
  )
}
