-- 102: Claiming and closing a request, for the agent's own tool (#933a6af6;
-- phase 1 of the Claude–Fira integration, #a5b096a1).
--
-- The bridge script did both with psql as the superuser. The same two steps as
-- functions the agent calls with its own session: they run with the CALLER'S
-- rights (no SECURITY DEFINER), so RLS still decides what the agent may touch,
-- and each answers with what happened instead of failing silently.
--
-- Additive only.

-- pending → processing, once. The answer says why not when it is refused, so
-- the tool can tell "someone cancelled it" from "the ticket was finished
-- meanwhile" from "another listener of mine took it".
CREATE OR REPLACE FUNCTION public.agent_claim(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r        record;
  v_ticket uuid;
BEGIN
  SELECT q.status, q.ticket_id, q.ai_user_id, s.category
    INTO r
    FROM public.ai_work_requests q
    JOIN public.tickets t ON t.id = q.ticket_id
    LEFT JOIN public.ticket_statuses s ON s.id = t.status_id
   WHERE q.id = p_request;
  IF NOT FOUND OR r.ai_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not-found');
  END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'request-' || r.status, 'ticket_id', r.ticket_id);
  END IF;
  IF coalesce(r.category, '') IN ('done', 'closed') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'ticket-' || r.category, 'ticket_id', r.ticket_id);
  END IF;

  -- The condition is repeated in the UPDATE: of two listeners racing for the
  -- same row only one finds it still pending.
  UPDATE public.ai_work_requests
     SET status = 'processing'
   WHERE id = p_request AND status = 'pending'
  RETURNING ticket_id INTO v_ticket;
  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'taken', 'ticket_id', r.ticket_id);
  END IF;
  PERFORM public.agent_seen();
  RETURN jsonb_build_object('claimed', true, 'ticket_id', v_ticket);
END $$;
REVOKE ALL ON FUNCTION public.agent_claim(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_claim(uuid) TO authenticated;

-- processing → done | failed. A request that was cancelled meanwhile (the
-- assignment was removed) stays cancelled; the answer carries the status the
-- row really has, so the tool reports "it was stopped" instead of "done".
CREATE OR REPLACE FUNCTION public.agent_finish(p_request uuid, p_status text, p_detail text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF p_status NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'Durum done ya da failed olmalı' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.ai_work_requests
     SET status = p_status, detail = nullif(btrim(coalesce(p_detail, '')), '')
   WHERE id = p_request AND ai_user_id = auth.uid() AND status = 'processing'
  RETURNING status INTO v_status;
  IF v_status IS NOT NULL THEN
    RETURN jsonb_build_object('finished', true, 'status', v_status);
  END IF;
  SELECT status INTO v_status FROM public.ai_work_requests WHERE id = p_request AND ai_user_id = auth.uid();
  RETURN jsonb_build_object('finished', false, 'status', coalesce(v_status, 'not-found'));
END $$;
REVOKE ALL ON FUNCTION public.agent_finish(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_finish(uuid, text, text) TO authenticated;
