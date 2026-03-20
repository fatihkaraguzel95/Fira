-- Fix: Allow all team members (not just owners/assignees) to update tickets
-- in projects they belong to.

DROP POLICY IF EXISTS "tickets_update" ON tickets;

CREATE POLICY "tickets_update" ON tickets
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE p.id = tickets.project_id
        AND tm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE p.id = tickets.project_id
        AND tm.user_id = auth.uid()
    )
  );
