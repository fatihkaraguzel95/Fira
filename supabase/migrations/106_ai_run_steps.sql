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
