import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTickets, useCreateTicket } from '../hooks/useTickets'
import { useStatuses } from '../hooks/useStatuses'
import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { KanbanBoard } from '../components/board/KanbanBoard'
import { TicketList } from '../components/list/TicketList'
import { TicketModal } from '../components/ticket/TicketModal'
import { CreateTeamModal } from '../components/team/CreateTeamModal'
import { JoinTeamModal } from '../components/team/JoinTeamModal'
import { InviteModal } from '../components/team/InviteModal'
import { CreateProjectModal } from '../components/project/CreateProjectModal'
import { WhatsNewModal } from '../components/WhatsNewModal'
import { ProfileModal } from '../components/profile/ProfileModal'
import type { ViewMode, Project, Team, Profile } from '../types'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../hooks/useIsMobile'

function getWhatsNewKey(userId: string) {
  return `fira_whats_new_seen_${userId}`
}

export function BoardPage() {
  const { ticketId } = useParams<{ ticketId?: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [showProfile, setShowProfile] = useState(false)

  const [view, setView] = useState<ViewMode>('board')
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null)
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null)

  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [showJoinTeam, setShowJoinTeam] = useState(false)
  const [inviteTarget, setInviteTarget] = useState<Team | null>(null)
  const [createProjectTarget, setCreateProjectTarget] = useState<Team | null>(null)

  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const createTicket = useCreateTicket()

  const { data: tickets = [], isLoading: ticketsLoading } = useTickets(
    currentProject ? { project_id: currentProject.id, include_archived: true } : undefined
  )
  const { data: statuses = [], isLoading: statusesLoading } = useStatuses(currentProject?.id ?? null)

  // Show whats-new only once per user (localStorage)
  useEffect(() => {
    if (!user) return
    const key = getWhatsNewKey(user.id)
    const seen = localStorage.getItem(key)
    if (!seen) {
      setShowWhatsNew(true)
    }
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

  const handleCloseWhatsNew = () => {
    setShowWhatsNew(false)
    if (user) localStorage.setItem(getWhatsNewKey(user.id), '1')
  }

  const handleShowWhatsNew = () => {
    setShowWhatsNew(true)
  }

  const handleNewTicket = async () => {
    if (!currentProject || statuses.length === 0) return
    const ticket = await createTicket.mutateAsync({
      title: 'Yeni Görev',
      status: statuses[0].name,
      status_id: statuses[0].id,
      priority: 'medium',
      project_id: currentProject.id,
    })
    navigate(`/ticket/${(ticket as { id: string }).id}`)
  }

  const handleSelectProject = useCallback((project: Project, team: Team) => {
    setCurrentProject(project)
    setCurrentTeam(team)
    localStorage.setItem('lastProjectId', project.id)
    localStorage.setItem('lastTeamId', team.id)
    setSidebarOpen(false)
  }, [])

  const isLoading = ticketsLoading || statusesLoading

  return (
    <div className="h-[100dvh] flex overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar
        selectedProjectId={currentProject?.id ?? null}
        onSelectProject={handleSelectProject}
        onCreateTeam={() => { setShowCreateTeam(true); setSidebarOpen(false) }}
        onJoinTeam={() => { setShowJoinTeam(true); setSidebarOpen(false) }}
        onCreateProject={(team) => { setCreateProjectTarget(team); setSidebarOpen(false) }}
        onInvite={(team) => { setInviteTarget(team); setSidebarOpen(false) }}
        onProjectDeleted={(projectId) => {
          if (currentProject?.id === projectId) {
            setCurrentProject(null)
            setCurrentTeam(null)
            localStorage.removeItem('lastProjectId')
            localStorage.removeItem('lastTeamId')
          }
        }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          view={view}
          onViewChange={setView}
          onNewTicket={handleNewTicket}
          onShowWhatsNew={handleShowWhatsNew}
          onOpenProfile={() => setShowProfile(true)}
          onMenuToggle={() => setSidebarOpen(prev => !prev)}
          currentUserProfile={currentUserProfile}
          project={currentProject}
          team={currentTeam}
        />

        <main className="flex-1 overflow-hidden px-5 py-4">
          {!currentProject ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center px-6">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-gray-700 dark:text-gray-300 text-sm font-medium mb-1">Proje seçilmedi</p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mb-5">Başlamak için bir proje seçin</p>
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                  Proje Seç
                </button>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : view === 'board' ? (
            <KanbanBoard tickets={tickets} statuses={statuses} projectId={currentProject.id} />
          ) : (
            <TicketList projectId={currentProject.id} statuses={statuses} />
          )}
        </main>
      </div>

      {ticketId && <TicketModal projectId={currentProject?.id ?? null} />}

      {showCreateTeam && <CreateTeamModal onClose={() => setShowCreateTeam(false)} />}
      {showJoinTeam && <JoinTeamModal onClose={() => setShowJoinTeam(false)} />}
      {inviteTarget && <InviteModal team={inviteTarget} onClose={() => setInviteTarget(null)} />}
      {createProjectTarget && (
        <CreateProjectModal
          team={createProjectTarget}
          onClose={() => setCreateProjectTarget(null)}
        />
      )}

      {showWhatsNew && <WhatsNewModal onClose={handleCloseWhatsNew} />}
      {showProfile && (
        <ProfileModal
          onClose={() => setShowProfile(false)}
          onUpdated={(profile) => setCurrentUserProfile(profile)}
        />
      )}
    </div>
  )
}
