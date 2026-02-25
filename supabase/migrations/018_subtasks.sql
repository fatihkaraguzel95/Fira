-- 018: Ticket subtasks
CREATE TABLE ticket_subtasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  is_done     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  order_index INT NOT NULL DEFAULT 0
);

ALTER TABLE ticket_subtasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subtasks_select_all" ON ticket_subtasks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "subtasks_insert_own" ON ticket_subtasks
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "subtasks_update_any" ON ticket_subtasks
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "subtasks_delete_own" ON ticket_subtasks
  FOR DELETE TO authenticated USING (created_by = auth.uid());
