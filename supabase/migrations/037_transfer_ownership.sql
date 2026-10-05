-- 037: transfer team ownership (only the current owner; target must already be a member). Old owner becomes admin.
CREATE OR REPLACE FUNCTION public.transfer_team_ownership(p_team UUID, p_user UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Oturum yok'; END IF;
  IF public.team_role(p_team) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Yalnızca takım sahibi devredebilir' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_user = me THEN RAISE EXCEPTION 'Zaten sahipsiniz'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = p_team AND user_id = p_user) THEN RAISE EXCEPTION 'Hedef kişi bu takımın üyesi değil'; END IF;
  UPDATE team_members SET role = 'admin' WHERE team_id = p_team AND user_id = me;
  UPDATE team_members SET role = 'owner' WHERE team_id = p_team AND user_id = p_user;
END $$;
GRANT EXECUTE ON FUNCTION public.transfer_team_ownership(UUID, UUID) TO authenticated;
