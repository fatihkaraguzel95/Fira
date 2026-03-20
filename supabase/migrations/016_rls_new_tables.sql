-- 016: RLS for teams, projects, statuses, tags, assignees, tag_assignments

-- ─── TEAMS ──────────────────────────────────────────────────────────────────
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can see any team (needed for join-by-code flow)
CREATE POLICY "teams_select" ON teams
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "teams_insert" ON teams
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "teams_update_owner" ON teams
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM team_members WHERE team_id = teams.id AND user_id = auth.uid() AND role = 'owner'));

CREATE POLICY "teams_delete_owner" ON teams
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- ─── TEAM_MEMBERS ────────────────────────────────────────────────────────────
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_members_select" ON team_members
  FOR SELECT TO authenticated USING (true);

-- Users can add themselves (join by code or accept invite)
CREATE POLICY "team_members_insert_self" ON team_members
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Owner can add others
CREATE POLICY "team_members_insert_owner" ON team_members
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid() AND tm.role = 'owner'
  ));

CREATE POLICY "team_members_delete" ON team_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM team_members WHERE team_id = team_members.team_id AND user_id = auth.uid() AND role = 'owner')
  );

-- ─── TEAM_INVITATIONS ────────────────────────────────────────────────────────
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_invitations_select" ON team_invitations
  FOR SELECT USING (true);

CREATE POLICY "team_invitations_insert" ON team_invitations
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM team_members WHERE team_id = team_invitations.team_id AND user_id = auth.uid()
  ));

CREATE POLICY "team_invitations_update" ON team_invitations
  FOR UPDATE TO authenticated USING (true);

-- ─── PROJECTS ────────────────────────────────────────────────────────────────
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select" ON projects
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM team_members WHERE team_id = projects.team_id AND user_id = auth.uid()));

CREATE POLICY "projects_insert" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM team_members WHERE team_id = projects.team_id AND user_id = auth.uid()));

CREATE POLICY "projects_update" ON projects
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM team_members WHERE team_id = projects.team_id AND user_id = auth.uid()));

CREATE POLICY "projects_delete" ON projects
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- ─── TICKET_STATUSES ─────────────────────────────────────────────────────────
ALTER TABLE ticket_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_statuses_select" ON ticket_statuses
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = ticket_statuses.project_id AND tm.user_id = auth.uid()
  ));

CREATE POLICY "ticket_statuses_insert" ON ticket_statuses
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = ticket_statuses.project_id AND tm.user_id = auth.uid()
  ));

CREATE POLICY "ticket_statuses_update" ON ticket_statuses
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = ticket_statuses.project_id AND tm.user_id = auth.uid()
  ));

CREATE POLICY "ticket_statuses_delete" ON ticket_statuses
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = ticket_statuses.project_id AND tm.user_id = auth.uid()
  ));

-- ─── TAGS ────────────────────────────────────────────────────────────────────
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_select" ON tags
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = tags.project_id AND tm.user_id = auth.uid()
  ));

CREATE POLICY "tags_insert" ON tags
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = tags.project_id AND tm.user_id = auth.uid()
  ));

CREATE POLICY "tags_update" ON tags
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = tags.project_id AND tm.user_id = auth.uid()
  ));

CREATE POLICY "tags_delete" ON tags
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = tags.project_id AND tm.user_id = auth.uid()
  ));

-- ─── TICKET_TAG_ASSIGNMENTS ──────────────────────────────────────────────────
ALTER TABLE ticket_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tag_assignments_select" ON ticket_tag_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "tag_assignments_insert" ON ticket_tag_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tag_assignments_delete" ON ticket_tag_assignments FOR DELETE TO authenticated USING (true);

-- ─── TICKET_ASSIGNEES ────────────────────────────────────────────────────────
ALTER TABLE ticket_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_assignees_select" ON ticket_assignees FOR SELECT TO authenticated USING (true);
CREATE POLICY "ticket_assignees_insert" ON ticket_assignees FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ticket_assignees_delete" ON ticket_assignees FOR DELETE TO authenticated USING (true);
