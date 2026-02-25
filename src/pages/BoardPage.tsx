import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTickets } from '../hooks/useTickets'
import { useStatuses } from '../hooks/useStatuses'
import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { KanbanBoard } from '../components/board/KanbanBoard'
import { TicketList } from '../components/list/TicketList'
import { QuickCreateModal } from '../components/ticket/QuickCreateModal'
import { TicketModal } from '../components/ticket/TicketModal'
import { CreateTeamModal } from '../components/team/CreateTeamModal'
import { JoinTeamModal } from '../components/team/JoinTeamModal'
import { InviteModal } from '../components/team/InviteModal'
import { CreateProjectModal } from '../components/project/CreateProjectModal'
import { WhatsNewModal } from '../components/WhatsNewModal'
import type { ViewMode, Project, Team, Profile } from '../types'
import { supabase } from '../lib/supabase'

export function BoardPage() {
  const { ticketId } = useParams<{ ticketId?: string }>()
  const { user } = useAuth()
  const [showWhatsNew, setShowWhatsNew] = useState(false)

  const [view, setView] = useState<ViewMode>('board')
  const [showForm, setShowForm] = useState(false)
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null)
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null)

  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [showJoinTeam, setShowJoinTeam] = useState(false)
  const [inviteTarget, setInviteTarget] = useState<Team | null>(null)
  const [createProjectTarget, setCreateProjectTarget] = useState<Team | null>(null)

  const { data: tickets = [], isLoading: ticketsLoading } = useTickets(
    currentProject ? { project_id: currentProject.id } : undefined
  )
  const { data: statuses = [], isLoading: statusesLoading } = useStatuses(currentProject?.id ?? null)

  // Show whats-new every time after login
  useEffect(() => {
    if (user) setShowWhatsNew(true)
  }, [user])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setCurrentUserProfile(data as Profile) })
  }, [user])

  useEffect(() => {
    const pendingToken = sessionStorage.getItem('pendingInviteToken')
    if (pendingToken) {
      sessionStorage.removeItem('pendingInviteToken')
      window.location.href = `/invite/${pendingToken}`
    }
  }, [])

  const isLoading = ticketsLoading || statusesLoading

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar
        selectedProjectId={currentProject?.id ?? null}
        onSelectProject={(project, team) => { setCurrentProject(project); setCurrentTeam(team) }}
        onCreateTeam={() => setShowCreateTeam(true)}
        onJoinTeam={() => setShowJoinTeam(true)}
        onCreateProject={(team) => setCreateProjectTarget(team)}
        onInvite={(team) => setInviteTarget(team)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          view={view}
          onViewChange={setView}
          onNewTicket={() => setShowForm(true)}
          currentUserProfile={currentUserProfile}
          project={currentProject}
          team={currentTeam}
        />

        <main className="flex-1 overflow-hidden px-5 py-4">
          {!currentProject ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-4xl mb-4">📋</p>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Başlamak için sol menüden bir proje seç</p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">veya yeni bir takım/proje oluştur</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : view === 'board' ? (
            <KanbanBoard tickets={tickets} statuses={statuses} />
          ) : (
            <TicketList projectId={currentProject.id} statuses={statuses} />
          )}
        </main>
      </div>

      {/* Ticket detail modal (URL-driven) */}
      {ticketId && <TicketModal projectId={currentProject?.id ?? null} />}

      {/* Quick create modal */}
      {showForm && currentProject && statuses.length > 0 && (
        <QuickCreateModal
          onClose={() => setShowForm(false)}
          statuses={statuses}
          projectId={currentProject.id}
        />
      )}

      {showCreateTeam && <CreateTeamModal onClose={() => setShowCreateTeam(false)} />}
      {showJoinTeam && <JoinTeamModal onClose={() => setShowJoinTeam(false)} />}
      {inviteTarget && <InviteModal team={inviteTarget} onClose={() => setInviteTarget(null)} />}
      {createProjectTarget && (
        <CreateProjectModal
          team={createProjectTarget}
          onClose={() => setCreateProjectTarget(null)}
        />
      )}

      {showWhatsNew && <WhatsNewModal onClose={() => setShowWhatsNew(false)} />}
    </div>
  )
}
