-- 029: allow renaming attachments (file_name only) by the uploader or a team admin.
-- Needed for the "Yeniden adlandır" action in the Dosyalar section.

DROP POLICY IF EXISTS attachments_update ON ticket_attachments;
CREATE POLICY attachments_update ON ticket_attachments
  FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)))
  WITH CHECK (uploaded_by = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)));
