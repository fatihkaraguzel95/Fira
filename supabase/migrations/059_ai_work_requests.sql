-- 059: AI work hand-off.
-- A user marked is_ai (e.g. the "Ali İlker Claude" test account) can be handed a
-- ticket with one click ("Claude'a yaptır"). The click is an EXPLICIT request —
-- plain assignment does NOT trigger anything; only a row here does. A local
-- listener on the machine running Claude Code subscribes to inserts over Realtime
-- and processes the ticket end-to-end, flipping status pending → processing → done.

-- Which profiles are AI agents (assignable, but distinct from human accounts).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_ai BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ai_work_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES tickets(id)  ON DELETE CASCADE,
  requested_by UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  ai_user_id   UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','done','failed','cancelled')),
  detail       TEXT,                       -- free text: what the listener did / why it failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_work_requests_status_idx ON ai_work_requests(status, created_at);
CREATE INDEX IF NOT EXISTS ai_work_requests_ticket_idx ON ai_work_requests(ticket_id);
-- At most one open (pending/processing) request per ticket — a second click is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS ai_work_requests_one_open
  ON ai_work_requests(ticket_id) WHERE status IN ('pending','processing');

CREATE TRIGGER ai_work_requests_updated_at
  BEFORE UPDATE ON ai_work_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: mirror ticket_comments — any team member reads; a writer requests; a writer
-- (incl. the AI account, a team member) advances the status; requester/admin cancels.
ALTER TABLE ai_work_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_work_select ON ai_work_requests;
DROP POLICY IF EXISTS ai_work_insert ON ai_work_requests;
DROP POLICY IF EXISTS ai_work_update ON ai_work_requests;
DROP POLICY IF EXISTS ai_work_delete ON ai_work_requests;
CREATE POLICY ai_work_select ON ai_work_requests FOR SELECT TO authenticated
  USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY ai_work_insert ON ai_work_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY ai_work_update ON ai_work_requests FOR UPDATE TO authenticated
  USING (public.can_write_team(public.ticket_team(ticket_id)))
  WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY ai_work_delete ON ai_work_requests FOR DELETE TO authenticated
  USING (requested_by = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)));

-- Publish over Realtime so the listener wakes on insert (RLS still applies).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_work_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_work_requests;
  END IF;
END $$;
-- Deletes/updates must carry ticket_id + status to the client.
ALTER TABLE ai_work_requests REPLICA IDENTITY FULL;

-- The test account is our AI agent.
UPDATE profiles SET is_ai = TRUE WHERE email = 'no@mail.co';
