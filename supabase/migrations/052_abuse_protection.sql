-- 052: Kötüye kullanım koruması ve profil görünürlüğü
--
-- Siber güvenlik epiği, madde 13 (oran sınırlama / kötüye kullanım) ve madde 7'nin
-- (RLS denetimi) veritabanı tarafı.
--
--  1) profiles SELECT artık herkese açık değil: kendin, aynı takımda olduğun kişiler
--     ve takımlarındaki görevlerde geçen (içe aktarılmış) kişiler. Başka takımların
--     e-posta adresleri görünmez. Tek kalan `USING (true)` politikası system_settings
--     okumasıydı; o bilinçli (duyuru/bakım metni herkese).
--  2) join_team_by_code: kod denemeleri sınırlı (15 dakikada 5 hatalı deneme),
--     kod en az 8 karakter. Kodlar zaten 10 karakter.
--  3) team_invitations: süresi olmayan davet kalmasın (varsayılan 14 gün); accept_*
--     zaten pending + süre kontrolü yapıyor ve daveti tek seferlik kapatıyor.

-- ── 1) Profil görünürlüğü ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_see_profile(p_profile uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_profile = auth.uid()
      OR EXISTS (
           SELECT 1 FROM public.team_members me
           JOIN public.team_members them ON them.team_id = me.team_id
           WHERE me.user_id = auth.uid() AND them.user_id = p_profile
         )
      -- İçe aktarılmış (hesabı olmayan) kişiler takım üyesi değildir; görevlerde
      -- geçtikleri takımların üyeleri onları görebilmeli.
      OR EXISTS (
           SELECT 1
           FROM public.tickets t
           JOIN public.projects pr ON pr.id = t.project_id
           JOIN public.team_members me ON me.team_id = pr.team_id AND me.user_id = auth.uid()
           WHERE t.created_by = p_profile
              OR EXISTS (SELECT 1 FROM public.ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = p_profile)
         )
      -- Bekleyen davetin sahibi (davet eden kişi) davetliye görünür.
      OR EXISTS (
           SELECT 1 FROM public.team_invitations i
           JOIN public.profiles me ON me.id = auth.uid()
           WHERE i.invited_by = p_profile AND lower(i.email) = lower(me.email) AND i.status = 'pending'
         )
$$;
REVOKE ALL ON FUNCTION public.can_see_profile(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_see_profile(uuid) TO authenticated;

DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
DROP POLICY IF EXISTS profiles_select_visible ON public.profiles;
CREATE POLICY profiles_select_visible ON public.profiles
  FOR SELECT TO authenticated
  USING (public.can_see_profile(id));

-- ── 2) Takım koduyla katılma: deneme sınırı ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.join_attempts (
  user_id    uuid NOT NULL,
  attempted  timestamptz NOT NULL DEFAULT now(),
  ok         boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS join_attempts_user_time_idx ON public.join_attempts(user_id, attempted DESC);
ALTER TABLE public.join_attempts ENABLE ROW LEVEL SECURITY;
-- politika yok: yalnızca aşağıdaki SECURITY DEFINER fonksiyon yazar/okur

CREATE OR REPLACE FUNCTION public.join_team_by_code(p_code text)
RETURNS public.teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t teams;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_recent_fail int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Oturum bulunamadı'; END IF;
  IF length(v_code) < 8 THEN RAISE EXCEPTION 'Geçersiz takım kodu'; END IF;

  -- Eski kayıtlar birikmesin
  DELETE FROM join_attempts WHERE user_id = auth.uid() AND attempted < now() - interval '1 day';

  SELECT count(*) INTO v_recent_fail
    FROM join_attempts
   WHERE user_id = auth.uid() AND NOT ok AND attempted > now() - interval '15 minutes';
  IF v_recent_fail >= 5 THEN
    RAISE EXCEPTION 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO t FROM teams WHERE code = v_code;
  IF NOT FOUND THEN
    INSERT INTO join_attempts (user_id, ok) VALUES (auth.uid(), false);
    RAISE EXCEPTION 'Geçersiz takım kodu';
  END IF;
  IF EXISTS (SELECT 1 FROM team_members WHERE team_id = t.id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Zaten bu takımın üyesisin';
  END IF;

  INSERT INTO team_members (team_id, user_id, role) VALUES (t.id, auth.uid(), 'member');
  INSERT INTO join_attempts (user_id, ok) VALUES (auth.uid(), true);
  RETURN t;
END $$;

-- ── 3) Davetler: süresiz davet kalmasın ──────────────────────────────────────
ALTER TABLE public.team_invitations ALTER COLUMN expires_at SET DEFAULT now() + interval '14 days';
UPDATE public.team_invitations SET expires_at = created_at + interval '14 days' WHERE expires_at IS NULL;
