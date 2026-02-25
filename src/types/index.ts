// ─── Enums ───────────────────────────────────────────────────────────────────
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical'

// ─── Profiles ────────────────────────────────────────────────────────────────
export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
}

// ─── Teams ───────────────────────────────────────────────────────────────────
export interface Team {
  id: string
  name: string
  code: string
  created_by: string
  created_at: string
}

export interface TeamMember {
  team_id: string
  user_id: string
  role: 'owner' | 'member'
  joined_at: string
  user?: Profile
}

export interface TeamInvitation {
  id: string
  team_id: string
  email: string | null
  token: string
  invited_by: string
  status: 'pending' | 'accepted'
  created_at: string
}

// ─── Projects ────────────────────────────────────────────────────────────────
export interface Project {
  id: string
  team_id: string
  name: string
  description: string | null
  created_by: string
  created_at: string
}

// ─── Ticket Statuses ─────────────────────────────────────────────────────────
export interface TicketStatus {
  id: string
  project_id: string
  name: string
  color: string
  order_index: number
}

// ─── Tags ────────────────────────────────────────────────────────────────────
export interface Tag {
  id: string
  project_id: string
  name: string
  color: string
  created_at: string
}

// ─── Tickets ─────────────────────────────────────────────────────────────────
export interface Ticket {
  id: string
  title: string
  description: string | null
  status: string          // legacy TEXT (used when no project)
  status_id: string | null // references ticket_statuses
  priority: TicketPriority
  assignee_id: string | null  // legacy single assignee
  project_id: string | null
  due_date: string | null
  created_by: string
  created_at: string
  updated_at: string
  order_index: number
  // Joined relations
  assignee: Profile | null
  creator: Profile | null
  status_info: TicketStatus | null
  assignees: { user_id: string; user: Profile }[]
  tags: { tag: Tag }[]
}

export interface TicketAttachment {
  id: string
  ticket_id: string
  file_url: string
  file_name: string
  uploaded_by: string
  created_at: string
  uploader: Profile | null
}

export interface TicketComment {
  id: string
  ticket_id: string
  author_id: string
  content: string
  created_at: string
  author: Profile | null
}

// ─── Subtasks ─────────────────────────────────────────────────────────────────
export interface SubTask {
  id: string
  ticket_id: string
  title: string
  is_done: boolean
  created_by: string
  created_at: string
  order_index: number
}

// ─── Extra Deadlines ──────────────────────────────────────────────────────────
export interface TicketDeadline {
  id: string
  ticket_id: string
  date: string
  description: string | null
  created_at: string
}

// ─── Form Types ───────────────────────────────────────────────────────────────
export interface CreateTicketInput {
  title: string
  description?: string
  status: string
  status_id?: string | null
  priority: TicketPriority
  project_id?: string | null
  assignee_ids?: string[]
  due_date?: string | null
  tag_ids?: string[]
}

export interface UpdateTicketInput {
  title?: string
  description?: string | null
  status?: string
  status_id?: string | null
  priority?: TicketPriority
  assignee_id?: string | null
  due_date?: string | null
  order_index?: number
  project_id?: string | null
}

export interface TicketFilters {
  status_id?: string[]
  priority?: TicketPriority[]
  assignee_id?: string
  search?: string
  project_id?: string
}

export type ViewMode = 'board' | 'list'

// ─── Labels ───────────────────────────────────────────────────────────────────
export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
}
