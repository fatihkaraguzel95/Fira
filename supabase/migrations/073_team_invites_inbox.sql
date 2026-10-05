-- Uygulama içinden takım daveti (#4B5442B6)
--
-- Bugüne kadar davet = e-posta + link: yönetici bağlantıyı kopyalayıp başka bir
-- kanaldan yolluyordu. İstek: Fira'yı zaten kullanan kişilerden çoklu seçimle
-- davet göndermek, davetin kişinin **gelen kutusuna** düşmesi ve daveti henüz
-- kabul etmeyenlerin üye listesinde "davet edildi" olarak görünmesi.
--
-- Üç parça:
--  1) Aday arama (profiles herkese açık değil — 052 `can_see_profile`): yalnız
--     takım yöneticisine, yalnız hesabı olan kişiler, takımda olanlar hariç.
--  2) `invite_users_to_team`: seçilenlere bekleyen davet + gelen kutusu satırı.
--  3) `user_notifications` artık göreve bağlı olmayan satır da taşıyabiliyor
--     (activity_id / ticket_id nullable, yeni `team_id` + `invitation_id`).

-- ── 1) Kutu satırı göreve bağlı olmak zorunda değil ──────────────────────────
ALTER TABLE public.user_notifications ALTER COLUMN activity_id DROP NOT NULL;
ALTER TABLE public.user_notifications ALTER COLUMN ticket_id  DROP NOT NULL;
ALTER TABLE public.user_notifications ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.user_notifications ADD COLUMN IF NOT EXISTS invitation_id uuid REFERENCES public.team_invitations(id) ON DELETE CASCADE;

ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_event_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_event_check
  CHECK (event IN ('assigned', 'comment', 'status', 'subtask', 'file', 'team_invite'));

-- Görev satırı hâlâ göreve bağlı; davet satırı davete bağlı.
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_shape_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_shape_check
  CHECK ((event = 'team_invite' AND invitation_id IS NOT NULL AND ticket_id IS NULL)
      OR (event <> 'team_invite' AND ticket_id IS NOT NULL));

-- Aynı davet aynı kişiye iki satır olmasın (UNIQUE(user_id, activity_id) NULL'da çalışmaz).
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_invitation_idx
  ON public.user_notifications(user_id, invitation_id) WHERE invitation_id IS NOT NULL;

-- ── 2) Davet edilebilecek kişiler ────────────────────────────────────────────
-- Yönetici dışında kimse çağıramaz; içe aktarmayla açılmış (hesapsız) profiller
-- ve takımda olanlar listelenmez. `invited` = bekleyen daveti var.
CREATE OR REPLACE FUNCTION public.team_invite_candidates(p_team uuid, p_query text DEFAULT '')
RETURNS TABLE (id uuid, full_name text, email text, avatar_url text, invited boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q text := '%' || lower(trim(coalesce(p_query, ''))) || '%';
BEGIN
  IF NOT public.is_team_admin(p_team) THEN RAISE EXCEPTION 'Bu işlem için yetkiniz yok'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.email, p.avatar_url,
         EXISTS (
           SELECT 1 FROM team_invitations i
            WHERE i.team_id = p_team AND i.status = 'pending'
              AND lower(i.email) = lower(p.email)
              AND (i.expires_at IS NULL OR i.expires_at > now())
         ) AS invited
    FROM profiles p
   WHERE p.source = 'account'
     AND p.email IS NOT NULL
     AND coalesce(p.is_ai, false) = false          -- yapay zekâ üyesi davet edilmez
     AND p.id <> auth.uid()
     AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = p_team AND m.user_id = p.id)
     AND (q = '%%' OR lower(coalesce(p.full_name, '')) LIKE q OR lower(p.email) LIKE q)
   ORDER BY coalesce(p.full_name, p.email)
   LIMIT 50;
END $$;

REVOKE ALL ON FUNCTION public.team_invite_candidates(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.team_invite_candidates(uuid, text) TO authenticated;

-- ── 3) Toplu davet ───────────────────────────────────────────────────────────
-- Seçilen her kişi için bekleyen bir davet (varsa yenisi açılmaz) ve gelen
-- kutusuna bir satır. Zaten üye olan atlanır. Dönüş: { invited, skipped }.
CREATE OR REPLACE FUNCTION public.invite_users_to_team(p_team uuid, p_users uuid[], p_role text DEFAULT 'member')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_email text;
  v_inv team_invitations;
  v_invited int := 0;
  v_skipped int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Önce giriş yapmalısın'; END IF;
  IF NOT public.is_team_admin(p_team) THEN RAISE EXCEPTION 'Bu işlem için yetkiniz yok'; END IF;
  IF p_role NOT IN ('admin', 'member', 'viewer') THEN RAISE EXCEPTION 'Geçersiz rol'; END IF;
  IF p_role = 'admin' AND public.team_role(p_team) <> 'owner' THEN
    RAISE EXCEPTION 'Yönetici atamayı yalnızca takım sahibi yapabilir';
  END IF;
  IF coalesce(array_length(p_users, 1), 0) = 0 THEN RETURN jsonb_build_object('invited', 0, 'skipped', 0); END IF;
  IF array_length(p_users, 1) > 50 THEN RAISE EXCEPTION 'Tek seferde en çok 50 kişi davet edilebilir'; END IF;

  FOREACH v_user IN ARRAY p_users LOOP
    SELECT email INTO v_email FROM profiles WHERE id = v_user AND source = 'account';
    IF v_email IS NULL
       OR EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = p_team AND m.user_id = v_user) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_inv FROM team_invitations
     WHERE team_id = p_team AND status = 'pending' AND lower(email) = lower(v_email)
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO team_invitations (team_id, email, invited_by, role)
      VALUES (p_team, lower(v_email), auth.uid(), p_role)
      RETURNING * INTO v_inv;
    END IF;

    INSERT INTO user_notifications (user_id, team_id, invitation_id, event, actor_id, value, ticket_title)
    SELECT v_user, p_team, v_inv.id, 'team_invite', auth.uid(), p_role, t.name
      FROM teams t WHERE t.id = p_team
    ON CONFLICT DO NOTHING;

    v_invited := v_invited + 1;
  END LOOP;

  RETURN jsonb_build_object('invited', v_invited, 'skipped', v_skipped);
END $$;

REVOKE ALL ON FUNCTION public.invite_users_to_team(uuid, uuid[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.invite_users_to_team(uuid, uuid[], text) TO authenticated;

-- ── 4) Karar verilen davet kutudan düşer ─────────────────────────────────────
-- Kabul/ret sonrası satırın düğmeleri anlamsız kalıyordu; kayıt zaten üyelik
-- listesinde (ya da davet listesinde) duruyor.
CREATE OR REPLACE FUNCTION public.accept_invitation_by_id(p_id uuid) RETURNS teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv team_invitations; t teams;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Önce giriş yapmalısın'; END IF;
  SELECT * INTO inv FROM team_invitations
   WHERE id = p_id AND status = 'pending' AND lower(email) = lower(auth.email())
     AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RAISE EXCEPTION 'Davet bulunamadı'; END IF;
  INSERT INTO team_members (team_id, user_id, role) VALUES (inv.team_id, auth.uid(), inv.role)
    ON CONFLICT (team_id, user_id) DO NOTHING;
  UPDATE team_invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   WHERE id = inv.id;
  DELETE FROM user_notifications WHERE invitation_id = inv.id AND user_id = auth.uid();
  SELECT * INTO t FROM teams WHERE id = inv.team_id;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE team_invitations SET status = 'declined'
   WHERE id = p_id AND status = 'pending' AND lower(email) = lower(auth.email());
  DELETE FROM user_notifications WHERE invitation_id = p_id AND user_id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.accept_invitation_by_id(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation_by_id(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO authenticated;

-- Davet iptal edilirse (revoke) kutudaki satır da gitsin.
CREATE OR REPLACE FUNCTION public.invitations_drop_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    DELETE FROM user_notifications WHERE invitation_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS team_invitations_drop_notification ON public.team_invitations;
CREATE TRIGGER team_invitations_drop_notification
  AFTER UPDATE OF status ON public.team_invitations
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.invitations_drop_notification();
