-- 040 — İçe aktarmadan gelen kullanıcılar
--
-- Başka bir araçtan (Planner) veri aktarıldığında, o veride geçen ama Fira'da
-- hesabı olmayan kişiler şimdiye kadar kayboluyordu: atamaları düşüyor, adları
-- yalnızca açıklamaya not olarak yazılıyordu. Artık bu kişiler için "içe aktarma
-- ile oluşturuldu" işaretli birer profil açılıyor:
--
--   * geçmiş (atama, tamamlama, aktivite) gerçek bir kişiye bağlı kalıyor,
--   * kişi sonradan aynı e-posta ile kayıt olduğunda geçmişi hesabına devrediliyor,
--   * hesabı hiç olmayanlar (ör. işten ayrılmış biri) yönetim panelinde görünüyor.
--
-- Bu profillerin auth kaydı yoktur; giriş yapamazlar, yetkileri yoktur (takım
-- üyesi değiller). Bu yüzden profiles.id üzerindeki auth.users kısıtı kaldırıldı.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
COMMENT ON TABLE public.profiles IS
  'Kişiler. source=account → auth.users karşılığı olan gerçek hesap; source=import → içe aktarmayla oluşmuş, giriş yapamayan kayıt (aynı e-posta ile kayıt olununca devralınır).';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'account',
  ADD COLUMN IF NOT EXISTS imported_from text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_id text;

-- Dış sistemde e-postası olmayan kişiler de kaydedilebilmeli.
ALTER TABLE public.profiles ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_source_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_source_check CHECK (source IN ('account', 'import'));

-- Aynı e-postadan iki profil olmamalı: devralma buna dayanıyor.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique ON public.profiles (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS profiles_source_idx ON public.profiles (source) WHERE source = 'import';

-- ── Geçmişi bir profilden diğerine taşı ──────────────────────────────────────
-- Devralma sırasında (ve yönetim tarafında birleştirme gerekirse) kullanılır.
CREATE OR REPLACE FUNCTION public.merge_profile(p_from uuid, p_to uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RETURN; END IF;

  -- Çoklu tablolarda (ticket, takım, tercih) çakışma olabilir: önce hedefte zaten
  -- olan satırların kaynak eşlerini sil, sonra kalanları taşı.
  DELETE FROM ticket_assignees a WHERE a.user_id = p_from
    AND EXISTS (SELECT 1 FROM ticket_assignees b WHERE b.ticket_id = a.ticket_id AND b.user_id = p_to);
  UPDATE ticket_assignees SET user_id = p_to WHERE user_id = p_from;

  DELETE FROM team_members m WHERE m.user_id = p_from
    AND EXISTS (SELECT 1 FROM team_members n WHERE n.team_id = m.team_id AND n.user_id = p_to);
  UPDATE team_members SET user_id = p_to WHERE user_id = p_from;

  DELETE FROM user_preferences u WHERE u.user_id = p_from
    AND EXISTS (SELECT 1 FROM user_preferences v WHERE v.scope = u.scope AND v.user_id = p_to);
  UPDATE user_preferences SET user_id = p_to WHERE user_id = p_from;

  UPDATE tickets SET created_by = p_to WHERE created_by = p_from;
  UPDATE tickets SET updated_by = p_to WHERE updated_by = p_from;
  UPDATE tickets SET assignee_id = p_to WHERE assignee_id = p_from;
  UPDATE ticket_comments SET author_id = p_to WHERE author_id = p_from;
  UPDATE ticket_attachments SET uploaded_by = p_to WHERE uploaded_by = p_from;
  UPDATE ticket_activity SET actor_id = p_to WHERE actor_id = p_from;
  UPDATE ticket_links SET created_by = p_to WHERE created_by = p_from;
  UPDATE projects SET created_by = p_to WHERE created_by = p_from;
  UPDATE team_folders SET created_by = p_to WHERE created_by = p_from;
  UPDATE teams SET created_by = p_to WHERE created_by = p_from;
  UPDATE team_invitations SET invited_by = p_to WHERE invited_by = p_from;
  UPDATE team_invitations SET accepted_by = p_to WHERE accepted_by = p_from;
  UPDATE admin_audit SET actor = p_to WHERE actor = p_from;
  UPDATE system_settings SET updated_by = p_to WHERE updated_by = p_from;

  DELETE FROM public.profiles WHERE id = p_from AND source = 'import';
END $$;

-- ── Kayıt olurken devralma ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mail text := COALESCE(NEW.email, NEW.raw_user_meta_data ->> 'email', '');
  ghost uuid;
  ghost_name text;
BEGIN
  -- Aynı e-postayla içe aktarmadan gelmiş bir kayıt varsa, adı ve geçmişi devral.
  SELECT id, full_name INTO ghost, ghost_name
  FROM public.profiles WHERE source = 'import' AND lower(email) = lower(mail) AND mail <> '';
  IF ghost IS NOT NULL THEN
    -- Benzersiz e-posta indeksi yüzünden hayalet kaydın e-postası devir bitene
    -- kadar boşaltılır; kayıt zaten merge_profile sonunda siliniyor.
    UPDATE public.profiles SET email = NULL WHERE id = ghost;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id, mail,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ghost_name),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url);

  IF ghost IS NOT NULL THEN
    PERFORM public.merge_profile(ghost, NEW.id);
  END IF;
  RETURN NEW;
END $$;

-- ── İçe aktarmanın kullandığı kayıt oluşturma ────────────────────────────────
-- Var olan kişiyi bulur, yoksa "içe aktarma" kaydı açar. Yalnızca hedef takıma
-- yazma yetkisi olan kullanıcı çağırabilir.
CREATE OR REPLACE FUNCTION public.upsert_imported_profile(
  p_team uuid, p_email text, p_name text, p_external_id text DEFAULT NULL, p_source text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mail text := NULLIF(btrim(lower(coalesce(p_email, ''))), '');
  nm text := NULLIF(btrim(coalesce(p_name, '')), '');
  found uuid;
BEGIN
  IF NOT public.can_write_team(p_team) THEN RAISE EXCEPTION 'yetki yok'; END IF;
  IF mail IS NULL AND nm IS NULL THEN RETURN NULL; END IF;

  IF mail IS NOT NULL THEN
    SELECT id INTO found FROM public.profiles WHERE lower(email) = mail;
  END IF;
  IF found IS NULL AND p_external_id IS NOT NULL THEN
    SELECT id INTO found FROM public.profiles WHERE source = 'import' AND external_id = p_external_id;
  END IF;
  IF found IS NULL AND mail IS NULL AND nm IS NOT NULL THEN
    -- E-postası olmayan kişi: yalnızca ad üzerinden tekilleştirilebilir.
    SELECT id INTO found FROM public.profiles WHERE lower(full_name) = lower(nm) LIMIT 1;
  END IF;
  IF found IS NOT NULL THEN
    UPDATE public.profiles SET full_name = COALESCE(full_name, nm) WHERE id = found AND full_name IS NULL;
    RETURN found;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, source, imported_from, imported_at, external_id)
  VALUES (gen_random_uuid(), mail, nm, 'import', p_source, now(), p_external_id)
  RETURNING id INTO found;
  RETURN found;
END $$;

REVOKE ALL ON FUNCTION public.upsert_imported_profile(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_imported_profile(uuid, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.merge_profile(uuid, uuid) FROM PUBLIC;

-- Yönetim panelinde "içe aktarmadan gelen" kişiler görünür ve filtrelenebilir olsun.
CREATE OR REPLACE FUNCTION public.admin_users() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'email', p.email, 'full_name', p.full_name, 'is_admin', p.is_admin, 'avatar_url', p.avatar_url,
    'created_at', p.created_at, 'last_sign_in_at', u.last_sign_in_at, 'banned_until', u.banned_until,
    'source', p.source, 'imported_from', p.imported_from, 'external_id', p.external_id,
    'assigned', (SELECT count(*) FROM ticket_assignees a WHERE a.user_id = p.id),
    'teams', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', m.role)), '[]'::jsonb) FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = p.id)
  ) ORDER BY u.last_sign_in_at DESC NULLS LAST), '[]'::jsonb)
  INTO r FROM profiles p LEFT JOIN auth.users u ON u.id = p.id;
  RETURN r;
END $$;
