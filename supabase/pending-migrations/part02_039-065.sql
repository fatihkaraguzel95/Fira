-- Fira migrations 039 -> 065  (part 2/7)
-- Supabase Dashboard -> SQL Editor: bu dosyanin tamamini yapistirip calistirin.
-- Parcalari SIRAYLA calistirin; bir parca hata verirse sonrakine gecmeyin.

-- ========================================
-- 039_activity_backdate.sql
-- ========================================
-- 039 — Geçmiş tarihli aktivite kaydı (içe aktarma için)
--
-- İki eksik vardı:
--  1) Bir görev içe aktarıldığında "oluşturuldu" kaydı, görevin gerçek oluşturma
--     tarihiyle değil, aktarmanın yapıldığı anla yazılıyordu.
--  2) Planner'da "Tamamlanma Tarihi" ve "Tarafından tamamlanmıştır" ayrı iki alan;
--     bunlar yalnızca açıklamaya not düşülüyordu. Artık aktivite günlüğüne gerçek
--     bir "durum → tamamlandı" geçişi olarak, o tarih ve o kişiyle yazılıyorlar.

-- log_activity artık olayın gerçekleştiği anı da alabiliyor (varsayılan: şimdi).
DROP FUNCTION IF EXISTS public.log_activity(uuid, text, text, text, jsonb, uuid);
CREATE OR REPLACE FUNCTION public.log_activity(
  p_ticket uuid, p_kind text, p_from text, p_to text,
  p_meta jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT NULL, p_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ticket IS NULL THEN RETURN; END IF;
  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta, created_at)
  VALUES (p_ticket, COALESCE(p_actor, public.activity_actor()), p_kind, p_from, p_to,
          COALESCE(p_meta, '{}'::jsonb), COALESCE(p_at, now()));
END $$;

-- "Oluşturuldu" kaydı görevin kendi created_at'ini kullansın (içe aktarılan
-- görevlerde günlük gerçek tarihle başlasın).
CREATE OR REPLACE FUNCTION public.tickets_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := COALESCE(public.activity_actor(), NEW.updated_by, NEW.created_by);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.id, 'created', NULL, NEW.title,
      jsonb_build_object('status', public.status_name(NEW.status_id)),
      COALESCE(public.activity_actor(), NEW.created_by), NEW.created_at);
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title,
        jsonb_build_object('child_id', NEW.id), COALESCE(public.activity_actor(), NEW.created_by), NEW.created_at);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(OLD.parent_id, 'child_removed', OLD.title, NULL,
        jsonb_build_object('child_id', OLD.id), actor);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    PERFORM public.log_activity(NEW.id, 'status', public.status_name(OLD.status_id), public.status_name(NEW.status_id),
      jsonb_build_object('to_category', (SELECT category FROM public.ticket_statuses WHERE id = NEW.status_id),
                         'to_color', (SELECT color FROM public.ticket_statuses WHERE id = NEW.status_id)), actor);
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM public.log_activity(NEW.id, 'priority', OLD.priority::text, NEW.priority::text, '{}'::jsonb, actor);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    PERFORM public.log_activity(NEW.id, 'title', OLD.title, NEW.title, '{}'::jsonb, actor);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    PERFORM public.log_activity(NEW.id, 'description', NULL, NULL,
      jsonb_build_object('from_len', length(COALESCE(OLD.description, '')), 'to_len', length(COALESCE(NEW.description, ''))), actor);
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    PERFORM public.log_activity(NEW.id, 'due_date', OLD.due_date::text, NEW.due_date::text, '{}'::jsonb, actor);
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM public.log_activity(NEW.id, CASE WHEN NEW.archived_at IS NULL THEN 'unarchived' ELSE 'archived' END, NULL, NULL, '{}'::jsonb, actor);
  END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM public.log_activity(NEW.id, 'parent',
      (SELECT title FROM public.tickets WHERE id = OLD.parent_id),
      (SELECT title FROM public.tickets WHERE id = NEW.parent_id), '{}'::jsonb, actor);
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title, jsonb_build_object('child_id', NEW.id), actor);
    END IF;
    IF OLD.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(OLD.parent_id, 'child_removed', OLD.title, NULL, jsonb_build_object('child_id', OLD.id), actor);
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- İçe aktarmanın taşıdığı tamamlanma bilgisi: gerçek bir durum geçişi olarak
-- günlüğe yazılır. `p_by_name` eşleşmeyen kişiler için (Planner'da olup Fira'da
-- hesabı olmayanlar) adı saklar; arayüz aktör yoksa onu gösterir.
CREATE OR REPLACE FUNCTION public.log_import_completion(
  p_ticket uuid, p_at timestamptz, p_actor uuid DEFAULT NULL,
  p_from text DEFAULT NULL, p_by_name text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st record;
BEGIN
  IF p_ticket IS NULL OR p_at IS NULL THEN RETURN; END IF;
  IF NOT public.can_write_team(public.ticket_team(p_ticket)) THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;
  -- Aynı içe aktarma iki kez çalıştırılırsa kayıt ikilenmesin.
  IF EXISTS (
    SELECT 1 FROM public.ticket_activity
    WHERE ticket_id = p_ticket AND kind = 'status' AND created_at = p_at AND (meta ->> 'imported') = 'true'
  ) THEN RETURN; END IF;

  SELECT s.name, s.category, s.color INTO st
  FROM public.tickets t JOIN public.ticket_statuses s ON s.id = t.status_id
  WHERE t.id = p_ticket;

  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta, created_at)
  VALUES (p_ticket, p_actor, 'status', p_from, st.name,
          jsonb_build_object('to_category', st.category, 'to_color', st.color, 'by_name', p_by_name, 'imported', true),
          p_at);
END $$;

REVOKE ALL ON FUNCTION public.log_import_completion(uuid, timestamptz, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_import_completion(uuid, timestamptz, uuid, text, text) TO authenticated;

-- ========================================
-- 040_imported_profiles.sql
-- ========================================
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

-- ========================================
-- 041_import_authorship.sql
-- ========================================
-- 041 — İçe aktarılan görevin gerçek sahibi
--
-- İçe aktarma, görevleri aktarmayı yapan kişinin adına oluşturuyordu: görev
-- penceresinde "Oluşturan" olarak Planner'daki kişi değil, aktarmayı yapan
-- görünüyordu (ticket #BEE700 devamı). Görevi asıl oluşturan kişi artık
-- `tickets.created_by` alanında; "bu kaydı kim aktardı" bilgisi ise aktivite
-- günlüğüne `imported` satırı olarak yazılıyor, yani ikisi de kayboluyor değil.
--
-- Not: tickets_insert politikası `created_by = auth.uid()` şartını koşuyor (ve
-- koşmaya devam etmeli), bu yüzden sahiplik ekleme sırasında değil, bu RPC ile
-- sonradan atanıyor.

CREATE OR REPLACE FUNCTION public.set_import_author(
  p_ticket uuid, p_creator uuid, p_source text DEFAULT NULL, p_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  importer uuid := public.activity_actor();
BEGIN
  IF p_ticket IS NULL THEN RETURN; END IF;
  IF NOT public.can_write_team(public.ticket_team(p_ticket)) THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;

  -- "Bu görev buraya bir aktarmayla geldi" — aktaran kişi kayıtta kalsın.
  IF NOT EXISTS (SELECT 1 FROM public.ticket_activity WHERE ticket_id = p_ticket AND kind = 'imported') THEN
    INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, to_value, meta, created_at)
    VALUES (p_ticket, importer, 'imported', p_source, jsonb_build_object('imported', true), COALESCE(p_at, now()));
  END IF;

  IF p_creator IS NOT NULL THEN
    UPDATE public.tickets SET created_by = p_creator WHERE id = p_ticket;
    UPDATE public.ticket_activity SET actor_id = p_creator
    WHERE ticket_id = p_ticket AND kind = 'created';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_import_author(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_import_author(uuid, uuid, text, timestamptz) TO authenticated;

-- ========================================
-- 042_default_priority.sql
-- ========================================
-- 042 — Öncelik varsayılanı "Orta"
--
-- Önceliksiz görev, panoda "bilgi yok" anlamına geliyordu ve bayrağı hiç
-- çizilmiyordu. Artık varsayılan orta: yeni görevler (uygulamadan, içe
-- aktarmadan ya da doğrudan SQL'den) orta önceliklidir, geçmiş kayıtlar da
-- orta'ya çekildi. Arayüzde orta bayrağı panoda gösterilmez — varsayılan
-- olduğu için gürültü yapar; düşük/yüksek/kritik göze çarpsın diye.
ALTER TABLE public.tickets ALTER COLUMN priority SET DEFAULT 'medium';
UPDATE public.tickets SET priority = 'medium' WHERE priority IS NULL;

-- ========================================
-- 043_list_background.sql
-- ========================================
-- 043 — Listeye özel arkaplan
--
-- Takım sahibi/yöneticisi bir listeye arkaplan resmi atayabilir (ticket #E20D94).
-- Resim dosyası storage'a yüklenir, burada yalnızca adresi ve (yüklenen bir
-- dosyaysa) kaynak notu tutulur. Yazma yetkisi zaten projects_update ile
-- is_team_admin'e bağlı; ayrı bir politika gerekmiyor.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS background_url text,
  ADD COLUMN IF NOT EXISTS background_credit text;

-- ========================================
-- 044_activity_delete_guard.sql
-- ========================================
-- 044 — Görev silinirken günlüğe yazma denemesini engelle
--
-- 038'den beri her bağlı tablo (atama, etiket, ek, son tarih, yorum, bağlantı)
-- silinince aktivite günlüğüne satır yazıyordu. Görev silindiğinde bu satırlar
-- da CASCADE ile siliniyor, ama tetikleyiciler yine de "atama kaldırıldı" gibi
-- kayıtlar yazmaya çalışıyordu — üstelik görev satırı çoktan gitmiş olduğu için
-- yabancı anahtar hatası veriyordu:
--   insert or update on table "ticket_activity" violates foreign key constraint
--   "ticket_activity_ticket_id_fkey"  (SQLSTATE 23503)
-- Sonuç: atanan/yorumu/eki olan hiçbir görev silinemiyordu.
--
-- Çözüm tek yerde: log_activity, görev artık yoksa hiçbir şey yazmaz. Böylece
-- her çağıran (mevcut ve gelecek tetikleyiciler) korunmuş olur.
CREATE OR REPLACE FUNCTION public.log_activity(
  p_ticket uuid, p_kind text, p_from text, p_to text,
  p_meta jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT NULL, p_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ticket IS NULL THEN RETURN; END IF;
  -- Silinmekte olan bir görevin günlüğü tutulmaz: satır zaten yok olacak.
  IF NOT EXISTS (SELECT 1 FROM public.tickets WHERE id = p_ticket) THEN RETURN; END IF;
  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta, created_at)
  VALUES (p_ticket, COALESCE(p_actor, public.activity_actor()), p_kind, p_from, p_to,
          COALESCE(p_meta, '{}'::jsonb), COALESCE(p_at, now()));
END $$;

-- ========================================
-- 045_ticket_ordering.sql
-- ========================================
-- 045: Sütun içi sıralama kuralları
--
-- İki kural var:
--   1) Görev durumu değiştiğinde (Durum alanından, kart menüsünden, alt görev
--      satırından — nereden olursa olsun) hedef sütunun EN ÜSTÜNE gider.
--   2) Elle sürükle-bırak yapılan sıra bunu ezer; elle sıralanmış sütuna durum
--      değişikliğiyle gelen yeni görev yine en üste yerleşir.
--
-- Sürükle-bırak artık tek RPC ile yazılıyor (eskiden kart başına bir UPDATE).
-- RPC, işlem boyunca `fira.manual_reorder` bayrağını kaldırıyor; trigger bu
-- bayrağı görünce araya girmiyor, yani sürüklenen kart bırakıldığı yerde kalıyor.

-- 1) Sürükle-bırak: verilen sıra aynen yazılır, filtreyle gizlenmiş kartlar
--    (ör. "kapatılanları gizle" açıkken tamamlanmış görevler) kendi aralarındaki
--    sırayı koruyarak listenin altına iner. Böylece gizli kartlar görünenlerin
--    arasına karışmaz ve gizliyken bir sütuna bırakılan görev, kapatılanlar
--    tekrar gösterildiğinde de en üstte kalır.
--
-- p_columns: [{ "status_id": "<uuid>", "ids": ["<uuid>", ...] }, ...]
create or replace function public.reorder_tickets(p_columns jsonb)
returns void
language plpgsql
as $$
declare
  col jsonb;
  v_status uuid;
  v_ids uuid[];
  v_count int;
begin
  if p_columns is null or jsonb_typeof(p_columns) <> 'array' then
    raise exception 'p_columns bir JSON dizisi olmalı';
  end if;

  -- Trigger'a "bu sıralama elle yapıldı, karışma" demenin yolu (işlem boyunca geçerli).
  perform set_config('fira.manual_reorder', '1', true);

  for col in select value from jsonb_array_elements(p_columns) loop
    v_status := (col->>'status_id')::uuid;
    if v_status is null then
      continue;
    end if;

    select coalesce(array_agg(value::uuid order by ord), '{}')
      into v_ids
      from jsonb_array_elements_text(col->'ids') with ordinality as e(value, ord);

    v_count := coalesce(array_length(v_ids, 1), 0);

    if v_count > 0 then
      update public.tickets t
         set status_id = v_status,
             order_index = (u.ord - 1)::int,
             updated_at = now(),
             updated_by = auth.uid()
        from unnest(v_ids) with ordinality as u(id, ord)
       where t.id = u.id
         and (t.status_id is distinct from v_status or t.order_index is distinct from (u.ord - 1)::int);
    end if;

    update public.tickets t
       set order_index = v_count + h.rn - 1
      from (
        select id, row_number() over (order by order_index, created_at) as rn
          from public.tickets
         where status_id = v_status
           and not (id = any(v_ids))
      ) h
     where t.id = h.id
       and t.order_index is distinct from (v_count + h.rn - 1)::int;
  end loop;

  -- Bayrak işlem sonuna kadar yaşar; aynı işlemde sonra gelen durum değişiklikleri
  -- yine "en üste" kuralına tabi olsun diye burada bırakılıyor.
  perform set_config('fira.manual_reorder', '', true);
end;
$$;

comment on function public.reorder_tickets(jsonb) is
  'Kanban sürükle-bırak sırasını tek istekte yazar; listede olmayan (filtreli) kartlar sıralarını koruyarak altta kalır.';

revoke all on function public.reorder_tickets(jsonb) from public;
revoke all on function public.reorder_tickets(jsonb) from anon;  -- Supabase varsayılanı anon'a da verir
grant execute on function public.reorder_tickets(jsonb) to authenticated;

-- 2) Durum değişince en üste. Elle sıra (RPC) ve order_index'i açıkça veren
--    çağrılar (içe aktarma vb.) hariç tutulur.
create or replace function public.ticket_top_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status_id is distinct from old.status_id
     and new.order_index is not distinct from old.order_index
     and coalesce(current_setting('fira.manual_reorder', true), '') <> '1'
  then
    select coalesce(min(order_index), 0) - 1
      into new.order_index
      from public.tickets
     where status_id = new.status_id
       and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_top_on_status_change on public.tickets;
create trigger tickets_top_on_status_change
  before update on public.tickets
  for each row
  execute function public.ticket_top_on_status_change();

-- ========================================
-- 046_activity_actor.sql
-- ========================================
-- 046: Aktivite günlüğünde aktörün doğru saklanması
--
-- Sorun: `tickets_activity()` aktörü `COALESCE(auth.uid(), NEW.updated_by, NEW.created_by)`
-- ile buluyordu. Uygulama dışından (psql, script, içe aktarma) yapılan bir güncellemede
-- auth.uid() boş olduğu için görevin ESKİ `updated_by` değeri aktör sayılıyordu: günlükte
-- değişikliği en son dokunan kişi yapmış gibi görünüyor, o kişi de "kendi yaptığın
-- değişiklik bildirilmez" kuralına takılıp bildirim alamıyordu.
--
-- Çözüm: oturum yoksa yalnızca aynı güncellemede DEĞİŞEN `updated_by` aktör kabul edilir;
-- bilinmiyorsa NULL kalır (arayüzde "Biri" olarak görünür ve bildirim engellenmez).

CREATE OR REPLACE FUNCTION public.tickets_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Aktör: oturum sahibi. Oturum yoksa (psql, script, içe aktarma) yalnızca bu
  -- güncellemede DEĞİŞEN updated_by kabul edilir; eski değere düşmek "değişikliği
  -- en son dokunan kişi yapmış" gibi yanlış bir kayıt üretiyordu ve kullanıcı kendi
  -- yapmadığı değişiklikler için bildirim alamıyordu. Bilinmiyorsa NULL kalır.
  actor uuid := CASE
    WHEN TG_OP = 'INSERT' THEN COALESCE(public.activity_actor(), NEW.created_by)
    ELSE COALESCE(public.activity_actor(),
                  CASE WHEN NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END)
  END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.id, 'created', NULL, NEW.title,
      jsonb_build_object('status', public.status_name(NEW.status_id)),
      COALESCE(public.activity_actor(), NEW.created_by), NEW.created_at);
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title,
        jsonb_build_object('child_id', NEW.id), COALESCE(public.activity_actor(), NEW.created_by), NEW.created_at);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(OLD.parent_id, 'child_removed', OLD.title, NULL,
        jsonb_build_object('child_id', OLD.id), actor);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    PERFORM public.log_activity(NEW.id, 'status', public.status_name(OLD.status_id), public.status_name(NEW.status_id),
      jsonb_build_object('to_category', (SELECT category FROM public.ticket_statuses WHERE id = NEW.status_id),
                         'to_color', (SELECT color FROM public.ticket_statuses WHERE id = NEW.status_id)), actor);
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM public.log_activity(NEW.id, 'priority', OLD.priority::text, NEW.priority::text, '{}'::jsonb, actor);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    PERFORM public.log_activity(NEW.id, 'title', OLD.title, NEW.title, '{}'::jsonb, actor);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    PERFORM public.log_activity(NEW.id, 'description', NULL, NULL,
      jsonb_build_object('from_len', length(COALESCE(OLD.description, '')), 'to_len', length(COALESCE(NEW.description, ''))), actor);
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    PERFORM public.log_activity(NEW.id, 'due_date', OLD.due_date::text, NEW.due_date::text, '{}'::jsonb, actor);
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM public.log_activity(NEW.id, CASE WHEN NEW.archived_at IS NULL THEN 'unarchived' ELSE 'archived' END, NULL, NULL, '{}'::jsonb, actor);
  END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM public.log_activity(NEW.id, 'parent',
      (SELECT title FROM public.tickets WHERE id = OLD.parent_id),
      (SELECT title FROM public.tickets WHERE id = NEW.parent_id), '{}'::jsonb, actor);
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title, jsonb_build_object('child_id', NEW.id), actor);
    END IF;
    IF OLD.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(OLD.parent_id, 'child_removed', OLD.title, NULL, jsonb_build_object('child_id', OLD.id), actor);
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ========================================
-- 047_telegram.sql
-- ========================================
-- 047: Telegram kanalı
--
-- Fira kurum VPN'inin arkasında; telefona ne uygulama ne de VPN istemcisi kurulabiliyor.
-- Bildirimlerin dışarı çıkabildiği tek kanal Telegram. Sunucuda çalışan bot servisi
-- (services/telegram-bot) buradaki tabloları kullanır.
--
-- Chat kimliği bilerek `profiles` içine konmadı: profiles SELECT politikası şu an herkese
-- açık, chat kimliği ise kişisel veri. Ayrı tabloda, yalnızca sahibi görebiliyor.

-- ── Bağlı hesaplar ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_accounts (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id     bigint NOT NULL UNIQUE,
  username    text,
  first_name  text,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  blocked_at  timestamptz            -- kullanıcı botu engellerse doldurulur, mesaj gönderilmez
);

ALTER TABLE public.telegram_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telegram_accounts_select_own" ON public.telegram_accounts;
CREATE POLICY "telegram_accounts_select_own" ON public.telegram_accounts
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "telegram_accounts_delete_own" ON public.telegram_accounts;
CREATE POLICY "telegram_accounts_delete_own" ON public.telegram_accounts
  FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, DELETE ON public.telegram_accounts TO authenticated;

-- ── Tek kullanımlık bağlama kodları ──────────────────────────────────────────
-- Kullanıcı ayar ekranında kod üretir, bota /start <kod> yazar; servis kodu tüketip
-- chat kimliğini bağlar. Kod olmadan hiçbir chat bağlanamaz.
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  code        text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS telegram_link_codes_user_idx ON public.telegram_link_codes(user_id);

ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
-- Politika yok: kodlara yalnızca RPC'ler (SECURITY DEFINER) ve servis (service role) erişir.

-- ── Gönderim kaydı (aynı olay iki kez gitmesin) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_deliveries (
  activity_id uuid NOT NULL REFERENCES public.ticket_activity(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);
ALTER TABLE public.telegram_deliveries ENABLE ROW LEVEL SECURITY;

-- ── Servis durumu (nerede kaldım) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bot_state (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bot_state ENABLE ROW LEVEL SECURITY;

-- ── RPC: bağlama kodu üret ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.telegram_link_code()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_code text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'oturum yok';
  END IF;

  -- Kullanıcının kullanılmamış eski kodları geçersiz olsun (tek kod yeter).
  DELETE FROM public.telegram_link_codes WHERE user_id = v_user AND used_at IS NULL;

  -- Karıştırılması kolay harfler (0/O, 1/I) dışarıda.
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    INTO v_code
    FROM generate_series(1, 8);

  INSERT INTO public.telegram_link_codes (code, user_id, expires_at)
  VALUES (v_code, v_user, now() + interval '15 minutes');

  RETURN v_code;
END $$;

REVOKE ALL ON FUNCTION public.telegram_link_code() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.telegram_link_code() TO authenticated;

-- ── RPC: bağlantıyı kes ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.telegram_unlink()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'oturum yok';
  END IF;
  DELETE FROM public.telegram_accounts WHERE user_id = auth.uid();
  DELETE FROM public.telegram_link_codes WHERE user_id = auth.uid() AND used_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.telegram_unlink() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.telegram_unlink() TO authenticated;

-- ── Bildirim alıcıları (servis bunu çağırır) ─────────────────────────────────
-- Uygulama içi bildirimlerdeki kuralın aynısı, tek yerde:
--   • olayın aktörü hariç
--   • görevin atananı ya da açanı
--   • "atama" olayında yalnızca atanan kişi
-- Kanal/olay tercihi servis tarafında değerlendirilir (kullanıcı tercihleri JSON).
CREATE OR REPLACE FUNCTION public.activity_recipients(p_activity uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (
    SELECT id, ticket_id, actor_id, kind, meta FROM public.ticket_activity WHERE id = p_activity
  )
  SELECT DISTINCT c.user_id
  FROM a
  JOIN LATERAL (
    SELECT ta.user_id FROM public.ticket_assignees ta WHERE ta.ticket_id = a.ticket_id
    UNION
    SELECT t.created_by FROM public.tickets t WHERE t.id = a.ticket_id
  ) c ON true
  WHERE c.user_id IS NOT NULL
    AND c.user_id IS DISTINCT FROM a.actor_id
    AND (a.kind <> 'assignee_added' OR c.user_id::text = a.meta->>'user_id')
$$;

REVOKE ALL ON FUNCTION public.activity_recipients(uuid) FROM public, anon, authenticated;

-- ========================================
-- 048_ticket_by_short.sql
-- ========================================
-- 048: Kısa kimlikle görev bulma
--
-- Arayüzde kartların üstünde görünen kısa kimlik (#118F5C) görevin UUID'sinin ilk altı
-- hanesi. Telegram botunda "/gorev 118F5C" yazabilmek ve düğme verisine sığdırmak için
-- (Telegram callback_data en fazla 64 bayt) ön ekten görev bulmak gerekiyor.
--
-- SECURITY INVOKER: RLS aynen uygulanır, yani kullanıcı yalnızca görebildiği görevi bulur.

CREATE OR REPLACE FUNCTION public.ticket_by_short(p_code text)
RETURNS SETOF public.tickets
LANGUAGE sql STABLE AS $$
  SELECT t.*
  FROM public.tickets t
  WHERE p_code IS NOT NULL
    AND length(regexp_replace(p_code, '[^0-9A-Fa-f]', '', 'g')) BETWEEN 4 AND 32
    AND replace(t.id::text, '-', '') LIKE lower(regexp_replace(p_code, '[^0-9A-Fa-f]', '', 'g')) || '%'
  ORDER BY t.created_at
  LIMIT 5
$$;

REVOKE ALL ON FUNCTION public.ticket_by_short(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ticket_by_short(text) TO authenticated;

-- ========================================
-- 049_telegram_outbox.sql
-- ========================================
-- 049: Telegram giden kutusu
--
-- Tarayıcı Telegram'a doğrudan mesaj gönderemez (bot token'ı yalnızca sunucuda). Ayar
-- ekranındaki "Test mesajı gönder" gibi kullanıcı tetikli mesajlar için küçük bir kuyruk:
-- istemci RPC ile satır yazar, bot servisi kuyruğu boşaltır.

CREATE TABLE IF NOT EXISTS public.telegram_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  error      text
);
CREATE INDEX IF NOT EXISTS telegram_outbox_pending_idx ON public.telegram_outbox(created_at) WHERE sent_at IS NULL;

ALTER TABLE public.telegram_outbox ENABLE ROW LEVEL SECURITY;
-- Politika yok: yalnızca RPC (SECURITY DEFINER) ve servis (service role) erişir.

CREATE OR REPLACE FUNCTION public.telegram_send_test()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'oturum yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.telegram_accounts WHERE user_id = v_user AND blocked_at IS NULL) THEN
    RAISE EXCEPTION 'telegram bağlı değil';
  END IF;

  -- Aynı anda kuyruğu doldurmasın: dakikada bir test yeter.
  IF EXISTS (
    SELECT 1 FROM public.telegram_outbox
     WHERE user_id = v_user AND created_at > now() - interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'çok sık deneme';
  END IF;

  INSERT INTO public.telegram_outbox (user_id, body)
  VALUES (v_user, E'✅ <b>Test mesajı</b>\nFira bildirimlerin bu sohbete geliyor.');
END $$;

REVOKE ALL ON FUNCTION public.telegram_send_test() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.telegram_send_test() TO authenticated;

-- ========================================
-- 050_bulk_notifications.sql
-- ========================================
-- 050: Toplu işlemlerde (içe aktarma) bildirim seli olmasın
--
-- Bir içe aktarma iki yüz görev, yüzlerce atama ve yorum yazar; her biri aktivite
-- günlüğüne düşer ve bildirim üretirdi — kişiye aynı dakikada onlarca mesaj.
--
-- Çözüm üç parça:
--   1) İstemci toplu yazımları `x-fira-bulk: 1` başlığıyla gönderir (supabaseBulk).
--      PostgREST bu başlığı `request.headers` olarak görünür kılar; aşağıdaki trigger
--      o sırada yazılan her aktivite satırını `meta.bulk = true` ile işaretler.
--      (psql/script için aynı işi `fira.bulk` GUC'u görür.)
--   2) `activity_recipients` bulk satırları hiç kimseye dağıtmaz; istemci de
--      (notify.ts) aynı bayrağı görünce susar.
--   3) İçe aktarma bitince tek bir özet mesajı: `notify_import_summary`.

-- ── 1) Bayrak ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_mark_bulk()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_headers jsonb;
  v_flag text;
BEGIN
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_flag := coalesce(v_headers ->> 'x-fira-bulk', current_setting('fira.bulk', true));
  IF v_flag = '1' THEN
    NEW.meta := coalesce(NEW.meta, '{}'::jsonb) || '{"bulk": true}'::jsonb;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ticket_activity_mark_bulk ON public.ticket_activity;
CREATE TRIGGER ticket_activity_mark_bulk
  BEFORE INSERT ON public.ticket_activity
  FOR EACH ROW EXECUTE FUNCTION public.activity_mark_bulk();

-- ── 2) Alıcılar: bulk satırlar dağıtılmaz ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_recipients(p_activity uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (
    SELECT id, ticket_id, actor_id, kind, meta FROM public.ticket_activity WHERE id = p_activity
  )
  SELECT DISTINCT c.user_id
  FROM a
  JOIN LATERAL (
    SELECT ta.user_id FROM public.ticket_assignees ta WHERE ta.ticket_id = a.ticket_id
    UNION
    SELECT t.created_by FROM public.tickets t WHERE t.id = a.ticket_id
  ) c ON true
  WHERE c.user_id IS NOT NULL
    AND c.user_id IS DISTINCT FROM a.actor_id
    AND coalesce(a.meta ->> 'bulk', '') <> 'true'
    AND (a.kind <> 'assignee_added' OR c.user_id::text = a.meta->>'user_id')
$$;

REVOKE ALL ON FUNCTION public.activity_recipients(uuid) FROM public, anon, authenticated;

-- ── 3) İçe aktarma özeti ────────────────────────────────────────────────────
-- İçe aktarmayı yapan kişi çağırır (takım yöneticisi). p_since: aktarmanın
-- başladığı an. Aktarmada görev alan her kişiye (aktaran hariç), Telegram'ı
-- bağlıysa ve kanalı açıksa, tek bir özet mesajı kuyruğa yazılır.
CREATE OR REPLACE FUNCTION public.notify_import_summary(p_project uuid, p_since timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_team uuid;
  v_list text;
  v_total int;
  v_count int := 0;
  r record;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  SELECT team_id, name INTO v_team, v_list FROM public.projects WHERE id = p_project;
  IF v_team IS NULL THEN RAISE EXCEPTION 'liste bulunamadı'; END IF;
  IF NOT public.is_team_admin(v_team) THEN RAISE EXCEPTION 'yetki yok'; END IF;

  SELECT count(*) INTO v_total
    FROM public.tickets t
   WHERE t.project_id = p_project AND t.created_at >= p_since - interval '1 minute';

  FOR r IN
    SELECT ta.user_id, count(*) AS n
      FROM public.ticket_assignees ta
      JOIN public.tickets t ON t.id = ta.ticket_id
      JOIN public.telegram_accounts acc ON acc.user_id = ta.user_id AND acc.blocked_at IS NULL
      LEFT JOIN public.user_preferences up ON up.user_id = ta.user_id AND up.scope = 'global'
     WHERE t.project_id = p_project
       AND t.created_at >= p_since - interval '1 minute'
       AND ta.user_id <> v_me
       AND coalesce((up.prefs -> 'notifications' ->> 'telegram')::boolean, false)
     GROUP BY ta.user_id
  LOOP
    INSERT INTO public.telegram_outbox (user_id, body)
    VALUES (
      r.user_id,
      format(E'📥 <b>İçe aktarma tamamlandı</b>\n<b>%s</b> listesine %s görev eklendi; <b>%s</b> tanesi sana atandı.\n\n/bana ile listeleyebilirsin.',
             replace(replace(replace(v_list, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), v_total, r.n)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.notify_import_summary(uuid, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notify_import_summary(uuid, timestamptz) TO authenticated;

-- ========================================
-- 051_orphan_backgrounds.sql
-- ========================================
-- 051: Yetim dosya taraması liste arkaplanlarını canlı saysın
--
-- 043 ile listelere arkaplan (`projects.background_url`) geldi; dosyalar aynı bucket'a
-- (`ticket-attachments/<uid>/backgrounds/…`) yükleniyor. `admin_orphan_files()` bu sütunu
-- bilmiyordu: Yönetim → "Yetim dosyalar → Temizle" canlı arkaplanları da silecekti.
-- Sorgu ayrıca `LIKE '%' || name || '%'` kalıbından `'%/' || name` kalıbına alındı ki
-- kısa bir dosya adı başka bir yolun içinde tesadüfen geçince yanlış eşleşmesin.

CREATE OR REPLACE FUNCTION public.admin_orphan_files() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'bucket', o.bucket_id, 'size', (o.metadata->>'size')::bigint, 'created_at', o.created_at) ORDER BY o.created_at), '[]'::jsonb)
  INTO r
  FROM storage.objects o
  WHERE o.bucket_id = 'ticket-attachments'
    AND o.name NOT LIKE '%/'  -- folders
    AND NOT EXISTS (SELECT 1 FROM ticket_attachments a WHERE a.file_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.icon_url LIKE '%/' || o.name || '%' OR p.background_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.avatar_url LIKE '%/' || o.name || '%' OR p.avatar_full_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.description LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM ticket_comments c WHERE c.content LIKE '%/' || o.name || '%');
  RETURN r;
END $$;

-- ========================================
-- 052_abuse_protection.sql
-- ========================================
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

-- ========================================
-- 053_rpc_grants_join_result.sql
-- ========================================
-- 053: RPC yetkileri ve kod deneme sayacının kalıcılığı
--
-- RLS denetim testi (scripts/sql/rls-audit-tests.sql) iki şey buldu:
--
--  1) Supabase varsayılanı yeni fonksiyonlara `anon` için de EXECUTE veriyor; sekiz
--     kritik RPC'de bu duruyordu. Hepsi auth.uid() kontrolü yaptığı için fiilen bir şey
--     yapılamıyordu, ama en az yetki ilkesi gereği kaldırıldı.
--  2) join_team_by_code hatalı denemeyi kaydedip RAISE ediyordu — istisna aynı işlemdeki
--     kaydı da geri alıyor, sayaç hiç dolmuyordu. Fonksiyon artık istisna atmıyor,
--     sonucu JSON olarak döndürüyor: {ok:true, team:{…}} ya da {ok:false, error:'…'}.
--     İstemci (useJoinTeamByCode) buna göre güncellendi.

REVOKE EXECUTE ON FUNCTION public.accept_invitation(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.accept_invitation_by_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_team_member_by_email(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.import_bundle(jsonb, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.merge_user_prefs(text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_import_completion(uuid, timestamptz, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_import_author(uuid, uuid, text, timestamptz) FROM anon;

-- Dördü PUBLIC üzerinden de açıktı (anon PUBLIC'ten miras alır); yalnızca authenticated kalsın.
REVOKE ALL ON FUNCTION public.accept_invitation(text) FROM public;
REVOKE ALL ON FUNCTION public.accept_invitation_by_id(uuid) FROM public;
REVOKE ALL ON FUNCTION public.add_team_member_by_email(uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.merge_user_prefs(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_team_member_by_email(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_user_prefs(text, jsonb) TO authenticated;

-- Dönüş tipi değiştiği için DROP + CREATE (CREATE OR REPLACE tip değişimine izin vermez).
DROP FUNCTION IF EXISTS public.join_team_by_code(text);

CREATE FUNCTION public.join_team_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t teams;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_recent_fail int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Oturum bulunamadı'); END IF;

  DELETE FROM join_attempts WHERE user_id = auth.uid() AND attempted < now() - interval '1 day';

  SELECT count(*) INTO v_recent_fail
    FROM join_attempts
   WHERE user_id = auth.uid() AND NOT ok AND attempted > now() - interval '15 minutes';
  IF v_recent_fail >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.', 'locked', true);
  END IF;

  IF length(v_code) < 8 THEN
    INSERT INTO join_attempts (user_id, ok) VALUES (auth.uid(), false);
    RETURN jsonb_build_object('ok', false, 'error', 'Geçersiz takım kodu');
  END IF;

  SELECT * INTO t FROM teams WHERE code = v_code;
  IF NOT FOUND THEN
    INSERT INTO join_attempts (user_id, ok) VALUES (auth.uid(), false);
    RETURN jsonb_build_object('ok', false, 'error', 'Geçersiz takım kodu');
  END IF;
  IF EXISTS (SELECT 1 FROM team_members WHERE team_id = t.id AND user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Zaten bu takımın üyesisin');
  END IF;

  INSERT INTO team_members (team_id, user_id, role) VALUES (t.id, auth.uid(), 'member');
  INSERT INTO join_attempts (user_id, ok) VALUES (auth.uid(), true);
  RETURN jsonb_build_object('ok', true, 'team', to_jsonb(t));
END $$;

REVOKE ALL ON FUNCTION public.join_team_by_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.join_team_by_code(text) TO authenticated;

-- ========================================
-- 054_definer_grants.sql
-- ========================================
-- 054: SECURITY DEFINER fonksiyonlarda anon yetkisi
--
-- Politika matrisi (docs/rls-matrix.md) gösterdi: yönetim RPC'leri, davet/üyelik
-- fonksiyonları, aktivite trigger fonksiyonları ve yardımcılar anon'a EXECUTE veriyordu
-- (Supabase varsayılanı). Hepsi içeride auth.uid()/admin_guard() kontrolü yaptığı için
-- fiilen bir şey yapılamıyordu; yine de en az yetki: anon yalnızca giriş öncesi gerçekten
-- gereken şeyi çalıştırabilsin.
--
-- Anon'da kalanlar:
--   • invitation_preview(token)   — davet bağlantısı giriş yapmadan önce açılıyor
--   • RLS politikalarının içinde çağrılan saf yardımcılar (team_role, can_write_team,
--     is_team_admin, is_system_admin, project_team, ticket_team, status_name, person_name):
--     bilgi sızdırmazlar; anon bir politikaya takıldığında "permission denied for function"
--     yerine sessizce 0 satır alsın.
DO $$
DECLARE
  f record;
  keep text[] := ARRAY['invitation_preview','team_role','can_write_team','is_team_admin','is_system_admin',
                       'project_team','ticket_team','status_name','person_name','activity_actor'];
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND NOT (p.proname = ANY (keep))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public, anon', f.proname, f.args);
    -- Trigger fonksiyonları rol tarafından çağrılmaz; diğerlerini authenticated çalıştırabilsin.
    IF (SELECT prorettype::regtype::text FROM pg_proc WHERE oid = f.oid) <> 'trigger' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', f.proname, f.args);
    END IF;
  END LOOP;
END $$;

-- ========================================
-- 055_net_stats.sql
-- ========================================
-- 055: Ağ trafiği ve istek günlüğü (Yönetim → Ağ & İstekler)
--
-- Kaynak: nginx'in Fira sanal sunucusuna özel JSON access log'u (deploy/nginx/conf.d/fira-log.conf),
-- dakikada bir çalışan toplayıcı (deploy/fira-net.sh) yeni satırları okuyup buraya yazar.
-- Disk %99 olduğu için tam istek arşivi tutulmaz:
--   • net_samples     — dakika başına özet (istek, bayt, durum dağılımı, süre) + NIC sayaçları; 30 gün
--   • request_errors  — yalnızca 429 / 5xx satırları, ayrıntılı; 7 gün
--   • request_recent  — son isteklerin halka tamponu (en çok 1000 satır) — "gelen sorgular" incelemesi
-- Tümü yalnızca sistem yöneticisi tarafından, admin_* RPC'leri üzerinden okunur; yazan cron (postgres).

CREATE TABLE IF NOT EXISTS public.net_samples (
  minute        timestamptz PRIMARY KEY,
  requests      int NOT NULL DEFAULT 0,
  bytes_in      bigint NOT NULL DEFAULT 0,
  bytes_out     bigint NOT NULL DEFAULT 0,
  s2xx          int NOT NULL DEFAULT 0,
  s3xx          int NOT NULL DEFAULT 0,
  s4xx          int NOT NULL DEFAULT 0,
  s429          int NOT NULL DEFAULT 0,
  s5xx          int NOT NULL DEFAULT 0,
  avg_ms        int,
  p95_ms        int,
  nic_rx        bigint,          -- ens33 toplam (açılıştan beri), bayt
  nic_tx        bigint,
  nic_rx_rate   bigint,          -- 2 sn örnekten bayt/sn
  nic_tx_rate   bigint,
  top_paths     jsonb            -- [{path, n}] en çok istenen 5 yol
);
ALTER TABLE public.net_samples ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.request_errors (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,
  ip          text,
  method      text,
  path        text,
  status      int NOT NULL,
  bytes_out   bigint,
  ms          int,
  ua          text,
  referer     text
);
CREATE INDEX IF NOT EXISTS request_errors_at_idx ON public.request_errors(at DESC);
ALTER TABLE public.request_errors ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.request_recent (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,
  ip          text,
  method      text,
  path        text,
  status      int NOT NULL,
  bytes_in    bigint,
  bytes_out   bigint,
  ms          int,
  ua          text
);
CREATE INDEX IF NOT EXISTS request_recent_at_idx ON public.request_recent(at DESC);
ALTER TABLE public.request_recent ENABLE ROW LEVEL SECURITY;

-- Toplayıcı her turdan sonra çağırır.
CREATE OR REPLACE FUNCTION public.net_prune() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.net_samples WHERE minute < now() - interval '30 days';
  DELETE FROM public.request_errors WHERE at < now() - interval '7 days';
  DELETE FROM public.request_recent WHERE id < (SELECT coalesce(max(id), 0) - 1000 FROM public.request_recent);
$$;
REVOKE ALL ON FUNCTION public.net_prune() FROM public, anon, authenticated;

-- ── Yönetim RPC'leri ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_net_summary() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; last_s net_samples;
BEGIN
  PERFORM public.admin_guard();
  SELECT * INTO last_s FROM net_samples ORDER BY minute DESC LIMIT 1;
  SELECT jsonb_build_object(
    'last_minute', CASE WHEN last_s.minute IS NULL THEN NULL ELSE jsonb_build_object(
        'minute', last_s.minute, 'requests', last_s.requests, 'bytes_in', last_s.bytes_in, 'bytes_out', last_s.bytes_out,
        's429', last_s.s429, 's5xx', last_s.s5xx, 'avg_ms', last_s.avg_ms, 'p95_ms', last_s.p95_ms,
        'nic_rx', last_s.nic_rx, 'nic_tx', last_s.nic_tx, 'nic_rx_rate', last_s.nic_rx_rate, 'nic_tx_rate', last_s.nic_tx_rate) END,
    'hour',  (SELECT jsonb_build_object('requests', coalesce(sum(requests),0), 'bytes_in', coalesce(sum(bytes_in),0), 'bytes_out', coalesce(sum(bytes_out),0), 's429', coalesce(sum(s429),0), 's5xx', coalesce(sum(s5xx),0))
              FROM net_samples WHERE minute >= now() - interval '1 hour'),
    'today', (SELECT jsonb_build_object('requests', coalesce(sum(requests),0), 'bytes_in', coalesce(sum(bytes_in),0), 'bytes_out', coalesce(sum(bytes_out),0), 's429', coalesce(sum(s429),0), 's5xx', coalesce(sum(s5xx),0))
              FROM net_samples WHERE minute >= date_trunc('day', now())),
    'month', (SELECT jsonb_build_object('requests', coalesce(sum(requests),0), 'bytes_in', coalesce(sum(bytes_in),0), 'bytes_out', coalesce(sum(bytes_out),0), 's429', coalesce(sum(s429),0), 's5xx', coalesce(sum(s5xx),0))
              FROM net_samples WHERE minute >= date_trunc('month', now())),
    'errors_24h', (SELECT count(*) FROM request_errors WHERE at >= now() - interval '24 hours'),
    'top_paths_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('path', path, 'n', n) ORDER BY n DESC), '[]'::jsonb) FROM (
        SELECT (e->>'path') AS path, sum((e->>'n')::int) AS n
        FROM net_samples s, jsonb_array_elements(coalesce(s.top_paths, '[]'::jsonb)) e
        WHERE s.minute >= now() - interval '1 hour' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t)
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_net_series(p_minutes int DEFAULT 60) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object('minute', minute, 'requests', requests, 'bytes_in', bytes_in, 'bytes_out', bytes_out,
                              's2xx', s2xx, 's4xx', s4xx, 's429', s429, 's5xx', s5xx, 'avg_ms', avg_ms, 'p95_ms', p95_ms,
                              'nic_rx_rate', nic_rx_rate, 'nic_tx_rate', nic_tx_rate) ORDER BY minute), '[]'::jsonb)
    INTO r FROM net_samples WHERE minute >= now() - make_interval(mins => greatest(1, least(p_minutes, 1440)));
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_request_errors(p_hours int DEFAULT 24, p_status int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('at', at, 'ip', ip, 'method', method, 'path', path, 'status', status, 'bytes_out', bytes_out, 'ms', ms, 'ua', ua) x
    FROM request_errors
    WHERE at >= now() - make_interval(hours => greatest(1, least(p_hours, 168)))
      AND (p_status IS NULL OR status = p_status)
    ORDER BY at DESC LIMIT 500) q;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_request_recent(p_limit int DEFAULT 200, p_status int DEFAULT NULL, p_q text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('at', at, 'ip', ip, 'method', method, 'path', path, 'status', status, 'bytes_in', bytes_in, 'bytes_out', bytes_out, 'ms', ms, 'ua', ua) x
    FROM request_recent
    WHERE (p_status IS NULL OR status = p_status)
      AND (p_q IS NULL OR p_q = '' OR path ILIKE '%' || p_q || '%' OR ip ILIKE '%' || p_q || '%' OR method ILIKE p_q)
    ORDER BY at DESC LIMIT greatest(1, least(p_limit, 1000))) q;
  RETURN r;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_net_summary()', 'admin_net_series(int)', 'admin_request_errors(int, int)', 'admin_request_recent(int, int, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ========================================
-- 056_link_kinds.sql
-- ========================================
-- 056: Görevler arası bağlantı türleri
--
-- `ticket_links` bugüne kadar tek anlamlıydı ("ilişkili"). Artık türü var:
--   relates    — ilişkili (yönsüz; varsayılan, eski kayıtlar bu)
--   blocks     — A, B'yi ENGELLİYOR (yönlü; B tarafında "engelleyen: A" olarak okunur; kapatırken uyarı)
--   waits_for  — A, B'yi BEKLİYOR (yönlü, yumuşak: bilgi amaçlı, kapatmayı engellemez)
--   duplicates — kopya (yönsüz)
-- Her bağ tek kayıt; ters yön okunurken türetilir (Jira modeli). Bir çift için tek bağ (031 unique index);
-- tür değiştirmek = güncellemek. Döngü/takım dışı kuralları 031'deki trigger'da duruyor.

ALTER TABLE public.ticket_links
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'relates'
  CHECK (kind IN ('relates', 'blocks', 'waits_for', 'duplicates'));

CREATE INDEX IF NOT EXISTS ticket_links_linked_kind_idx ON public.ticket_links(linked_ticket_id, kind);

-- Aktivite günlüğü türü de yazsın (link_added / link_removed / link_kind)
CREATE OR REPLACE FUNCTION public.links_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'link_added', NULL,
      (SELECT title FROM public.tickets WHERE id = NEW.linked_ticket_id),
      jsonb_build_object('kind', NEW.kind, 'linked_id', NEW.linked_ticket_id));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      PERFORM public.log_activity(NEW.ticket_id, 'link_kind', OLD.kind, NEW.kind,
        jsonb_build_object('linked_id', NEW.linked_ticket_id, 'title', (SELECT title FROM public.tickets WHERE id = NEW.linked_ticket_id)));
    END IF;
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'link_removed',
    (SELECT title FROM public.tickets WHERE id = OLD.linked_ticket_id), NULL,
    jsonb_build_object('kind', OLD.kind, 'linked_id', OLD.linked_ticket_id));
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS links_activity ON public.ticket_links;
CREATE TRIGGER links_activity AFTER INSERT OR UPDATE OR DELETE ON public.ticket_links
  FOR EACH ROW EXECUTE FUNCTION public.links_activity();

-- ========================================
-- 057_link_update_policy.sql
-- ========================================
-- 057: Bağlantı türü değiştirilebilsin
-- ticket_links için UPDATE politikası yoktu (yalnızca ekle/sil). Tür (kind) satırdan
-- değiştirildiği için yazma yetkili üye güncelleyebilmeli; ekleme kuralıyla aynı kapsam.
DROP POLICY IF EXISTS links_update ON public.ticket_links;
CREATE POLICY links_update ON public.ticket_links
  FOR UPDATE TO authenticated
  USING (public.can_write_team(public.ticket_team(ticket_id)))
  WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));

-- ========================================
-- 058_user_notifications.sql
-- ========================================
-- 058: Bildirim kutusu (#746B62E9, seçenek A)
--
-- Bugüne kadar bildirimler yalnızca canlı ticket_activity akışından üretiliyordu:
-- sekme kapalıyken olanlar kaybolur, "sonradan bakılacak" bir yer yoktu. Bu tablo
-- her alıcı için bir satır tutar; toast ve Telegram aynen devam eder, kutu bunların
-- yanına gelir. Alıcı kümesi bot ile aynı fonksiyondan (activity_recipients) gelir,
-- böylece üç kanal aynı kişilere aynı şeyi söyler.

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_id  uuid NOT NULL REFERENCES public.ticket_activity(id) ON DELETE CASCADE,
  ticket_id    uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  event        text NOT NULL CHECK (event IN ('assigned', 'comment', 'status', 'subtask', 'file')),
  actor_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Anlık kopyalar: kutu satırı görev/yorum sorgusu yapmadan okunabilsin.
  value        text,
  ticket_title text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  UNIQUE (user_id, activity_id)
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx ON public.user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx ON public.user_notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notifications_select ON public.user_notifications;
CREATE POLICY user_notifications_select ON public.user_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Yazma yalnızca trigger (definer) ve RPC üzerinden; istemciye INSERT/UPDATE/DELETE politikası yok.
GRANT SELECT ON public.user_notifications TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_notifications FROM authenticated, anon;

-- ── Dağıtım: ticket_activity → alıcı başına bir satır ─────────────────────────
CREATE OR REPLACE FUNCTION public.notifications_fanout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event text;
BEGIN
  -- İçe aktarma satırları (BEFORE trigger meta.bulk yazar) kutuya da düşmez; özet ayrı gider.
  IF coalesce(NEW.meta ->> 'bulk', 'false') = 'true' THEN RETURN NEW; END IF;

  v_event := CASE NEW.kind
    WHEN 'assignee_added'   THEN 'assigned'
    WHEN 'comment_added'    THEN 'comment'
    WHEN 'status'           THEN 'status'
    WHEN 'child_added'      THEN 'subtask'
    WHEN 'attachment_added' THEN 'file'
    ELSE NULL END;
  IF v_event IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.user_notifications (user_id, activity_id, ticket_id, project_id, event, actor_id, value, ticket_title)
  SELECT r.user_id, NEW.id, NEW.ticket_id, t.project_id, v_event, NEW.actor_id, left(NEW.to_value, 300), t.title
  FROM public.activity_recipients(NEW.id) r
  CROSS JOIN public.tickets t
  WHERE t.id = NEW.ticket_id
  ON CONFLICT DO NOTHING;

  -- Saklama: 90 gün. Ayrı bir cron yerine dağıtım anında, yalnızca ilgili alıcılar için.
  DELETE FROM public.user_notifications n
  USING public.activity_recipients(NEW.id) r
  WHERE n.user_id = r.user_id AND n.created_at < now() - interval '90 days';

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notifications_fanout() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS ticket_activity_notify ON public.ticket_activity;
CREATE TRIGGER ticket_activity_notify
  AFTER INSERT ON public.ticket_activity
  FOR EACH ROW EXECUTE FUNCTION public.notifications_fanout();

-- ── Okundu işaretleme ─────────────────────────────────────────────────────────
-- p_ids verilirse yalnız onlar; p_ticket verilirse o görevdekiler; ikisi de boşsa tümü.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL, p_ticket uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_n int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  UPDATE public.user_notifications
     SET read_at = now()
   WHERE user_id = v_me
     AND read_at IS NULL
     AND (p_ids IS NULL OR id = ANY (p_ids))
     AND (p_ticket IS NULL OR ticket_id = p_ticket);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[], uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[], uuid) TO authenticated;

-- ── Realtime: rozet ve liste anında güncellensin ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END $$;

-- ========================================
-- 059_ai_work_requests.sql
-- ========================================
-- 059: AI work hand-off.
-- A user marked is_ai (e.g. the "Ali İlker Claude" test account) can be handed a
-- ticket with one click ("Claude'a yaptır"). The click is an EXPLICIT request —
-- plain assignment does NOT trigger anything; only a row here does. A local
-- listener on the machine running Claude Code subscribes to inserts over Realtime
-- and processes the ticket end-to-end, flipping status pending → processing → done.

-- Which profiles are AI agents (assignable, but distinct from human accounts).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_ai BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ai_work_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES tickets(id)  ON DELETE CASCADE,
  requested_by UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  ai_user_id   UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','done','failed','cancelled')),
  detail       TEXT,                       -- free text: what the listener did / why it failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_work_requests_status_idx ON ai_work_requests(status, created_at);
CREATE INDEX IF NOT EXISTS ai_work_requests_ticket_idx ON ai_work_requests(ticket_id);
-- At most one open (pending/processing) request per ticket — a second click is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS ai_work_requests_one_open
  ON ai_work_requests(ticket_id) WHERE status IN ('pending','processing');

CREATE TRIGGER ai_work_requests_updated_at
  BEFORE UPDATE ON ai_work_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: mirror ticket_comments — any team member reads; a writer requests; a writer
-- (incl. the AI account, a team member) advances the status; requester/admin cancels.
ALTER TABLE ai_work_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_work_select ON ai_work_requests;
DROP POLICY IF EXISTS ai_work_insert ON ai_work_requests;
DROP POLICY IF EXISTS ai_work_update ON ai_work_requests;
DROP POLICY IF EXISTS ai_work_delete ON ai_work_requests;
CREATE POLICY ai_work_select ON ai_work_requests FOR SELECT TO authenticated
  USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY ai_work_insert ON ai_work_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY ai_work_update ON ai_work_requests FOR UPDATE TO authenticated
  USING (public.can_write_team(public.ticket_team(ticket_id)))
  WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY ai_work_delete ON ai_work_requests FOR DELETE TO authenticated
  USING (requested_by = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)));

-- Publish over Realtime so the listener wakes on insert (RLS still applies).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_work_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_work_requests;
  END IF;
END $$;
-- Deletes/updates must carry ticket_id + status to the client.
ALTER TABLE ai_work_requests REPLICA IDENTITY FULL;

-- The test account is our AI agent.
UPDATE profiles SET is_ai = TRUE WHERE email = 'no@mail.co';

-- ========================================
-- 060_notification_coalesce.sql
-- ========================================
-- 060: Coalesce inbox notifications for the same task (#746B62E9)
--
-- Feedback: a burst of changes on one task (status, comment, assign, status…)
-- within a couple of minutes produced a separate inbox row each. Fold updates
-- for the SAME task within a 3-minute window into ONE notification instead of
-- creating new ones — the row shows the latest event with a count, and the
-- detail lists every folded change. Toast/Telegram coalescing already existed
-- (client 4s, bot 45s); this brings the persistent inbox in line.

ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS group_count      integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS group_started_at timestamptz;
UPDATE public.user_notifications SET group_started_at = created_at WHERE group_started_at IS NULL;

CREATE OR REPLACE FUNCTION public.notifications_fanout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event  text;
  v_title  text;
  v_project uuid;
  v_rec    record;
  v_existing uuid;
BEGIN
  -- Import rows (BEFORE trigger stamps meta.bulk) never reach the inbox.
  IF coalesce(NEW.meta ->> 'bulk', 'false') = 'true' THEN RETURN NEW; END IF;

  v_event := CASE NEW.kind
    WHEN 'assignee_added'   THEN 'assigned'
    WHEN 'comment_added'    THEN 'comment'
    WHEN 'status'           THEN 'status'
    WHEN 'child_added'      THEN 'subtask'
    WHEN 'attachment_added' THEN 'file'
    ELSE NULL END;
  IF v_event IS NULL THEN RETURN NEW; END IF;

  SELECT title, project_id INTO v_title, v_project FROM public.tickets WHERE id = NEW.ticket_id;

  FOR v_rec IN SELECT user_id FROM public.activity_recipients(NEW.id) LOOP
    -- A recent notification for the same task (any actor) collects this update.
    SELECT id INTO v_existing
      FROM public.user_notifications
     WHERE user_id = v_rec.user_id
       AND ticket_id = NEW.ticket_id
       AND created_at > now() - interval '3 minutes'
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      UPDATE public.user_notifications
         SET activity_id  = NEW.id,
             event        = v_event,
             actor_id     = NEW.actor_id,
             value        = left(NEW.to_value, 300),
             ticket_title = v_title,
             created_at   = now(),
             read_at      = NULL,          -- a fresh change resurfaces the task as unread
             group_count  = group_count + 1
       WHERE id = v_existing;
    ELSE
      INSERT INTO public.user_notifications
        (user_id, activity_id, ticket_id, project_id, event, actor_id, value, ticket_title, group_count, group_started_at)
      VALUES
        (v_rec.user_id, NEW.id, NEW.ticket_id, v_project, v_event, NEW.actor_id, left(NEW.to_value, 300), v_title, 1, now())
      ON CONFLICT (user_id, activity_id) DO NOTHING;
    END IF;
  END LOOP;

  -- Retention: 90 days, only for the recipients touched here.
  DELETE FROM public.user_notifications n
  USING public.activity_recipients(NEW.id) r
  WHERE n.user_id = r.user_id AND n.created_at < now() - interval '90 days';

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notifications_fanout() FROM public, anon, authenticated;

-- UPDATE events must carry the full new row to subscribed clients.
ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;

-- ========================================
-- 061_ticket_cover.sql
-- ========================================
-- 061: Optional card cover image (#f76cb1df)
--
-- A task can nominate ONE of its own image attachments as a cover, which the
-- kanban card then shows as a header. Opt-in per task ("istenirse"): no cover
-- unless somebody picks one, so boards don't suddenly grow pictures.
--
-- The url is denormalised on purpose: the board renders hundreds of cards and
-- should not join ticket_attachments for each one. A trigger keeps it honest —
-- deleting the attachment clears the cover that pointed at it.

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS cover_url text;

CREATE OR REPLACE FUNCTION public.clear_ticket_cover()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tickets
     SET cover_url = NULL
   WHERE id = OLD.ticket_id AND cover_url = OLD.file_url;
  RETURN OLD;
END $$;

REVOKE ALL ON FUNCTION public.clear_ticket_cover() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS ticket_attachments_clear_cover ON public.ticket_attachments;
CREATE TRIGGER ticket_attachments_clear_cover
  AFTER DELETE ON public.ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION public.clear_ticket_cover();

-- ========================================
-- 062_ticket_mutes.sql
-- ========================================
-- 062: Görev takibini bırakma (mute) + bildirimi okunmamış yapma (#93EE1E5F)
--
-- Bugüne kadar bildirim alıcıları yalnızca "atanan + oluşturan" kümesiydi
-- (activity_recipients, 047) ve bundan çıkmanın tek yolu görevden ayrılmaktı.
-- Bu tablo kişisel bir sessize alma listesi tutar: görevle ilişkin kalırsın ama
-- o görevin bildirimleri sana gelmez.
--
-- Sessize alma tek yerde uygulanır — activity_recipients — çünkü kutu (058),
-- Telegram (047) ve birleştirme (060) hepsi alıcı kümesini oradan alır. Böylece
-- üç kanal da aynı anda susar; her kanalda ayrı bir kontrol yok.
-- İstemcinin anlık toast'ı ayrı yoldan (realtime akış) geldiği için orada da
-- aynı liste okunur (src/lib/notify.ts).

CREATE TABLE IF NOT EXISTS public.ticket_mutes (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ticket_id  uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS ticket_mutes_user_idx ON public.ticket_mutes(user_id, created_at DESC);

ALTER TABLE public.ticket_mutes ENABLE ROW LEVEL SECURITY;

-- Sessize alma tamamen kişisel: herkes yalnız kendi satırını görür ve yönetir.
-- Görev de görebildiği bir görev olmalı (takım üyeliği), yoksa yabancı görev
-- id'leriyle satır biriktirilebilir.
DROP POLICY IF EXISTS ticket_mutes_select ON public.ticket_mutes;
CREATE POLICY ticket_mutes_select ON public.ticket_mutes FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS ticket_mutes_insert ON public.ticket_mutes;
CREATE POLICY ticket_mutes_insert ON public.ticket_mutes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);

DROP POLICY IF EXISTS ticket_mutes_delete ON public.ticket_mutes;
CREATE POLICY ticket_mutes_delete ON public.ticket_mutes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.ticket_mutes TO authenticated;
REVOKE UPDATE ON public.ticket_mutes FROM authenticated, anon;

-- ── Alıcı kümesinden sessize alınanları çıkar ────────────────────────────────
-- 047'deki gövdenin aynısı; tek fark en sondaki NOT EXISTS.
CREATE OR REPLACE FUNCTION public.activity_recipients(p_activity uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (
    SELECT id, ticket_id, actor_id, kind, meta FROM public.ticket_activity WHERE id = p_activity
  )
  SELECT DISTINCT c.user_id
  FROM a
  JOIN LATERAL (
    SELECT ta.user_id FROM public.ticket_assignees ta WHERE ta.ticket_id = a.ticket_id
    UNION
    SELECT t.created_by FROM public.tickets t WHERE t.id = a.ticket_id
  ) c ON true
  WHERE c.user_id IS NOT NULL
    AND c.user_id IS DISTINCT FROM a.actor_id
    AND (a.kind <> 'assignee_added' OR c.user_id::text = a.meta->>'user_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.ticket_mutes m
       WHERE m.user_id = c.user_id AND m.ticket_id = a.ticket_id
    )
$$;

REVOKE ALL ON FUNCTION public.activity_recipients(uuid) FROM public, anon, authenticated;

-- ── Okunmamış yapma ─────────────────────────────────────────────────────────
-- mark_notifications_read'in tersi. Grup satırı (060) tek bildirim olduğu için
-- geri alma da tek satırı ilgilendirir; group_count'a dokunulmaz.
CREATE OR REPLACE FUNCTION public.mark_notifications_unread(p_ids uuid[] DEFAULT NULL, p_ticket uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_n int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  IF p_ids IS NULL AND p_ticket IS NULL THEN RAISE EXCEPTION 'ne yapılacağı belirtilmedi'; END IF;
  UPDATE public.user_notifications
     SET read_at = NULL
   WHERE user_id = v_me
     AND read_at IS NOT NULL
     AND (p_ids IS NULL OR id = ANY (p_ids))
     AND (p_ticket IS NULL OR ticket_id = p_ticket);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.mark_notifications_unread(uuid[], uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_unread(uuid[], uuid) TO authenticated;

-- ========================================
-- 063_ticket_list_payload.sql
-- ========================================
-- 063: Panonun taşıdığı yükü küçült (#B98717D4)
--
-- Kart, açıklamanın *içeriğini* değil yalnızca var olup olmadığını gösteriyor
-- (küçük bir simge). Buna rağmen liste sorgusu bütün açıklamaları indiriyordu:
-- 200 görevlik bir listede 78 kB, yani yükün altıda biri, hiç render edilmeyen
-- metin. Üretilmiş sütun bunu tek bir boolean'a indiriyor ve her zaman satırla
-- birlikte tutarlı kalıyor — istemcinin ayrıca hesaplaması gereken bir şey yok.
--
-- STORED çünkü PostgREST yalnızca gerçek sütunları seçebilir; maliyeti satır
-- başına bir bit ve yazma anında bir karşılaştırma.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS has_description boolean
  GENERATED ALWAYS AS (description IS NOT NULL AND btrim(description) <> '') STORED;

COMMENT ON COLUMN public.tickets.has_description IS
  'Kart göstergesi için: açıklama dolu mu? Liste sorgusu description yerine bunu çeker (063).';

-- ========================================
-- 064_pages.sql
-- ========================================
-- 064: Sayfa — görev özellikleri olmayan markdown belge (#82D4FF8D)
--
-- Takımın içinde yalnız liste ve klasör değil, başka nesneler de olabilsin
-- diye açılan ilk tür. Sayfa bir görev değildir: durumu, atananı, önceliği,
-- tarihi yok. İçerik görev açıklamasıyla aynı editörden gelen markdown.
--
-- Neden tickets'a "tür" sütunu değil de ayrı tablo: pano, filtre, sayaç,
-- bildirim ve aktivite kodu görevlere göre yazılmış; sayfaları oraya karıştırmak
-- her sorguya "tür = görev" koşulu eklemek demekti. Kural henüz kesin değil
-- (#9464B646), ayrı tablo değişikliği sayfa tarafında tutuyor.
--
-- Hiyerarşi: sayfa takım kökünde, bir klasörde, bir listede, bir görevin ya
-- da başka bir sayfanın altında durur (üst alanlardan en fazla biri dolu;
-- hiçbiri doluysa takım kökü). Görevin sayfaya işaret eden bir üst alanı
-- olmadığından "görev sayfanın altında olamaz" kuralı yapısal olarak sağlanır.

CREATE TABLE IF NOT EXISTS public.pages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Klasör silinince listeler gibi sayfalar da takım köküne düşer (projects ile aynı).
  folder_id      uuid REFERENCES public.team_folders(id) ON DELETE SET NULL,
  project_id     uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ticket_id      uuid REFERENCES public.tickets(id) ON DELETE CASCADE,
  parent_page_id uuid REFERENCES public.pages(id) ON DELETE CASCADE,
  title          text NOT NULL DEFAULT '',
  content        text NOT NULL DEFAULT '',
  order_index    integer NOT NULL DEFAULT 0,
  created_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,
  -- İçe aktarma (OneNote, #AAC9D463): aynı kaynak ikinci kez alınınca kopya
  -- oluşmasın diye dış kimlik saklanır.
  source         text,
  source_ref     text,
  CONSTRAINT pages_single_parent CHECK (num_nonnulls(folder_id, project_id, ticket_id, parent_page_id) <= 1)
);

CREATE INDEX IF NOT EXISTS pages_team_idx    ON public.pages(team_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS pages_folder_idx  ON public.pages(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pages_project_idx ON public.pages(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pages_ticket_idx  ON public.pages(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pages_parent_idx  ON public.pages(parent_page_id) WHERE parent_page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pages_source_ref_uq ON public.pages(team_id, source, source_ref) WHERE source_ref IS NOT NULL;

-- ── Takım üst nesneden türetilir; istemcinin gönderdiği değere güvenilmez ──
-- RLS WITH CHECK, BEFORE tetikleyicisinden SONRAKİ satıra bakar: istemci başka
-- bir takım yazsa bile satır gerçek üst nesnenin takımıyla kontrol edilir.
CREATE OR REPLACE FUNCTION public.pages_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  cur uuid;
  hops int := 0;
BEGIN
  IF NEW.parent_page_id IS NOT NULL THEN
    SELECT team_id INTO v_team FROM pages WHERE id = NEW.parent_page_id;
    IF v_team IS NULL THEN RAISE EXCEPTION 'Üst sayfa bulunamadı' USING ERRCODE = 'foreign_key_violation'; END IF;
  ELSIF NEW.ticket_id IS NOT NULL THEN
    v_team := ticket_team(NEW.ticket_id);
    IF v_team IS NULL THEN RAISE EXCEPTION 'Görev bulunamadı' USING ERRCODE = 'foreign_key_violation'; END IF;
  ELSIF NEW.project_id IS NOT NULL THEN
    v_team := project_team(NEW.project_id);
    IF v_team IS NULL THEN RAISE EXCEPTION 'Liste bulunamadı' USING ERRCODE = 'foreign_key_violation'; END IF;
  ELSIF NEW.folder_id IS NOT NULL THEN
    SELECT team_id INTO v_team FROM team_folders WHERE id = NEW.folder_id;
    IF v_team IS NULL THEN RAISE EXCEPTION 'Klasör bulunamadı' USING ERRCODE = 'foreign_key_violation'; END IF;
  END IF;
  IF v_team IS NOT NULL THEN NEW.team_id := v_team; END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Takımlar arası taşıma alt sayfaları ve görselleri başka bir yetki alanına
    -- sürükler; ilk sürümde desteklenmiyor.
    IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
      RAISE EXCEPTION 'Sayfa başka bir takıma taşınamaz' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.created_by := OLD.created_by;
  END IF;

  -- Sayfa zincirinde döngü olmasın (A › B › A).
  cur := NEW.parent_page_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Döngü oluşur: hedef sayfa zaten bu sayfanın altında' USING ERRCODE = 'check_violation';
    END IF;
    hops := hops + 1;
    IF hops > 50 THEN RAISE EXCEPTION 'Sayfa zinciri çok derin' USING ERRCODE = 'check_violation'; END IF;
    SELECT parent_page_id INTO cur FROM pages WHERE id = cur;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pages_before_write ON public.pages;
CREATE TRIGGER pages_before_write
  BEFORE INSERT OR UPDATE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.pages_before_write();

-- ── Yetki: mevcut takım rolleri, yeni mekanizma yok ──────────────────────────
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pages_select ON public.pages;
CREATE POLICY pages_select ON public.pages FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL);

DROP POLICY IF EXISTS pages_insert ON public.pages;
CREATE POLICY pages_insert ON public.pages FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_write_team(team_id));

DROP POLICY IF EXISTS pages_update ON public.pages;
CREATE POLICY pages_update ON public.pages FOR UPDATE TO authenticated
  USING (public.can_write_team(team_id))
  WITH CHECK (public.can_write_team(team_id));

DROP POLICY IF EXISTS pages_delete ON public.pages;
CREATE POLICY pages_delete ON public.pages FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_team_admin(team_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO authenticated;
REVOKE ALL ON public.pages FROM anon;

-- Kenar çubuğu ve açık sayfa başkasının değişikliğini canlı görsün.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pages;
  END IF;
END $$;

-- ========================================
-- 065_team_owner_definer.sql
-- ========================================
-- 065: Takım oluşturma yeniden çalışıyor (#37CDA00D)
--
-- Belirti: "Yeni Takım Oluştur" → "new row violates row-level security policy
-- for table teams".
--
-- Kök neden: 028, team_members'taki doğrudan INSERT politikalarını kaldırdı
-- ("katılım SECURITY DEFINER RPC'lerden geçer"). Ama takımı açanı sahip yapan
-- add_team_owner bir RPC değil, 010'dan kalma, SECURITY DEFINER olmayan bir
-- tetikleyici: çağıranın yetkisiyle çalışıyor ve artık team_members'a yazamıyor.
-- Mevcut takımlar 028'den önce açılmıştı; o günden beri yeni takım açılamıyordu.
--
-- Düzeltme: tetikleyici tanımlayanın yetkisiyle çalışır. Güvenli, çünkü yalnız
-- eklenen takımın created_by'ını sahip yapıyor ve teams_insert zaten
-- created_by = auth.uid() şartını koşuyor — kimse başkası adına sahip olamaz.
--
-- İstemci tarafı (useCreateTeam) ayrıca düzeltildi: INSERT … RETURNING, SELECT
-- politikasını (team_role(id) IS NOT NULL) satır eklenirken kontrol eder; o an
-- AFTER tetikleyicisi henüz üyeliği yazmamıştır. İstemci id'yi kendisi üretip
-- RETURNING'siz ekliyor, sonra satırı ayrıca okuyor.

CREATE OR REPLACE FUNCTION public.add_team_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO team_members (team_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.add_team_owner() FROM public, anon, authenticated;
