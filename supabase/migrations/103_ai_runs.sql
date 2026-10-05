-- 103: Run records — what each piece of agent work took (#c235f40a; phase 1 of
-- the Claude–Fira integration, #a5b096a1).
--
-- ai_work_requests says THAT work was asked for and how it ended. ai_runs says
-- what it took: when it really started, how long the agent actually worked,
-- how many turns, which model, how many tokens, what that would have cost at
-- API prices, and — while it runs — that the agent is still there and what it
-- is doing. It is a table of its own because:
--   * the queue is on the realtime channel with full rows; a heartbeat a minute
--     there would wake every client of the team;
--   * a run outlives its request: deleting a ticket takes the request with it,
--     the measurement stays (with the title it had).
--
-- A run is opened and closed by a trigger on the queue, so every path — the
-- tool, the old bridge script, a future runner — leaves one. The agent adds the
-- numbers afterwards. Additive only.

CREATE TABLE IF NOT EXISTS public.ai_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID UNIQUE REFERENCES public.ai_work_requests(id) ON DELETE SET NULL,
  agent_id           UUID REFERENCES public.agents(id)  ON DELETE SET NULL,
  ticket_id          UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  team_id            UUID REFERENCES public.teams(id)   ON DELETE CASCADE,   -- who may see it, even after the ticket is gone
  ticket_title       TEXT,                                                    -- as it was when the work started
  -- Where the numbers come from: the agent's own report, a session transcript
  -- read afterwards, or nothing but the queue's timestamps (history before 103).
  source             TEXT NOT NULL DEFAULT 'runner' CHECK (source IN ('runner', 'transcript', 'queue')),
  outcome            TEXT NOT NULL DEFAULT 'running' CHECK (outcome IN ('running', 'done', 'failed', 'cancelled')),
  requested_at       TIMESTAMPTZ,
  started_at         TIMESTAMPTZ NOT NULL,
  finished_at        TIMESTAMPTZ,
  heartbeat_at       TIMESTAMPTZ,
  step               TEXT,               -- what it is doing now, in the agent's words
  active_seconds     INTEGER,            -- time actually worked; waits over five minutes are not counted
  turns              INTEGER,
  model              TEXT,               -- the model that wrote most of the output
  models             JSONB,              -- output tokens per model
  input_tokens       BIGINT,
  output_tokens      BIGINT,
  cache_read_tokens  BIGINT,
  cache_write_tokens BIGINT,
  cost_usd           NUMERIC(10, 2),     -- at API list prices; a subscription does not pay this
  version            TEXT,               -- the app version the work shipped as
  session_id         TEXT,
  session_url        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Deleting a ticket empties ticket_id and (through its request) request_id of
-- the same run, in an order the database picks. Checked at commit, the run can
-- never be caught pointing at a request that is already gone.
ALTER TABLE public.ai_runs ALTER CONSTRAINT ai_runs_request_id_fkey DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS ai_runs_agent_idx  ON public.ai_runs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_team_idx   ON public.ai_runs(team_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_ticket_idx ON public.ai_runs(ticket_id);

ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
-- Read: members of the ticket's team, the agent's owner, system admins.
-- No write policy: the trigger and the two functions below are the only writers.
DROP POLICY IF EXISTS ai_runs_select ON public.ai_runs;
CREATE POLICY ai_runs_select ON public.ai_runs FOR SELECT TO authenticated
  USING (
    public.team_role(team_id) IS NOT NULL
    OR public.is_system_admin()
    OR EXISTS (SELECT 1 FROM public.agents a WHERE a.id = agent_id AND a.owner_id = auth.uid())
  );
REVOKE ALL ON public.ai_runs FROM anon, authenticated;
GRANT SELECT ON public.ai_runs TO authenticated;

-- ── The queue opens and closes runs ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_runs_follow_queue()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'processing' AND OLD.status = 'pending' THEN
    INSERT INTO public.ai_runs (request_id, agent_id, ticket_id, team_id, ticket_title, source, outcome, requested_at, started_at, heartbeat_at)
    SELECT NEW.id, (SELECT a.id FROM public.agents a WHERE a.profile_id = NEW.ai_user_id),
           NEW.ticket_id, public.ticket_team(NEW.ticket_id), t.title, 'runner', 'running', NEW.created_at, now(), now()
      FROM public.tickets t WHERE t.id = NEW.ticket_id
    -- handed back to the queue and picked up again: the same run goes on
    ON CONFLICT (request_id) DO UPDATE SET outcome = 'running', finished_at = NULL, heartbeat_at = now();
  ELSIF OLD.status = 'processing' AND NEW.status IN ('done', 'failed', 'cancelled') THEN
    UPDATE public.ai_runs SET outcome = NEW.status, finished_at = now() WHERE request_id = NEW.id;
  ELSIF OLD.status = 'processing' AND NEW.status = 'pending' THEN
    UPDATE public.ai_runs SET outcome = 'cancelled', finished_at = now() WHERE request_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ai_runs_follow_queue() FROM public, anon;

DROP TRIGGER IF EXISTS ai_runs_follow_queue ON public.ai_work_requests;
CREATE TRIGGER ai_runs_follow_queue
  AFTER UPDATE OF status ON public.ai_work_requests
  FOR EACH ROW EXECUTE FUNCTION public.ai_runs_follow_queue();

-- ── The agent: "still here, doing this" ──────────────────────────────────────
-- Answers with the request's status, so a listener that missed the cancel
-- message learns of it on its next beat.
CREATE OR REPLACE FUNCTION public.agent_heartbeat(p_request uuid, p_step text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT q.status INTO v_status FROM public.ai_work_requests q WHERE q.id = p_request AND q.ai_user_id = auth.uid();
  IF NOT FOUND THEN RETURN 'not-found'; END IF;
  UPDATE public.ai_runs
     SET heartbeat_at = now(), step = coalesce(nullif(btrim(coalesce(p_step, '')), ''), step)
   WHERE request_id = p_request AND outcome = 'running';
  UPDATE public.agents SET last_seen_at = now() WHERE profile_id = auth.uid();
  RETURN v_status;
END $$;
REVOKE ALL ON FUNCTION public.agent_heartbeat(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text) TO authenticated;

-- ── The agent: the numbers of a run ──────────────────────────────────────────
-- Only the listed keys are taken. A run that so far had nothing but the
-- queue's timestamps may also be given its real start and end (history read
-- from a transcript); a run the agent reported itself keeps the times the
-- trigger stamped.
CREATE OR REPLACE FUNCTION public.agent_report_run(p_request uuid, p_metrics jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run     public.ai_runs;
  v_history boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_work_requests q WHERE q.id = p_request AND q.ai_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'İstek bulunamadı' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_run FROM public.ai_runs WHERE request_id = p_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu isteğin çalıştırma kaydı yok' USING ERRCODE = 'no_data_found'; END IF;
  v_history := v_run.source IN ('queue', 'transcript') AND (p_metrics ->> 'started_at') IS NOT NULL AND (p_metrics ->> 'finished_at') IS NOT NULL;

  UPDATE public.ai_runs SET
    active_seconds     = coalesce((p_metrics ->> 'active_seconds')::int, active_seconds),
    turns              = coalesce((p_metrics ->> 'turns')::int, turns),
    model              = coalesce(nullif(p_metrics ->> 'model', ''), model),
    models             = CASE WHEN jsonb_typeof(p_metrics -> 'models') = 'object' THEN p_metrics -> 'models' ELSE models END,
    input_tokens       = coalesce((p_metrics ->> 'input_tokens')::bigint, input_tokens),
    output_tokens      = coalesce((p_metrics ->> 'output_tokens')::bigint, output_tokens),
    cache_read_tokens  = coalesce((p_metrics ->> 'cache_read_tokens')::bigint, cache_read_tokens),
    cache_write_tokens = coalesce((p_metrics ->> 'cache_write_tokens')::bigint, cache_write_tokens),
    cost_usd           = coalesce((p_metrics ->> 'cost_usd')::numeric, cost_usd),
    version            = coalesce(nullif(p_metrics ->> 'version', ''), version),
    session_id         = coalesce(nullif(p_metrics ->> 'session_id', ''), session_id),
    session_url        = coalesce(nullif(p_metrics ->> 'session_url', ''), session_url),
    started_at         = CASE WHEN v_history THEN (p_metrics ->> 'started_at')::timestamptz ELSE started_at END,
    finished_at        = CASE WHEN v_history THEN (p_metrics ->> 'finished_at')::timestamptz ELSE finished_at END,
    source             = CASE WHEN v_history THEN 'transcript' ELSE source END
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN jsonb_build_object('run_id', v_run.id, 'source', v_run.source, 'outcome', v_run.outcome);
END $$;
REVOKE ALL ON FUNCTION public.agent_report_run(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_report_run(uuid, jsonb) TO authenticated;

-- ── History: every request that was worked on before this migration ─────────
-- All the queue knows is when it was asked for and when it was closed, so the
-- duration of these rows includes the wait. They are marked 'queue'; the ones a
-- transcript still covers are refined later (agent_report_run).
INSERT INTO public.ai_runs (request_id, agent_id, ticket_id, team_id, ticket_title, source, outcome, requested_at, started_at, finished_at)
SELECT q.id, a.id, q.ticket_id, public.ticket_team(q.ticket_id), t.title, 'queue', q.status,
       q.created_at, coalesce(q.claimed_at, q.created_at), coalesce(q.finished_at, q.updated_at)
  FROM public.ai_work_requests q
  JOIN public.tickets t ON t.id = q.ticket_id
  LEFT JOIN public.agents a ON a.profile_id = q.ai_user_id
 WHERE q.status IN ('done', 'failed') OR (q.status = 'cancelled' AND q.claimed_at IS NOT NULL)
ON CONFLICT (request_id) DO NOTHING;
