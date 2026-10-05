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
