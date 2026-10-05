-- Fira migrations 103 -> 113  (part 6/7)
-- Supabase Dashboard -> SQL Editor: bu dosyanin tamamini yapistirip calistirin.
-- Parcalari SIRAYLA calistirin; bir parca hata verirse sonrakine gecmeyin.

-- ========================================
-- 103_ai_runs.sql
-- ========================================
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

-- ========================================
-- 104_agent_presence.sql
-- ========================================
-- 104: Agent presence — "is it listening" the moment it changes (#c813e104).
--
-- Until now "Dinliyor" was judged from agents.last_seen_at: the listener says
-- "I am here" once a minute and three minutes of silence meant offline. Closing
-- the terminal therefore still showed "Dinliyor" for up to three minutes.
--
-- The listener already holds a Realtime socket. It now also sits in a private
-- presence channel, `agent:<agent id>`; when its process ends the socket closes
-- and Realtime tells everyone watching, within seconds. The heartbeat stays as
-- the fallback (a listener without the live channel, a client still joining).
--
-- Who may do what on that channel, checked by Realtime against these policies:
--   show up in it (presence track)  only the agent's own account
--   see who is in it                whoever may see the agent (its RLS decides)
--
-- Additive only.

CREATE OR REPLACE FUNCTION public.agent_topic_access(p_topic text, p_track boolean)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.agents;
BEGIN
  IF p_topic IS NULL OR p_topic !~ '^agent:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  SELECT * INTO v FROM public.agents WHERE id = substr(p_topic, 7)::uuid;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_track THEN
    RETURN v.profile_id = auth.uid();
  END IF;
  -- the same rule as agents_select (100)
  RETURN v.profile_id = auth.uid()
      OR coalesce(v.owner_id = auth.uid(), false)
      OR public.can_see_profile(v.profile_id)
      OR public.is_system_admin();
END $$;
REVOKE ALL ON FUNCTION public.agent_topic_access(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_topic_access(text, boolean) TO authenticated;

-- Policies are OR-ed with the canvas ones (096); each only speaks for its own topics.
-- Realtime lets nobody join a private channel without the right to read its
-- broadcasts, so reading covers both kinds; nobody is allowed to SEND a
-- broadcast here (the insert policy below is presence only).
DROP POLICY IF EXISTS fira_agent_receive ON realtime.messages;
CREATE POLICY fira_agent_receive ON realtime.messages FOR SELECT TO authenticated
  USING (extension IN ('broadcast', 'presence') AND public.agent_topic_access(realtime.topic(), false));

DROP POLICY IF EXISTS fira_agent_track ON realtime.messages;
CREATE POLICY fira_agent_track ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (extension = 'presence' AND public.agent_topic_access(realtime.topic(), true));

-- ========================================
-- 105_agent_create.sql
-- ========================================
-- 105: A person creates their own agent (#8a7c1847; leftovers of phase 1, #425bb5d4).
--
-- Until now the one agent was made by hand in SQL (059 marked the test account
-- is_ai, 100 turned it into an agent). Anyone else who wanted "their Claude"
-- had no way to get one. This adds the missing first step of the setup:
--
--   agent_create(name, teams)   an agent account owned by the caller
--   agent_set_teams(agent, …)   which of the owner's teams the agent is in
--
-- An agent account is a profile with is_ai and NO login: it has no password and
-- no auth user, it can only be signed in for with an agent key (101). What it
-- may see and do is decided by its team memberships, like anyone's — and those
-- are bounded by its owner's:
--   * it can only be put into teams its owner is a member of;
--   * its role there is never above 'member', and 'viewer' where the owner is one;
--   * when the owner leaves a team (or is removed), the agent leaves with them;
--     when the owner becomes a viewer, so does the agent.
-- Team admins see it in the member list and can remove it like any member.
--
-- Additive only.

-- The role an agent gets in a team, from its owner's role there.
CREATE OR REPLACE FUNCTION public.agent_role_for(p_owner_role text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_owner_role IS NULL THEN NULL WHEN p_owner_role = 'viewer' THEN 'viewer' ELSE 'member' END
$$;
REVOKE ALL ON FUNCTION public.agent_role_for(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_role_for(text) TO authenticated;

-- Put the agent into exactly these teams (of its owner's). Shared by create and set.
CREATE OR REPLACE FUNCTION public.agent_apply_teams(p_agent_profile uuid, p_owner uuid, p_team_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  v_role text;
BEGIN
  FOREACH v_team IN ARRAY coalesce(p_team_ids, '{}'::uuid[]) LOOP
    SELECT role INTO v_role FROM public.team_members WHERE team_id = v_team AND user_id = p_owner;
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Ajan yalnız üyesi olduğun takımlara eklenebilir';   -- P0001: shown to the person as it is
    END IF;
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (v_team, p_agent_profile, public.agent_role_for(v_role))
    -- Already a member: the role it has stays (a team admin may have set it), except
    -- that it comes down to viewer where the owner is only a viewer.
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'viewer'
      WHERE EXCLUDED.role = 'viewer' AND public.team_members.role <> 'owner';
  END LOOP;
  -- Leave the teams that are no longer on the list — but only teams the owner is
  -- in: a membership someone else arranged (an admin added the agent to a team
  -- the owner is not part of) is not the owner's to remove.
  DELETE FROM public.team_members m
   WHERE m.user_id = p_agent_profile
     AND m.role <> 'owner'
     AND NOT (m.team_id = ANY (coalesce(p_team_ids, '{}'::uuid[])))
     AND EXISTS (SELECT 1 FROM public.team_members o WHERE o.team_id = m.team_id AND o.user_id = p_owner);
END $$;
REVOKE ALL ON FUNCTION public.agent_apply_teams(uuid, uuid, uuid[]) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_create(p_name text, p_team_ids uuid[] DEFAULT NULL)
RETURNS public.agents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      uuid := auth.uid();
  v_name    text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_profile uuid := gen_random_uuid();
  v_agent   public.agents;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Oturum gerekli' USING ERRCODE = 'insufficient_privilege'; END IF;
  -- An agent is somebody's; it cannot have agents of its own.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_me AND is_ai) THEN
    RAISE EXCEPTION 'Bir ajan hesabı ajan oluşturamaz';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agents WHERE owner_id = v_me) THEN
    RAISE EXCEPTION 'Zaten bir ajanın var';
  END IF;
  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'Ajanın adı 2–60 karakter olmalı' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.profiles (id, full_name, is_ai) VALUES (v_profile, v_name, true);
  INSERT INTO public.agents (profile_id, owner_id) VALUES (v_profile, v_me) RETURNING * INTO v_agent;
  PERFORM public.agent_apply_teams(v_profile, v_me, p_team_ids);
  RETURN v_agent;
END $$;
REVOKE ALL ON FUNCTION public.agent_create(text, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_create(text, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.agent_set_teams(p_agent uuid, p_team_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.agents;
BEGIN
  SELECT * INTO v FROM public.agents WHERE id = p_agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ajan bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  -- The owner only: the teams are bounded by the owner's own memberships, which a system admin acting here would not have.
  IF v.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Ajanın takımlarını yalnız sahibi değiştirebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.agent_apply_teams(v.profile_id, v.owner_id, p_team_ids);
END $$;
REVOKE ALL ON FUNCTION public.agent_set_teams(uuid, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_set_teams(uuid, uuid[]) TO authenticated;

-- The agent follows its owner out of a team, and down to viewer.
CREATE OR REPLACE FUNCTION public.team_members_agents_follow()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.team_members m
     USING public.agents a
     WHERE a.owner_id = OLD.user_id AND m.user_id = a.profile_id AND m.team_id = OLD.team_id AND m.role <> 'owner';
    RETURN OLD;
  END IF;
  IF NEW.role = 'viewer' AND OLD.role <> 'viewer' THEN
    UPDATE public.team_members m SET role = 'viewer'
      FROM public.agents a
     WHERE a.owner_id = NEW.user_id AND m.user_id = a.profile_id AND m.team_id = NEW.team_id AND m.role <> 'owner';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.team_members_agents_follow() FROM public, anon;

DROP TRIGGER IF EXISTS team_members_agents_follow ON public.team_members;
CREATE TRIGGER team_members_agents_follow
  AFTER DELETE OR UPDATE OF role ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.team_members_agents_follow();

-- ========================================
-- 106_ai_run_steps.sql
-- ========================================
-- 106: The steps of a run and its tool use (#c94673c2; leftovers of phase 1, #425bb5d4).
--
-- ai_runs (103) keeps only the step a job is at right now. The detail view of a
-- run needs the whole path: which steps the work went through, when, and how
-- long each took — plus which tools the agent called how often. Two additions:
--
--   ai_run_steps   one row each time the agent names a new step
--   ai_runs.tools  tool name → call count, reported with the other numbers
--
-- Additive: a new table, a new column, and the two functions of 103 extended
-- (same signatures, same answers).

CREATE TABLE IF NOT EXISTS public.ai_run_steps (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  step   TEXT NOT NULL CHECK (length(step) BETWEEN 1 AND 120),
  at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()   -- the real moment, not the transaction's start: steps keep their order
);
ALTER TABLE public.ai_run_steps ALTER COLUMN at SET DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS ai_run_steps_run_idx ON public.ai_run_steps(run_id, at);

ALTER TABLE public.ai_run_steps ENABLE ROW LEVEL SECURITY;
-- Whoever may see the run may see its steps (the run's own policy decides inside the subquery).
-- No write policy: agent_heartbeat is the only writer.
DROP POLICY IF EXISTS ai_run_steps_select ON public.ai_run_steps;
CREATE POLICY ai_run_steps_select ON public.ai_run_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_runs r WHERE r.id = run_id));
REVOKE ALL ON public.ai_run_steps FROM anon, authenticated;
GRANT SELECT ON public.ai_run_steps TO authenticated;

ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS tools JSONB;        -- { "Bash": 38, "Edit": 3, … }
ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS tool_calls INTEGER; -- their sum, for the list

-- The heartbeat, as before — and a step that differs from the current one is
-- also written to the run's history (the same step repeated is one step).
CREATE OR REPLACE FUNCTION public.agent_heartbeat(p_request uuid, p_step text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_step   text := left(nullif(btrim(regexp_replace(coalesce(p_step, ''), '\s+', ' ', 'g')), ''), 120);
  v_run    public.ai_runs;
BEGIN
  SELECT q.status INTO v_status FROM public.ai_work_requests q WHERE q.id = p_request AND q.ai_user_id = auth.uid();
  IF NOT FOUND THEN RETURN 'not-found'; END IF;
  SELECT * INTO v_run FROM public.ai_runs WHERE request_id = p_request AND outcome = 'running';
  IF FOUND THEN
    IF v_step IS NOT NULL AND v_step IS DISTINCT FROM v_run.step THEN
      INSERT INTO public.ai_run_steps (run_id, step) VALUES (v_run.id, v_step);
    END IF;
    UPDATE public.ai_runs SET heartbeat_at = now(), step = coalesce(v_step, step) WHERE id = v_run.id;
  END IF;
  UPDATE public.agents SET last_seen_at = now() WHERE profile_id = auth.uid();
  RETURN v_status;
END $$;
REVOKE ALL ON FUNCTION public.agent_heartbeat(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text) TO authenticated;

-- The numbers of a run, as before — plus its tool use.
CREATE OR REPLACE FUNCTION public.agent_report_run(p_request uuid, p_metrics jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run     public.ai_runs;
  v_history boolean;
  v_tools   jsonb := CASE WHEN jsonb_typeof(p_metrics -> 'tools') = 'object' THEN p_metrics -> 'tools' END;
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
    tools              = coalesce(v_tools, tools),
    tool_calls         = CASE WHEN v_tools IS NULL THEN tool_calls
                              ELSE (SELECT coalesce(sum(value::int), 0) FROM jsonb_each_text(v_tools) WHERE value ~ '^\d+$') END,
    started_at         = CASE WHEN v_history THEN (p_metrics ->> 'started_at')::timestamptz ELSE started_at END,
    finished_at        = CASE WHEN v_history THEN (p_metrics ->> 'finished_at')::timestamptz ELSE finished_at END,
    source             = CASE WHEN v_history THEN 'transcript' ELSE source END
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN jsonb_build_object('run_id', v_run.id, 'source', v_run.source, 'outcome', v_run.outcome);
END $$;
REVOKE ALL ON FUNCTION public.agent_report_run(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_report_run(uuid, jsonb) TO authenticated;

-- ========================================
-- 107_ai_rule_pages.sql
-- ========================================
-- 107: Agent rules as Fira pages (#f10b0cf7; phase 2, #0a6cc77d).
--
-- How an agent is to work used to live in the repository's CLAUDE.md, in one
-- computer's memory files and in chat history: the team could neither read nor
-- change it, and somebody else's Claude could not work by the same rules.
--
-- A rule is an ordinary page (so everybody reads it, edits it, and its versions
-- are kept — 067). This table only says WHICH pages are rules and for what:
--
--   project_id NULL  → a rule of the whole team
--   project_id set   → a rule of that list, read after the team's
--   required         → the team means it: a personal preference does not override it
--
-- Personal preferences are not here: they are the owner's, and live in
-- agents.settings (100).
--
-- Additive: one new table. Nothing existing changes.

CREATE TABLE IF NOT EXISTS public.ai_rule_pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  page_id     UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  required    BOOLEAN NOT NULL DEFAULT false,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A page is a rule of the team once, and of a given list once.
CREATE UNIQUE INDEX IF NOT EXISTS ai_rule_pages_once
  ON public.ai_rule_pages (page_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS ai_rule_pages_team_idx ON public.ai_rule_pages(team_id, project_id);

-- The team is the page's team, never the client's word; a list rule's page is in
-- the list's own team; a canvas has no text to be a rule. What a row points at
-- does not change afterwards (drop it and add another).
-- Refusals a person sees are raised without an ERRCODE, so the app shows them as written.
CREATE OR REPLACE FUNCTION public.ai_rule_pages_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  v_kind text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.page_id := OLD.page_id;
    NEW.project_id := OLD.project_id;
    NEW.team_id := OLD.team_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    RETURN NEW;
  END IF;
  SELECT team_id, kind INTO v_team, v_kind FROM pages WHERE id = NEW.page_id;
  IF v_team IS NULL THEN RAISE EXCEPTION 'Kural sayfası bulunamadı.'; END IF;
  IF v_kind <> 'page' THEN RAISE EXCEPTION 'Çizim ve whiteboard kural sayfası olamaz.'; END IF;
  IF NEW.project_id IS NOT NULL AND public.project_team(NEW.project_id) IS DISTINCT FROM v_team THEN
    RAISE EXCEPTION 'Kural sayfası listeyle aynı takımda olmalı.';
  END IF;
  NEW.team_id := v_team;
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_rule_pages_before_write ON public.ai_rule_pages;
CREATE TRIGGER ai_rule_pages_before_write BEFORE INSERT OR UPDATE ON public.ai_rule_pages
  FOR EACH ROW EXECUTE FUNCTION public.ai_rule_pages_before_write();
REVOKE ALL ON FUNCTION public.ai_rule_pages_before_write() FROM public, anon;

ALTER TABLE public.ai_rule_pages ENABLE ROW LEVEL SECURITY;
-- Everybody in the team reads the rules (the agent is a member like any other);
-- the team's admins decide which pages are rules and which of them are required.
DROP POLICY IF EXISTS ai_rule_pages_select ON public.ai_rule_pages;
CREATE POLICY ai_rule_pages_select ON public.ai_rule_pages FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
DROP POLICY IF EXISTS ai_rule_pages_insert ON public.ai_rule_pages;
CREATE POLICY ai_rule_pages_insert ON public.ai_rule_pages FOR INSERT TO authenticated
  WITH CHECK (public.is_team_admin(team_id));
DROP POLICY IF EXISTS ai_rule_pages_update ON public.ai_rule_pages;
CREATE POLICY ai_rule_pages_update ON public.ai_rule_pages FOR UPDATE TO authenticated
  USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
DROP POLICY IF EXISTS ai_rule_pages_delete ON public.ai_rule_pages;
CREATE POLICY ai_rule_pages_delete ON public.ai_rule_pages FOR DELETE TO authenticated
  USING (public.is_team_admin(team_id));
REVOKE ALL ON public.ai_rule_pages FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_rule_pages TO authenticated;

-- ========================================
-- 108_ai_run_rules.sql
-- ========================================
-- 108: Which rules a run worked by (#29bc4417; phase 2, #0a6cc77d).
--
-- The agent reads the team's and the list's rule pages when it takes a job
-- (107). A rule page is edited like any page, so "what did the agent work by?"
-- has to be answered for the moment of the run, not for today: the run keeps
-- the pages it read and the version of each (the page's updated_at then).
--
--   ai_runs.rules           [{ page_id, title, scope: team|list, required, updated_at }], in reading order;
--                           NULL = nothing was recorded (runs before this), [] = no rules were defined
--   ai_runs.rules_personal  the owner's personal preferences were read as well
--
-- Additive: two columns, and agent_report_run (103, 106) extended — same
-- signature, same answer; a report without `rules` leaves them as they are.

ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS rules JSONB;
ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS rules_personal BOOLEAN;

CREATE OR REPLACE FUNCTION public.agent_report_run(p_request uuid, p_metrics jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run     public.ai_runs;
  v_history boolean;
  v_tools   jsonb := CASE WHEN jsonb_typeof(p_metrics -> 'tools') = 'object' THEN p_metrics -> 'tools' END;
  -- Only the known fields of well-formed entries are kept, at most 30: the column is
  -- shown to the whole team and must not become a place to store arbitrary text.
  v_rules   jsonb := CASE WHEN jsonb_typeof(p_metrics -> 'rules') = 'array' THEN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'page_id', e ->> 'page_id',
             'title', left(coalesce(e ->> 'title', ''), 200),
             'scope', CASE WHEN e ->> 'scope' = 'list' THEN 'list' ELSE 'team' END,
             'required', (e ->> 'required') = 'true',
             'updated_at', CASE WHEN (e ->> 'updated_at') ~ '^\d{4}-\d{2}-\d{2}T' THEN e ->> 'updated_at' END
           ) ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(p_metrics -> 'rules') WITH ORDINALITY AS x(e, ord)
    WHERE ord <= 30 AND jsonb_typeof(e) = 'object'
      AND (e ->> 'page_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) END;
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
    tools              = coalesce(v_tools, tools),
    tool_calls         = CASE WHEN v_tools IS NULL THEN tool_calls
                              ELSE (SELECT coalesce(sum(value::int), 0) FROM jsonb_each_text(v_tools) WHERE value ~ '^\d+$') END,
    rules              = coalesce(v_rules, rules),
    rules_personal     = CASE WHEN v_rules IS NULL THEN rules_personal ELSE coalesce((p_metrics ->> 'rules_personal') = 'true', false) END,
    started_at         = CASE WHEN v_history THEN (p_metrics ->> 'started_at')::timestamptz ELSE started_at END,
    finished_at        = CASE WHEN v_history THEN (p_metrics ->> 'finished_at')::timestamptz ELSE finished_at END,
    source             = CASE WHEN v_history THEN 'transcript' ELSE source END
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN jsonb_build_object('run_id', v_run.id, 'source', v_run.source, 'outcome', v_run.outcome);
END $$;
REVOKE ALL ON FUNCTION public.agent_report_run(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_report_run(uuid, jsonb) TO authenticated;

-- ========================================
-- 109_ai_deploy_approval.sql
-- ========================================
-- 109: Go-live approval (#5621fce5; phase 2, #0a6cc77d).
--
-- Whether an agent may put its work live by itself was a habit, written down
-- nowhere and adjustable nowhere. Decision (1 Oct 2026): it is set per list and
-- per person.
--
--   ai_list_policies.deploy      the list's word, set by the team's admins
--   agents.settings ->> 'deploy' the person's word for their own agent (100; set by the owner)
--       auto   the agent goes live by itself (how it worked until now; the default)
--       ask    the agent says what would go live and waits for a person's yes
--       never  nothing goes live from this list / from this agent
--   The stricter of the two applies.
--
--   ai_work_requests.approval    the question and its answer, on the request it belongs to:
--       { status: pending|approved|rejected, summary, asked_at, decided_by, decided_at, note }
--     On the request row because that row is already what the ticket's chip and the
--     agent's listener watch (realtime), and because an answer means nothing once
--     the request is over.
--
-- Both the question and the answer are also written as comments, so the
-- ticket's history shows them and the usual notifications go out.
--
-- Additive: one new table, one new column, three new functions.

ALTER TABLE public.ai_work_requests ADD COLUMN IF NOT EXISTS approval JSONB;

-- The request row may be updated by any writer of the team (059: cancel, re-queue) —
-- the agent included. The approval must not be writable that way, or the agent could
-- answer its own question. Only the two functions below write it: they raise a flag
-- for their own transaction, and without the flag the column keeps its value.
-- (A client cannot set the flag: PostgREST runs no free SQL and exposes no set_config.)
CREATE OR REPLACE FUNCTION public.ai_work_requests_guard_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('fira.approval_write', true) = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN NEW.approval := NULL;
  ELSE NEW.approval := OLD.approval;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_work_requests_guard_approval ON public.ai_work_requests;
CREATE TRIGGER ai_work_requests_guard_approval BEFORE INSERT OR UPDATE ON public.ai_work_requests
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_requests_guard_approval();
REVOKE ALL ON FUNCTION public.ai_work_requests_guard_approval() FROM public, anon;

CREATE TABLE IF NOT EXISTS public.ai_list_policies (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  deploy     TEXT NOT NULL DEFAULT 'auto' CHECK (deploy IN ('auto', 'ask', 'never')),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The team is the list's team, never the client's word.
CREATE OR REPLACE FUNCTION public.ai_list_policies_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.project_id := OLD.project_id; END IF;
  NEW.team_id := public.project_team(NEW.project_id);
  IF NEW.team_id IS NULL THEN RAISE EXCEPTION 'Liste bulunamadı.'; END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_list_policies_before_write ON public.ai_list_policies;
CREATE TRIGGER ai_list_policies_before_write BEFORE INSERT OR UPDATE ON public.ai_list_policies
  FOR EACH ROW EXECUTE FUNCTION public.ai_list_policies_before_write();
REVOKE ALL ON FUNCTION public.ai_list_policies_before_write() FROM public, anon;

ALTER TABLE public.ai_list_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_list_policies_select ON public.ai_list_policies;
CREATE POLICY ai_list_policies_select ON public.ai_list_policies FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
DROP POLICY IF EXISTS ai_list_policies_insert ON public.ai_list_policies;
CREATE POLICY ai_list_policies_insert ON public.ai_list_policies FOR INSERT TO authenticated
  WITH CHECK (public.is_team_admin(team_id));
DROP POLICY IF EXISTS ai_list_policies_update ON public.ai_list_policies;
CREATE POLICY ai_list_policies_update ON public.ai_list_policies FOR UPDATE TO authenticated
  USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
DROP POLICY IF EXISTS ai_list_policies_delete ON public.ai_list_policies;
CREATE POLICY ai_list_policies_delete ON public.ai_list_policies FOR DELETE TO authenticated
  USING (public.is_team_admin(team_id));
REVOKE ALL ON public.ai_list_policies FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_list_policies TO authenticated;

-- What applies to work on a ticket by a given agent account (default: the caller's own).
-- Runs with the caller's rights: it tells you only about tickets and agents you can see.
CREATE OR REPLACE FUNCTION public.ai_deploy_policy(p_ticket uuid, p_agent_profile uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_list   text;
  v_person text;
  v_rank   CONSTANT text[] := ARRAY['auto', 'ask', 'never'];
BEGIN
  SELECT COALESCE(lp.deploy, 'auto') INTO v_list
    FROM tickets t LEFT JOIN ai_list_policies lp ON lp.project_id = t.project_id
   WHERE t.id = p_ticket;
  IF v_list IS NULL THEN RAISE EXCEPTION 'Görev bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  SELECT a.settings ->> 'deploy' INTO v_person FROM agents a WHERE a.profile_id = COALESCE(p_agent_profile, auth.uid());
  IF v_person IS NULL OR NOT (v_person = ANY (v_rank)) THEN v_person := 'auto'; END IF;
  RETURN jsonb_build_object('list', v_list, 'person', v_person,
    'effective', v_rank[GREATEST(array_position(v_rank, v_list), array_position(v_rank, v_person))]);
END $$;
REVOKE ALL ON FUNCTION public.ai_deploy_policy(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_deploy_policy(uuid, uuid) TO authenticated;

-- The agent asks: "this is what would go live". Only for its own request, only while
-- it is being worked on, and only where the policy says to ask.
CREATE OR REPLACE FUNCTION public.agent_ask_approval(p_request uuid, p_summary text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req     public.ai_work_requests;
  v_policy  text;
  v_summary text := left(btrim(coalesce(p_summary, '')), 2000);
BEGIN
  SELECT * INTO v_req FROM ai_work_requests WHERE id = p_request AND ai_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'İstek bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  IF v_req.status <> 'processing' THEN RETURN jsonb_build_object('asked', false, 'reason', 'request-' || v_req.status); END IF;
  v_policy := public.ai_deploy_policy(v_req.ticket_id, auth.uid()) ->> 'effective';
  IF v_policy = 'never' THEN RETURN jsonb_build_object('asked', false, 'reason', 'never'); END IF;
  IF v_policy = 'auto' THEN RETURN jsonb_build_object('asked', false, 'reason', 'not-needed'); END IF;
  IF v_summary = '' THEN RAISE EXCEPTION 'Neyin canlıya çıkacağını yaz.'; END IF;
  PERFORM set_config('fira.approval_write', '1', true);
  UPDATE ai_work_requests
     SET approval = jsonb_build_object('status', 'pending', 'summary', v_summary, 'asked_at', now())
   WHERE id = p_request;
  PERFORM set_config('fira.approval_write', '', true);
  INSERT INTO ticket_comments (ticket_id, author_id, content)
  VALUES (v_req.ticket_id, auth.uid(), '**Canlıya çıkış için onay istiyorum.**' || E'\n\n' || v_summary);
  RETURN jsonb_build_object('asked', true, 'policy', v_policy);
END $$;
REVOKE ALL ON FUNCTION public.agent_ask_approval(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_ask_approval(uuid, text) TO authenticated;

-- A person answers. Who may: whoever asked for the work, the agent's owner, or an
-- admin of the team — never the agent itself. Refusals are raised without an ERRCODE
-- so the app shows them as written.
CREATE OR REPLACE FUNCTION public.ai_decide_approval(p_request uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_req  public.ai_work_requests;
  v_team uuid;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_out  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Oturum yok' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO v_req FROM ai_work_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'İstek bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  SELECT public.project_team(t.project_id) INTO v_team FROM tickets t WHERE t.id = v_req.ticket_id;
  IF v_uid = v_req.ai_user_id
     OR NOT (v_uid IS NOT DISTINCT FROM v_req.requested_by
             OR EXISTS (SELECT 1 FROM agents a WHERE a.profile_id = v_req.ai_user_id AND a.owner_id = v_uid)
             OR public.is_team_admin(v_team)) THEN
    RAISE EXCEPTION 'Bu onayı işi isteyen kişi, ajanın sahibi ya da takım yöneticisi verebilir.';
  END IF;
  IF v_req.status <> 'processing' THEN RAISE EXCEPTION 'Bu iş artık sürmüyor.'; END IF;
  IF (v_req.approval ->> 'status') IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Bekleyen bir onay isteği yok.'; END IF;
  v_out := v_req.approval || jsonb_strip_nulls(jsonb_build_object(
    'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    'decided_by', v_uid, 'decided_at', now(), 'note', v_note));
  PERFORM set_config('fira.approval_write', '1', true);
  UPDATE ai_work_requests SET approval = v_out WHERE id = p_request;
  PERFORM set_config('fira.approval_write', '', true);
  INSERT INTO ticket_comments (ticket_id, author_id, content)
  VALUES (v_req.ticket_id, v_uid,
          CASE WHEN p_approve THEN '**Canlıya çıkış onaylandı.**' ELSE '**Canlıya çıkış reddedildi.**' END || coalesce(E'\n\n' || v_note, ''));
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.ai_decide_approval(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_decide_approval(uuid, boolean, text) TO authenticated;

-- ========================================
-- 110_ai_passive_image_text.sql
-- ========================================
-- 110: Passive jobs · the text in a picture (#1c2ace54; phase 4, #0fc67dbb).
--
-- A passive job is not agent work: one call, no tools; in goes a picture, out comes what is
-- written in it, a line about what it shows, and its language. Decision (1 Oct 2026): these jobs
-- run on a person's own subscription, by their runner while it is idle ("donation"); nothing of
-- the kind runs on the server.
--
-- Two things have to say yes before a team's pictures are read:
--   ai_team_passive.image_text   the team's switch, set by its admins; OFF until somebody turns it on.
--                                A team's content does not go to a model by itself.
--   the runner's own settings    on the computer of the person who lends the subscription (runner.json).
--
-- There is no queue table and no trigger on uploads: the runner asks for the next picture that has
-- no result yet (agent_passive_next), and the row it gets in file_texts is its claim. A claim that
-- is not answered in ten minutes can be taken again; a picture that was tried three times is left alone.
--
-- file_texts.file_url is not a reference that keeps a file alive: admin_orphan_files does not
-- count it, and a row may outlive its file (it is small, and harmless).

CREATE TABLE IF NOT EXISTS public.ai_team_passive (
  team_id    UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  image_text BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.ai_team_passive_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.team_id := OLD.team_id; END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_team_passive_before_write ON public.ai_team_passive;
CREATE TRIGGER ai_team_passive_before_write BEFORE INSERT OR UPDATE ON public.ai_team_passive
  FOR EACH ROW EXECUTE FUNCTION public.ai_team_passive_before_write();
REVOKE ALL ON FUNCTION public.ai_team_passive_before_write() FROM public, anon;

ALTER TABLE public.ai_team_passive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_team_passive_select ON public.ai_team_passive;
CREATE POLICY ai_team_passive_select ON public.ai_team_passive FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
DROP POLICY IF EXISTS ai_team_passive_insert ON public.ai_team_passive;
CREATE POLICY ai_team_passive_insert ON public.ai_team_passive FOR INSERT TO authenticated
  WITH CHECK (public.is_team_admin(team_id));
DROP POLICY IF EXISTS ai_team_passive_update ON public.ai_team_passive;
CREATE POLICY ai_team_passive_update ON public.ai_team_passive FOR UPDATE TO authenticated
  USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
REVOKE ALL ON public.ai_team_passive FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_team_passive TO authenticated;

-- What was read from a picture. One row per file (its address as the attachment stores it).
CREATE TABLE IF NOT EXISTS public.file_texts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL CHECK (status IN ('processing', 'done', 'failed', 'skipped')),
  text        TEXT,          -- what is written in the picture, as it stands
  description TEXT,          -- one or two sentences on what the picture shows
  lang        TEXT,          -- the language of the text (tr, en, de, …), when there is text
  model       TEXT,
  attempts    INT NOT NULL DEFAULT 1,
  error       TEXT,
  claimed_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS file_texts_team_idx ON public.file_texts (team_id);

-- Read by the team; written only by the functions below (no write policy, no write grant).
ALTER TABLE public.file_texts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS file_texts_select ON public.file_texts;
CREATE POLICY file_texts_select ON public.file_texts FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
REVOKE ALL ON public.file_texts FROM anon, authenticated;
GRANT SELECT ON public.file_texts TO authenticated;

-- The next picture that has no result yet, claimed for the calling agent; NULL when there is none.
-- Only pictures of teams that turned the job on AND that the agent is a member of.
CREATE OR REPLACE FUNCTION public.agent_passive_next() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  c     record;
  v_id  uuid;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM agents a WHERE a.profile_id = v_uid) THEN
    RAISE EXCEPTION 'Pasif işleri yalnız bir ajan hesabı alabilir.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    SELECT a.file_url, a.file_name, a.ticket_id, t.title, p.name AS list_name, p.team_id
      FROM ticket_attachments a
      JOIN tickets t ON t.id = a.ticket_id AND t.archived_at IS NULL
      JOIN projects p ON p.id = t.project_id
      JOIN ai_team_passive s ON s.team_id = p.team_id AND s.image_text
      JOIN team_members m ON m.team_id = p.team_id AND m.user_id = v_uid
      LEFT JOIN file_texts ft ON ft.file_url = a.file_url
     WHERE lower(a.file_name) ~ '\.(png|jpe?g|webp|gif)$'
       AND (ft.id IS NULL
            OR (ft.attempts < 3 AND ft.status = 'processing' AND ft.claimed_at < now() - interval '10 minutes')
            OR (ft.attempts < 3 AND ft.status = 'failed' AND ft.finished_at < now() - interval '1 hour'))
     ORDER BY a.created_at DESC
     LIMIT 5
  LOOP
    v_id := NULL;
    INSERT INTO file_texts AS f (team_id, file_url, status, claimed_by, claimed_at, attempts)
    VALUES (c.team_id, c.file_url, 'processing', v_uid, now(), 1)
    ON CONFLICT (file_url) DO UPDATE
      SET status = 'processing', claimed_by = v_uid, claimed_at = now(), attempts = f.attempts + 1, error = NULL, finished_at = NULL
      WHERE f.attempts < 3
        AND ((f.status = 'processing' AND f.claimed_at < now() - interval '10 minutes') OR f.status = 'failed')
    RETURNING f.id INTO v_id;
    -- Another runner took it between the look and the claim: try the next one.
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'kind', 'image_text', 'file_url', c.file_url, 'file_name', c.file_name,
                                'ticket_id', c.ticket_id, 'ticket_title', c.title, 'list', c.list_name, 'team_id', c.team_id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.agent_passive_next() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_passive_next() TO authenticated;

-- The result of a claimed job. Only the agent that holds the claim can write it, and only once.
CREATE OR REPLACE FUNCTION public.agent_passive_save(p_id uuid, p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  UPDATE file_texts
     SET status = 'done',
         text = nullif(left(coalesce(p_result ->> 'text', ''), 20000), ''),
         description = nullif(left(btrim(coalesce(p_result ->> 'description', '')), 1000), ''),
         lang = nullif(left(lower(btrim(coalesce(p_result ->> 'lang', ''))), 8), ''),
         model = nullif(left(coalesce(p_result ->> 'model', ''), 80), ''),
         error = NULL, finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_passive_save(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_passive_save(uuid, jsonb) TO authenticated;

-- The job could not be done. `p_skip`: the picture is not something to read (not a picture after all,
-- too large, gone) and should not be tried again; otherwise it may be retried, three times in all.
CREATE OR REPLACE FUNCTION public.agent_passive_fail(p_id uuid, p_error text, p_skip boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  UPDATE file_texts
     SET status = CASE WHEN p_skip THEN 'skipped' ELSE 'failed' END,
         error = nullif(left(btrim(coalesce(p_error, '')), 500), ''), finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_passive_fail(uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_passive_fail(uuid, text, boolean) TO authenticated;

-- ========================================
-- 111_image_text_search.sql
-- ========================================
-- 111: The text read from pictures is found by search (#4c4b0344; phase 4, #0fc67dbb).
--
-- 110 keeps what was read from a picture beside the file (file_texts). A task is found by the words
-- in its pictures when that text counts as part of the task's own text for the palette.
--
-- The palette reads tickets.search_fold (the folded description, a generated column). The pictures'
-- text is NOT written into the ticket row: updating a ticket moves its updated_at, tells every open
-- client, and would look like "somebody changed this task" to a person who is editing it. It lives in
-- a table of its own, one row per task, kept by triggers:
--
--   ticket_image_folds(ticket_id, team_id, fold)   fold = the folded text + description of every read
--                                                  picture among the task's files
--
-- and palette_search joins it. The function below is 098's body with those two lines added.

ALTER TABLE public.file_texts ADD COLUMN IF NOT EXISTS search_fold text
  GENERATED ALWAYS AS (public.fira_fold(coalesce(text, '') || ' ' || coalesce(description, ''))) STORED;

CREATE TABLE IF NOT EXISTS public.ticket_image_folds (
  ticket_id UUID PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
  team_id   UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  fold      TEXT NOT NULL
);
ALTER TABLE public.ticket_image_folds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_image_folds_select ON public.ticket_image_folds;
CREATE POLICY ticket_image_folds_select ON public.ticket_image_folds FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
REVOKE ALL ON public.ticket_image_folds FROM anon, authenticated;
GRANT SELECT ON public.ticket_image_folds TO authenticated;

-- One task's row, from its files as they are now. A task with no read picture has no row.
CREATE OR REPLACE FUNCTION public.refresh_ticket_image_fold(p_ticket uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  v_fold text;
BEGIN
  SELECT public.project_team(t.project_id) INTO v_team FROM tickets t WHERE t.id = p_ticket;
  IF v_team IS NULL THEN RETURN; END IF;   -- the task is gone (its row goes with it)
  SELECT btrim(string_agg(DISTINCT ft.search_fold, ' ')) INTO v_fold
    FROM ticket_attachments a JOIN file_texts ft ON ft.file_url = a.file_url AND ft.status = 'done'
   WHERE a.ticket_id = p_ticket;
  IF coalesce(v_fold, '') = '' THEN
    DELETE FROM ticket_image_folds WHERE ticket_id = p_ticket;
  ELSE
    INSERT INTO ticket_image_folds (ticket_id, team_id, fold) VALUES (p_ticket, v_team, v_fold)
    ON CONFLICT (ticket_id) DO UPDATE SET fold = EXCLUDED.fold, team_id = EXCLUDED.team_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.refresh_ticket_image_fold(uuid) FROM public, anon, authenticated;

-- A picture was read (or its result changed): every task that has the file gets its row again.
CREATE OR REPLACE FUNCTION public.file_texts_refresh_folds() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r     record;
  v_url text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_url := OLD.file_url; ELSE v_url := NEW.file_url; END IF;
  FOR r IN SELECT DISTINCT a.ticket_id FROM ticket_attachments a WHERE a.file_url = v_url LOOP
    PERFORM public.refresh_ticket_image_fold(r.ticket_id);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS file_texts_refresh_folds ON public.file_texts;
CREATE TRIGGER file_texts_refresh_folds AFTER INSERT OR UPDATE OF status, text, description OR DELETE ON public.file_texts
  FOR EACH ROW EXECUTE FUNCTION public.file_texts_refresh_folds();
REVOKE ALL ON FUNCTION public.file_texts_refresh_folds() FROM public, anon, authenticated;

-- A file was added to a task or taken off it.
CREATE OR REPLACE FUNCTION public.ticket_attachments_refresh_fold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_ticket_image_fold(OLD.ticket_id);
  ELSIF EXISTS (SELECT 1 FROM file_texts ft WHERE ft.file_url = NEW.file_url AND ft.status = 'done') THEN
    PERFORM public.refresh_ticket_image_fold(NEW.ticket_id);   -- a copy of a file that was read before
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ticket_attachments_refresh_fold ON public.ticket_attachments;
CREATE TRIGGER ticket_attachments_refresh_fold AFTER INSERT OR DELETE ON public.ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION public.ticket_attachments_refresh_fold();
REVOKE ALL ON FUNCTION public.ticket_attachments_refresh_fold() FROM public, anon, authenticated;

-- What was read before this migration.
SELECT public.refresh_ticket_image_fold(x.ticket_id)
  FROM (SELECT DISTINCT a.ticket_id FROM ticket_attachments a JOIN file_texts ft ON ft.file_url = a.file_url AND ft.status = 'done') x;

create or replace function public.palette_search(p jsonb)
returns table (
  kind text, id uuid, title text, project_id uuid, project_name text, team_id uuid,
  icon text, icon_url text, status_name text, status_color text, score real, activity_at timestamptz
)
language plpgsql stable
security invoker
set search_path = public, extensions
as $$
declare
  split constant text := '\s+';
  v_terms   text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'terms') x where btrim(x) <> ''), '{}');
  v_not     text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'not') x where btrim(x) <> ''), '{}');
  v_phrases text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'phrases') x where btrim(x) <> ''), '{}');
  v_kinds   text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'kinds') x), array['ticket', 'project', 'page']);
  v_has     text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'has') x), '{}');
  v_assignee text := nullif(btrim(p->>'assignee'), '');
  v_creator  text := nullif(btrim(p->>'creator'), '');
  v_status  text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'status'), '')), split);
  v_tag     text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'tag'), '')), split);
  v_list    text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'list'), '')), split);
  v_team    text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'team'), '')), split);
  v_comment text := nullif(public.fira_fold(btrim(p->>'comment')), '');
  v_state    text := p->>'state';          -- open | done
  v_priority text := p->>'priority';       -- critical | high | medium | low | none
  v_due      text := p->>'due';            -- overdue | today | week | none
  v_after    timestamptz := (p->>'after')::timestamptz;       -- last activity at or after
  v_before   timestamptz := (p->>'before')::timestamptz;      -- last activity before
  v_on_from  timestamptz := (p->>'on_from')::timestamptz;     -- any activity in [on_from, on_to)
  v_on_to    timestamptz := (p->>'on_to')::timestamptz;
  v_cr_from  timestamptz := (p->>'created_from')::timestamptz;
  v_cr_to    timestamptz := (p->>'created_to')::timestamptz;
  v_limit    int := least(greatest(coalesce((p->>'limit')::int, 20), 1), 50);
  v_task_only boolean;
  v_dated    boolean := (p->>'after') is not null or (p->>'before') is not null;
  v_uid uuid := auth.uid();
  -- 098: kesin kapsam (görev penceresindeki bağlama çubuğu). Ad değil kimlik.
  v_project uuid := nullif(btrim(p->>'project_id'), '')::uuid;
  v_team_id uuid := nullif(btrim(p->>'team_id'), '')::uuid;
begin
  if v_status = '{}' or v_status = '{""}' then v_status := null; end if;
  if v_tag = '{}' or v_tag = '{""}' then v_tag := null; end if;
  if v_list = '{}' or v_list = '{""}' then v_list := null; end if;
  if v_team = '{}' or v_team = '{""}' then v_team := null; end if;
  -- Filters that only make sense for tasks: when one is set, lists and pages are not returned.
  v_task_only := v_assignee is not null or v_creator is not null or v_status is not null or v_tag is not null or v_list is not null
    or v_comment is not null or v_state is not null or v_priority is not null or v_due is not null
    or coalesce(array_length(v_has, 1), 0) > 0 or v_on_from is not null or v_cr_from is not null
    or v_project is not null;

  if 'ticket' = any(v_kinds) then
    return query
    with base as (
      select t.id, t.title, (t.search_fold || ' ' || coalesce(imf.fold, '')) as dfold, t.project_id, pr.name as pname, pr.team_id as tid,
             s.name as sname, s.color as scolor, s.category as scat, t.updated_at,
             -- The last comment matters only when a date filter uses it; otherwise it is
             -- looked up for the handful of rows that make the list (see below).
             case when v_dated
                  then greatest(t.updated_at, (select max(c.created_at) from ticket_comments c where c.ticket_id = t.id))
                  else t.updated_at end as act,
             t.created_at, t.created_by, t.priority, t.due_date
        from tickets t
        join projects pr on pr.id = t.project_id
        left join ticket_statuses s on s.id = t.status_id
        -- 111: what was read from the task's pictures counts as its text
        left join ticket_image_folds imf on imf.ticket_id = t.id
       where t.archived_at is null
         and (v_project is null or t.project_id = v_project)
         and (v_team_id is null or pr.team_id = v_team_id)
         and (v_list is null or public.fira_all_terms(v_list, pr.name) >= 0.8)
         and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_status is null or public.fira_all_terms(v_status, s.name) >= 0.8)
         and (v_state is null
              or (v_state = 'open' and coalesce(s.category, 'active') not in ('done', 'closed'))
              or (v_state = 'done' and s.category in ('done', 'closed')))
         and (v_priority is null or (v_priority = 'none' and t.priority is null) or t.priority::text = v_priority)
         and (v_due is null
              or (v_due = 'none' and t.due_date is null)
              or (v_due = 'overdue' and t.due_date < current_date and coalesce(s.category, 'active') not in ('done', 'closed'))
              or (v_due = 'today' and t.due_date = current_date)
              or (v_due = 'week' and t.due_date between current_date and current_date + 7))
         and (v_tag is null or exists (select 1 from ticket_tag_assignments a join tags g on g.id = a.tag_id
                                        where a.ticket_id = t.id and public.fira_all_terms(v_tag, g.name) >= 0.8))
         and (v_assignee is null
              or (v_assignee = '@me' and exists (select 1 from ticket_assignees a where a.ticket_id = t.id and a.user_id = v_uid))
              or (v_assignee = '@none' and not exists (select 1 from ticket_assignees a where a.ticket_id = t.id))
              or (v_assignee not in ('@me', '@none') and exists (
                    select 1 from ticket_assignees a join profiles pf on pf.id = a.user_id
                     where a.ticket_id = t.id
                       and public.fira_all_terms(regexp_split_to_array(public.fira_fold(v_assignee), split),
                                                 coalesce(pf.full_name, '') || ' ' || coalesce(pf.email, '')) >= 0.8)))
         and (v_creator is null
              or (v_creator = '@me' and t.created_by = v_uid)
              or (v_creator <> '@me' and exists (
                    select 1 from profiles pf where pf.id = t.created_by
                       and public.fira_all_terms(regexp_split_to_array(public.fira_fold(v_creator), split),
                                                 coalesce(pf.full_name, '') || ' ' || coalesce(pf.email, '')) >= 0.8)))
         and (v_comment is null or exists (select 1 from ticket_comments c where c.ticket_id = t.id
                                              and strpos(public.fira_fold(c.content), v_comment) > 0))
         and (not ('file' = any(v_has)) or exists (select 1 from ticket_attachments x where x.ticket_id = t.id))
         and (not ('comment' = any(v_has)) or exists (select 1 from ticket_comments x where x.ticket_id = t.id))
         and (not ('subtask' = any(v_has)) or exists (select 1 from tickets x where x.parent_id = t.id and x.archived_at is null))
         and (not ('link' = any(v_has)) or exists (select 1 from ticket_links x where x.ticket_id = t.id or x.linked_ticket_id = t.id))
         and (not ('due' = any(v_has)) or t.due_date is not null)
         and (not ('desc' = any(v_has)) or coalesce(btrim(t.description), '') <> '')
         and (v_cr_from is null or (t.created_at >= v_cr_from and t.created_at < v_cr_to))
         and (v_on_from is null
              or (t.created_at >= v_on_from and t.created_at < v_on_to)
              or exists (select 1 from ticket_activity a where a.ticket_id = t.id and a.created_at >= v_on_from and a.created_at < v_on_to)
              or exists (select 1 from ticket_comments c where c.ticket_id = t.id and c.created_at >= v_on_from and c.created_at < v_on_to))
    ), scored as (
      select b.*,
             (select case when count(*) = 0 then 1::real
                          when bool_and(q.s >= 0.8) then avg(q.s)::real
                          else 0::real end
                from (select greatest(public.fira_term_score(x, b.title),
                                      case when length(x) >= 3 and strpos(b.dfold, x) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) x) q) as sc
        from base b
       where (v_after is null or b.act >= v_after)
         and (v_before is null or b.act < v_before)
         and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(b.title), x) > 0)
         and not exists (select 1 from unnest(v_phrases) x
                          where strpos(public.fira_fold(b.title), x) = 0 and strpos(b.dfold, x) = 0)
    ), top as (
      select s.id, s.title, s.project_id, s.pname, s.tid, s.sname, s.scolor, s.sc, s.act, s.updated_at
        from scored s
       where s.sc > 0
       order by s.sc desc, s.act desc nulls last, s.updated_at desc nulls last
       limit v_limit
    )
    select 'ticket'::text, x.id, x.title, x.project_id, x.pname, x.tid, null::text, null::text, x.sname, x.scolor, x.sc,
           case when v_dated then x.act
                else greatest(x.updated_at, (select max(c.created_at) from ticket_comments c where c.ticket_id = x.id)) end
      from top x
     order by x.sc desc, 12 desc nulls last;
  end if;

  if v_task_only or (coalesce(array_length(v_terms, 1), 0) = 0 and coalesce(array_length(v_phrases, 1), 0) = 0) then
    return;
  end if;

  -- Lists carry no activity dates: a date filter leaves them out.
  if 'project' = any(v_kinds) and v_after is null and v_before is null then
    return query
    select 'project'::text, pr.id, pr.name, pr.id, pr.name, pr.team_id, pr.icon, pr.icon_url, null::text, null::text,
           public.fira_all_terms(v_terms, pr.name), null::timestamptz
      from projects pr
     where public.fira_all_terms(v_terms, pr.name) > 0
       and (v_team_id is null or pr.team_id = v_team_id)
       and not exists (select 1 from unnest(v_phrases) x where strpos(public.fira_fold(pr.name), x) = 0)
       and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(pr.name), x) > 0)
       and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
     order by 11 desc, pr.name
     limit least(v_limit, 8);
  end if;

  if 'page' = any(v_kinds) then
    return query
    select x.* from (
      select 'page'::text, pg.id, pg.title, pg.project_id, null::text, pg.team_id, null::text, null::text, null::text, null::text,
             (select case when count(*) = 0 then 1::real when bool_and(q.s >= 0.8) then avg(q.s)::real else 0::real end
                from (select greatest(public.fira_term_score(t, pg.title),
                                      case when length(t) >= 3 and strpos(pg.search_fold, t) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) t) q) as sc,
             pg.updated_at
        from pages pg
       where pg.archived_at is null
         and (v_team_id is null or pg.team_id = v_team_id)
         and (v_team is null or exists (select 1 from teams tm where tm.id = pg.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_after is null or pg.updated_at >= v_after)
         and (v_before is null or pg.updated_at < v_before)
         and not exists (select 1 from unnest(v_phrases) ph
                          where strpos(public.fira_fold(pg.title), ph) = 0 and strpos(pg.search_fold, ph) = 0)
         and not exists (select 1 from unnest(v_not) n where strpos(public.fira_fold(pg.title), n) > 0)
    ) x
     where x.sc > 0
     order by x.sc desc, x.updated_at desc
     limit least(v_limit, 8);
  end if;
end;
$$;

revoke all on function public.palette_search(jsonb) from public, anon;
grant execute on function public.palette_search(jsonb) to authenticated;

-- ========================================
-- 112_passive_usage.sql
-- ========================================
-- 112: What a passive job took (#2a6311d5; phase 4, #0fc67dbb).
--
-- Passive jobs are not runs: they have no row in ai_runs and never enter the agents' totals. What one
-- took is kept on its own result row, so the panel can say "n pictures read, so long, this much" apart
-- from the agents' work.
--
--   file_texts.ms        how long the call took
--   file_texts.cost_usd  its API equivalent (a comparison, not a charge: it runs on a subscription)
--
-- agent_passive_save takes both from the result it is given; an older runner that does not send them
-- leaves them empty.

ALTER TABLE public.file_texts ADD COLUMN IF NOT EXISTS ms INTEGER;
ALTER TABLE public.file_texts ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 4);

CREATE OR REPLACE FUNCTION public.agent_passive_save(p_id uuid, p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_ms   numeric;
  v_cost numeric;
BEGIN
  -- Numbers only when they are numbers; anything else is left out rather than refused.
  IF jsonb_typeof(p_result -> 'ms') = 'number' THEN v_ms := (p_result ->> 'ms')::numeric; END IF;
  IF jsonb_typeof(p_result -> 'cost_usd') = 'number' THEN v_cost := (p_result ->> 'cost_usd')::numeric; END IF;
  UPDATE file_texts
     SET status = 'done',
         text = nullif(left(coalesce(p_result ->> 'text', ''), 20000), ''),
         description = nullif(left(btrim(coalesce(p_result ->> 'description', '')), 1000), ''),
         lang = nullif(left(lower(btrim(coalesce(p_result ->> 'lang', ''))), 8), ''),
         model = nullif(left(coalesce(p_result ->> 'model', ''), 80), ''),
         ms = CASE WHEN v_ms IS NULL THEN NULL ELSE least(3600000, greatest(0, round(v_ms)))::int END,
         cost_usd = CASE WHEN v_cost IS NULL THEN NULL ELSE least(1000, greatest(0, v_cost)) END,
         error = NULL, finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_passive_save(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_passive_save(uuid, jsonb) TO authenticated;

-- ========================================
-- 113_ai_translations.sql
-- ========================================
-- 113: Passive jobs · translation of descriptions and comments (#fa4b05e9; phase 4, #0fc67dbb).
--
-- Each person says which languages they read and which one they want the rest translated into
-- (user_preferences, scope global: "reading": { "read": ["tr","en"], "to": "tr" }). A ticket's
-- description or a comment that is in none of a reader's languages gets a translation into that
-- reader's language, made by a runner as a passive job (110): one call, no tools.
--
-- Like the pictures, two things have to say yes:
--   ai_team_passive.translate    the team's switch, a switch of its own, OFF until an admin turns it on
--   the runner's own settings    on the computer of the person who lends the subscription
--
-- One row per (content, target language). The row carries the hash of the text it was made for:
--   * the text changes  -> its rows are deleted here (triggers), so the content is a job again;
--   * the reader's screen compares the hash with the text it is showing, so a translation that
--     arrived for an older text is never shown under a newer one (the two are fetched apart).
--
-- status: processing | done (text = the translation) | none (no translation needed: the text is in
-- a language every reader of that target reads; source_lang says which) | failed | skipped.
-- A 'none' row becomes a job again when a reader who does not read that language joins the target.
--
-- Nothing derived is written to tickets or ticket_comments (that would move updated_at, wake every
-- open client and raise "somebody else changed it" for the person editing).

ALTER TABLE public.ai_team_passive ADD COLUMN IF NOT EXISTS translate BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.content_translations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  ticket_id   UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  comment_id  UUID REFERENCES public.ticket_comments(id) ON DELETE CASCADE,   -- NULL: the ticket's description
  target_lang TEXT NOT NULL,
  source_hash TEXT NOT NULL,   -- sha256 (hex) of the text this row was made for
  source_lang TEXT,            -- the language the text is in, as the job found it
  status      TEXT NOT NULL CHECK (status IN ('processing', 'done', 'none', 'failed', 'skipped')),
  text        TEXT,            -- the translation (Markdown), when status = done
  model       TEXT,
  attempts    INT NOT NULL DEFAULT 1,
  error       TEXT,
  claimed_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ms          INTEGER,
  cost_usd    NUMERIC(10, 4)
);
CREATE UNIQUE INDEX IF NOT EXISTS content_translations_description_key ON public.content_translations (ticket_id, target_lang) WHERE comment_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS content_translations_comment_key ON public.content_translations (comment_id, target_lang) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_translations_ticket_idx ON public.content_translations (ticket_id);
CREATE INDEX IF NOT EXISTS content_translations_team_idx ON public.content_translations (team_id, finished_at);

-- Read by the team; written only by the functions below (no write policy, no write grant).
ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_translations_select ON public.content_translations;
CREATE POLICY content_translations_select ON public.content_translations FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL);
REVOKE ALL ON public.content_translations FROM anon, authenticated;
GRANT SELECT ON public.content_translations TO authenticated;

-- The text changed: what was made for the old text goes away.
CREATE OR REPLACE FUNCTION public.tickets_translations_stale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    DELETE FROM content_translations WHERE ticket_id = NEW.id AND comment_id IS NULL;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tickets_translations_stale ON public.tickets;
CREATE TRIGGER tickets_translations_stale AFTER UPDATE OF description ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_translations_stale();
REVOKE ALL ON FUNCTION public.tickets_translations_stale() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.comments_translations_stale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    DELETE FROM content_translations WHERE comment_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS comments_translations_stale ON public.ticket_comments;
CREATE TRIGGER comments_translations_stale AFTER UPDATE OF content ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_translations_stale();
REVOKE ALL ON FUNCTION public.comments_translations_stale() FROM public, anon, authenticated;

-- The languages a team's content is translated into, and for each the languages that need no
-- translation into it: those EVERY reader of that target reads (the target itself always).
-- A reader is a member of the team who said what they read (an agent's account has no such
-- preference unless somebody uses the screen as that account, and then it reads like anybody).
-- Internal: who reads what is each person's own preference; only the sets leave this function,
-- and only through agent_translate_next.
CREATE OR REPLACE FUNCTION public.ai_translation_targets(p_team uuid) RETURNS TABLE (target text, skip text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH readers AS (
    SELECT tm.user_id AS uid,
           lower(up.prefs #>> '{reading,to}') AS target,
           ARRAY(SELECT lower(x) FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(up.prefs #> '{reading,read}') = 'array' THEN up.prefs #> '{reading,read}' ELSE '[]'::jsonb END) x
                  WHERE x ~* '^[a-z]{2,3}$') AS reads
      FROM team_members tm
      JOIN user_preferences up ON up.user_id = tm.user_id AND up.scope = 'global'
     WHERE tm.team_id = p_team AND up.prefs #>> '{reading,to}' ~* '^[a-z]{2,3}$'
  )
  SELECT g.target,
         ARRAY(SELECT l FROM readers r, unnest(r.reads || ARRAY[r.target]) l
                WHERE r.target = g.target GROUP BY l HAVING count(DISTINCT r.uid) = g.n ORDER BY l)
    FROM (SELECT r.target, count(*) AS n FROM readers r GROUP BY r.target) g
$$;
REVOKE ALL ON FUNCTION public.ai_translation_targets(uuid) FROM public, anon, authenticated;

-- The next text that has no translation yet into a language somebody of its team reads in, claimed
-- for the calling agent; NULL when there is none. Only teams that turned the job on AND that the
-- agent is a member of. Newest text first.
CREATE OR REPLACE FUNCTION public.agent_translate_next() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  c      record;
  v_id   uuid;
  v_hash text;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM agents a WHERE a.profile_id = v_uid) THEN
    RAISE EXCEPTION 'Pasif işleri yalnız bir ajan hesabı alabilir.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    WITH teams_on AS (
      SELECT m.team_id FROM team_members m
        JOIN ai_team_passive s ON s.team_id = m.team_id AND s.translate
       WHERE m.user_id = v_uid
    ), targets AS (
      SELECT o.team_id, g.target, g.skip FROM teams_on o CROSS JOIN LATERAL ai_translation_targets(o.team_id) g
    ), contents AS (
      SELECT t.id AS ticket_id, NULL::uuid AS comment_id, t.description AS body, t.title, p.name AS list_name, p.team_id, t.updated_at AS at
        FROM tickets t
        JOIN projects p ON p.id = t.project_id
        JOIN teams_on o ON o.team_id = p.team_id
       WHERE t.archived_at IS NULL AND length(btrim(coalesce(t.description, ''))) >= 2
      UNION ALL
      SELECT cm.ticket_id, cm.id, cm.content, t.title, p.name, p.team_id, coalesce(cm.edited_at, cm.created_at)
        FROM ticket_comments cm
        JOIN tickets t ON t.id = cm.ticket_id AND t.archived_at IS NULL
        JOIN projects p ON p.id = t.project_id
        JOIN teams_on o ON o.team_id = p.team_id
       WHERE length(btrim(coalesce(cm.content, ''))) >= 2
    )
    SELECT k.ticket_id, k.comment_id, k.body, k.title, k.list_name, k.team_id, g.target, g.skip, x.id AS row_id
      FROM contents k
      JOIN targets g ON g.team_id = k.team_id
      LEFT JOIN content_translations x
             ON x.ticket_id = k.ticket_id AND x.comment_id IS NOT DISTINCT FROM k.comment_id AND x.target_lang = g.target
     WHERE x.id IS NULL
        OR (x.attempts < 3 AND x.status = 'processing' AND x.claimed_at < now() - interval '10 minutes')
        OR (x.attempts < 3 AND x.status = 'failed' AND x.finished_at < now() - interval '1 hour')
        OR (x.status = 'none' AND x.source_lang IS NOT NULL AND NOT (x.source_lang = ANY (g.skip)))
     ORDER BY k.at DESC
     LIMIT 5
  LOOP
    v_hash := encode(sha256(convert_to(c.body, 'UTF8')), 'hex');
    v_id := NULL;
    IF c.row_id IS NULL THEN
      BEGIN
        INSERT INTO content_translations (team_id, ticket_id, comment_id, target_lang, source_hash, status, claimed_by)
        VALUES (c.team_id, c.ticket_id, c.comment_id, c.target, v_hash, 'processing', v_uid)
        RETURNING id INTO v_id;
      EXCEPTION WHEN unique_violation THEN v_id := NULL;   -- another runner took it between the look and the claim
      END;
    ELSE
      UPDATE content_translations x
         SET status = 'processing', claimed_by = v_uid, claimed_at = now(), source_hash = v_hash,
             attempts = CASE WHEN x.status = 'none' THEN 1 ELSE x.attempts + 1 END,
             error = NULL, finished_at = NULL, text = NULL
       WHERE x.id = c.row_id
         AND (x.status = 'none'
              OR (x.attempts < 3 AND (x.status = 'failed' OR (x.status = 'processing' AND x.claimed_at < now() - interval '10 minutes'))))
      RETURNING x.id INTO v_id;
    END IF;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'kind', 'translate',
                                'field', CASE WHEN c.comment_id IS NULL THEN 'description' ELSE 'comment' END,
                                'target', c.target, 'skip', to_jsonb(c.skip), 'text', c.body,
                                'ticket_id', c.ticket_id, 'comment_id', c.comment_id, 'ticket_title', c.title,
                                'list', c.list_name, 'team_id', c.team_id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.agent_translate_next() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_translate_next() TO authenticated;

-- The result of a claimed job. A result without text says "no translation needed" (status none).
-- Only the agent that holds the claim can write it, and only once. A job whose text changed
-- meanwhile has no row any more (the trigger above) and is refused.
CREATE OR REPLACE FUNCTION public.agent_translate_save(p_id uuid, p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_text text := nullif(left(coalesce(p_result ->> 'text', ''), 60000), '');
  v_ms   numeric;
  v_cost numeric;
BEGIN
  IF jsonb_typeof(p_result -> 'ms') = 'number' THEN v_ms := (p_result ->> 'ms')::numeric; END IF;
  IF jsonb_typeof(p_result -> 'cost_usd') = 'number' THEN v_cost := (p_result ->> 'cost_usd')::numeric; END IF;
  UPDATE content_translations
     SET status = CASE WHEN v_text IS NULL THEN 'none' ELSE 'done' END,
         text = v_text,
         source_lang = nullif(left(lower(btrim(coalesce(p_result ->> 'lang', ''))), 8), ''),
         model = nullif(left(coalesce(p_result ->> 'model', ''), 80), ''),
         ms = CASE WHEN v_ms IS NULL THEN NULL ELSE least(3600000, greatest(0, round(v_ms)))::int END,
         cost_usd = CASE WHEN v_cost IS NULL THEN NULL ELSE least(1000, greatest(0, v_cost)) END,
         error = NULL, finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_translate_save(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_translate_save(uuid, jsonb) TO authenticated;

-- The job could not be done. `p_skip`: the text is not something to translate (too long) and
-- should not be tried again; otherwise it may be retried, three times in all.
CREATE OR REPLACE FUNCTION public.agent_translate_fail(p_id uuid, p_error text, p_skip boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  UPDATE content_translations
     SET status = CASE WHEN p_skip THEN 'skipped' ELSE 'failed' END,
         error = nullif(left(btrim(coalesce(p_error, '')), 500), ''), finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_translate_fail(uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_translate_fail(uuid, text, boolean) TO authenticated;
