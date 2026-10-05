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
