-- 115: First-pass approval (#fb2c5a3a; phase 5, #e7182ed8).
--
-- What is measured is the result, not the tokens: of the tasks an agent brought to review, how many
-- were closed without coming back.
--
-- For every task the agent delivered in the period (a run that ended `done`):
--   first_pass   delivered once in all, and the task is complete now (a done or closed status that
--                is not "cancelled")
--   returned     the agent delivered it more than once: it came back at least once (a second
--                request on the same task is how work comes back to an agent)
--   waiting      delivered once, the task is still open: in review; not counted either way
--   other        delivered once and the task is cancelled, or the caller cannot see the task
--
-- The rate the screen shows is first_pass / (first_pass + returned).
--
-- Deliveries are counted over all time, not only inside the period: a task delivered last week and
-- delivered again this week came back, whichever week is looked at.
--
-- Runs of deleted tasks carry no task id and are left out. The function runs as the caller: which
-- runs and which tasks are counted is RLS's word, as in the panel's own list.

CREATE OR REPLACE FUNCTION public.agent_first_pass(
  p_since timestamptz DEFAULT NULL, p_until timestamptz DEFAULT NULL, p_agent uuid DEFAULT NULL, p_team uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH picked AS (
    SELECT DISTINCT r.ticket_id, r.agent_id
      FROM ai_runs r
     WHERE r.outcome = 'done' AND r.ticket_id IS NOT NULL
       AND (p_since IS NULL OR r.started_at >= p_since)
       AND (p_until IS NULL OR r.started_at < p_until)
       AND (p_agent IS NULL OR r.agent_id = p_agent)
       AND (p_team IS NULL OR r.team_id = p_team)
  ), told AS (
    SELECT (SELECT count(*) FROM ai_runs a WHERE a.ticket_id = p.ticket_id AND a.agent_id = p.agent_id AND a.outcome = 'done') AS deliveries,
           s.category, coalesce(s.is_cancelled, false) AS cancelled, t.id IS NULL AS hidden
      FROM picked p
      LEFT JOIN tickets t ON t.id = p.ticket_id
      LEFT JOIN ticket_statuses s ON s.id = t.status_id
  )
  SELECT jsonb_build_object(
    'delivered',  count(*),
    'first_pass', count(*) FILTER (WHERE deliveries = 1 AND NOT hidden AND NOT cancelled AND category IN ('done', 'closed')),
    'returned',   count(*) FILTER (WHERE deliveries > 1),
    'waiting',    count(*) FILTER (WHERE deliveries = 1 AND NOT hidden AND NOT cancelled AND coalesce(category, '') NOT IN ('done', 'closed')),
    'other',      count(*) FILTER (WHERE deliveries = 1 AND (hidden OR cancelled)))
    FROM told
$$;
REVOKE ALL ON FUNCTION public.agent_first_pass(timestamptz, timestamptz, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_first_pass(timestamptz, timestamptz, uuid, uuid) TO authenticated;
