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
