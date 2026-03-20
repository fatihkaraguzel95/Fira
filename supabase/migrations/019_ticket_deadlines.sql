-- 019: Extra ticket deadlines
CREATE TABLE ticket_deadlines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ticket_deadlines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deadlines_select_all" ON ticket_deadlines
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "deadlines_insert_any" ON ticket_deadlines
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "deadlines_update_any" ON ticket_deadlines
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "deadlines_delete_any" ON ticket_deadlines
  FOR DELETE TO authenticated USING (true);
