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
