-- 006: Enable RLS and set policies

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_all" ON profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- tickets
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tickets_select_all" ON tickets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tickets_insert_own" ON tickets
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "tickets_update_owner_or_assignee" ON tickets
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR assignee_id = auth.uid())
  WITH CHECK (created_by = auth.uid() OR assignee_id = auth.uid());

CREATE POLICY "tickets_delete_owner" ON tickets
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- ticket_attachments
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments_select_all" ON ticket_attachments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "attachments_insert_own" ON ticket_attachments
  FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "attachments_delete_own" ON ticket_attachments
  FOR DELETE TO authenticated USING (uploaded_by = auth.uid());

-- ticket_comments
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_select_all" ON ticket_comments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "comments_insert_own" ON ticket_comments
  FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());

CREATE POLICY "comments_update_own" ON ticket_comments
  FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

CREATE POLICY "comments_delete_own" ON ticket_comments
  FOR DELETE TO authenticated USING (author_id = auth.uid());
