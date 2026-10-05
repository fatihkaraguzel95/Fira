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
