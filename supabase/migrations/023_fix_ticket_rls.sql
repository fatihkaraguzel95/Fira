-- Fix ticket UPDATE and DELETE policies to match application permission rules:
-- UPDATE: team owner OR assigned user (ticket_assignees table)
-- DELETE: team owner OR ticket creator

DROP POLICY IF EXISTS "tickets_update_owner_or_assignee" ON tickets;
DROP POLICY IF EXISTS "tickets_delete_owner" ON tickets;

-- UPDATE: allowed if user is team owner for the project, OR in ticket_assignees
CREATE POLICY "tickets_update" ON tickets
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE p.id = tickets.project_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
    OR EXISTS (
      SELECT 1 FROM ticket_assignees
      WHERE ticket_id = tickets.id AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE p.id = tickets.project_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
    OR EXISTS (
      SELECT 1 FROM ticket_assignees
      WHERE ticket_id = tickets.id AND user_id = auth.uid()
    )
  );

-- DELETE: team owner OR ticket creator
CREATE POLICY "tickets_delete" ON tickets
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE p.id = tickets.project_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
  );
