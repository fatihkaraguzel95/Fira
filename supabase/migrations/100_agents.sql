-- 100: Agent identity and the assignment trigger (#cb43ae36).
-- Phase 1 of the Claude–Fira integration (#a5b096a1; decisions on #d30fc029, 1 Oct 2026).
--
-- Until now an AI account was just a profile with is_ai, and the only way to
-- hand it work was the "Claude'a yaptır" button (059). Two changes:
--
--   1. `agents`: every AI account belongs to a person ("whose Claude") and
--      carries its own settings. One row per AI profile.
--   2. Assigning a ticket to an agent starts the work (a pending row in
--      ai_work_requests, same queue as the button); removing the assignment
--      closes it at once (pending or processing → cancelled).
--
-- Additive only: no existing column, policy or function changes, so the
-- previous frontend keeps working and a rollback is frontend-only.

-- ── Agents ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE, -- the AI account
  owner_id       UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,       -- whose agent it is
  assign_trigger BOOLEAN NOT NULL DEFAULT TRUE,   -- assigning a ticket starts the work
  poll_seconds   INTEGER NOT NULL DEFAULT 300 CHECK (poll_seconds BETWEEN 30 AND 3600), -- fallback poll of the queue
  settings       JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- grows by addition (passive jobs, languages, …)
  runner         JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- what the listener last reported about itself
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agents_owner_idx ON public.agents(owner_id);

-- updated_at follows the settings, not the heartbeat.
DROP TRIGGER IF EXISTS agents_updated_at ON public.agents;
CREATE TRIGGER agents_updated_at
  BEFORE UPDATE OF owner_id, assign_trigger, poll_seconds, settings ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
-- Read: whoever can see the AI account (team mates), its owner, system admins.
-- No write policies: every change goes through the functions below.
DROP POLICY IF EXISTS agents_select ON public.agents;
CREATE POLICY agents_select ON public.agents FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.can_see_profile(profile_id) OR public.is_system_admin());
GRANT SELECT ON public.agents TO authenticated;

-- Every existing AI account becomes an agent. The owner is set per installation
-- (agent_set_owner), like profiles.is_admin — not from a migration.
INSERT INTO public.agents (profile_id)
SELECT p.id FROM public.profiles p WHERE p.is_ai
ON CONFLICT (profile_id) DO NOTHING;

-- Owner (or a system admin) changes the settings. Unknown keys are ignored;
-- `settings` is merged key by key.
CREATE OR REPLACE FUNCTION public.agent_update_settings(p_agent uuid, p_patch jsonb)
RETURNS public.agents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.agents;
BEGIN
  SELECT * INTO v FROM public.agents WHERE id = p_agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ajan bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT (coalesce(v.owner_id = auth.uid(), false) OR public.is_system_admin()) THEN
    RAISE EXCEPTION 'Ajanın ayarlarını yalnız sahibi değiştirebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.agents SET
    assign_trigger = coalesce((p_patch ->> 'assign_trigger')::boolean, assign_trigger),
    -- GREATEST/LEAST skip NULLs, so an absent key must not reach them (it would read as 30).
    poll_seconds   = CASE WHEN (p_patch ->> 'poll_seconds') IS NULL THEN poll_seconds
                          ELSE least(3600, greatest(30, (p_patch ->> 'poll_seconds')::int)) END,
    settings       = CASE WHEN jsonb_typeof(p_patch -> 'settings') = 'object' THEN settings || (p_patch -> 'settings') ELSE settings END
  WHERE id = p_agent
  RETURNING * INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.agent_update_settings(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_update_settings(uuid, jsonb) TO authenticated;

-- System admin binds an agent to a person.
CREATE OR REPLACE FUNCTION public.agent_set_owner(p_agent uuid, p_owner uuid)
RETURNS public.agents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.agents;
BEGIN
  PERFORM public.admin_guard();
  UPDATE public.agents SET owner_id = p_owner WHERE id = p_agent RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ajan bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.agent_set_owner(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_set_owner(uuid, uuid) TO authenticated;

-- The agent reports that its listener is alive and reads back the settings it
-- has to follow (the fallback poll interval is changed from the panel).
CREATE OR REPLACE FUNCTION public.agent_seen(p_runner jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.agents;
BEGIN
  UPDATE public.agents
     SET last_seen_at = now(),
         runner = CASE WHEN jsonb_typeof(p_runner) = 'object' THEN p_runner ELSE runner END
   WHERE profile_id = auth.uid()
  RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu hesap bir ajan değil' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN jsonb_build_object('agent_id', v.id, 'assign_trigger', v.assign_trigger, 'poll_seconds', v.poll_seconds, 'settings', v.settings);
END $$;
REVOKE ALL ON FUNCTION public.agent_seen(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_seen(jsonb) TO authenticated;

-- ── Queue: how a request started, and when it was picked up / closed ─────────
ALTER TABLE public.ai_work_requests
  ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'button' CHECK (source IN ('button', 'assign')),
  ADD COLUMN IF NOT EXISTS claimed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- Stamped here so every path (the button, the bridge script, a future runner)
-- leaves the same trace: pending → processing = claimed, any terminal state = finished.
CREATE OR REPLACE FUNCTION public.ai_work_stamp()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'processing' AND OLD.status = 'pending' THEN
    NEW.claimed_at := now();
  ELSIF NEW.status IN ('done', 'failed', 'cancelled') AND OLD.status IN ('pending', 'processing') THEN
    NEW.finished_at := now();
  ELSIF NEW.status = 'pending' AND OLD.status = 'processing' THEN
    NEW.claimed_at := NULL;   -- handed back to the queue
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ai_work_stamp() FROM public, anon;

DROP TRIGGER IF EXISTS ai_work_stamp ON public.ai_work_requests;
CREATE TRIGGER ai_work_stamp
  BEFORE UPDATE OF status ON public.ai_work_requests
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_stamp();

-- ── Assignment starts the work, removing it closes the work ──────────────────
-- Starts only when a person assigns the agent directly (a write to
-- /ticket_assignees). Assignments made inside a function (copy_ticket,
-- move_ticket, import_bundle, recurrence_spawn, merge_profile) do not start
-- anything: copying a ticket must not put an agent to work on the copy.
-- The agent assigning itself is not a hand-off either.
--
-- Removal by anyone but the agent itself cancels the open request, whatever
-- started it. The agent dropping its own assignment is the normal end of a job
-- (it hands the ticket back for review) and must not cancel its own request.
CREATE OR REPLACE FUNCTION public.ai_work_on_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_agent public.agents;
  v_cat   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_agent FROM public.agents WHERE profile_id = NEW.user_id;
    IF NOT FOUND OR NOT v_agent.assign_trigger THEN RETURN NEW; END IF;
    IF v_actor IS NOT DISTINCT FROM NEW.user_id THEN RETURN NEW; END IF;
    IF coalesce(current_setting('request.path', true), '') !~ '/ticket_assignees$' THEN RETURN NEW; END IF;
    SELECT s.category INTO v_cat
      FROM public.tickets t LEFT JOIN public.ticket_statuses s ON s.id = t.status_id
     WHERE t.id = NEW.ticket_id;
    IF v_cat IN ('done', 'closed') THEN RETURN NEW; END IF;
    -- One open request per ticket (059): the button writes its own row first,
    -- so the assignment it makes afterwards lands here as a no-op.
    INSERT INTO public.ai_work_requests (ticket_id, requested_by, ai_user_id, status, source)
    VALUES (NEW.ticket_id, v_actor, NEW.user_id, 'pending', 'assign')
    ON CONFLICT (ticket_id) WHERE status IN ('pending', 'processing') DO NOTHING;
    RETURN NEW;
  END IF;

  IF v_actor IS NOT DISTINCT FROM OLD.user_id THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE profile_id = OLD.user_id) THEN RETURN OLD; END IF;
  UPDATE public.ai_work_requests
     SET status = 'cancelled',
         detail = coalesce(detail, '') || CASE WHEN coalesce(detail, '') = '' THEN '' ELSE ' · ' END || 'atama kaldırıldı, iş durduruldu',
         updated_at = now()
   WHERE ticket_id = OLD.ticket_id AND ai_user_id = OLD.user_id AND status IN ('pending', 'processing');
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.ai_work_on_assignment() FROM public, anon;

DROP TRIGGER IF EXISTS assignees_ai_work ON public.ticket_assignees;
CREATE TRIGGER assignees_ai_work
  AFTER INSERT OR DELETE ON public.ticket_assignees
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_on_assignment();
