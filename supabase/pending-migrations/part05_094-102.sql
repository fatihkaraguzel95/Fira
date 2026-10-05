-- Fira migrations 094 -> 102  (part 5/7)
-- Supabase Dashboard -> SQL Editor: bu dosyanin tamamini yapistirip calistirin.
-- Parcalari SIRAYLA calistirin; bir parca hata verirse sonrakine gecmeyin.

-- ========================================
-- 094_move_copy_messages.sql
-- ========================================
-- 094: taşıma/kopyalama kurallarının mesajları (#4e8dc8f1, 28 Eyl 2026)
--
-- Kurallar aynı; yalnız RAISE metinleri değişti. Eskiden 'yetki yok' gibi iki
-- kelimeydi ve istemci bunu "bir şeyler ters gitti"ye çeviriyordu: kullanıcı iki
-- kez taşımayı denedi, neden olmadığını öğrenemedi (aslında demo takımda üye,
-- yönetici değil). Mesaj artık ne yapması gerektiğini de söylüyor; istemci
-- tarafında da bu sınıf hatalar (P0001) kullanıcıya olduğu gibi gösteriliyor.
--
-- Gövdeler sunucudaki güncel tanımdan alındı (093/078), yalnız metinler patched.

CREATE OR REPLACE FUNCTION public.move_ticket(p_ticket uuid, p_project uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src       public.tickets%ROWTYPE;
  v_me      uuid := auth.uid();
  v_status  uuid;
  v_min     integer;
  v_from    text;
  v_to      text;
  v_child   uuid;
  v_src_team uuid;
  v_dst_team uuid;
  v_dropped  integer := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Oturumun düşmüş görünüyor; sayfayı yenileyip yeniden dene.'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı; başkası silmiş ya da taşımış olabilir.'; END IF;
  IF src.project_id = p_project THEN RETURN; END IF;

  v_src_team := public.project_team(src.project_id);
  v_dst_team := public.project_team(p_project);
  IF v_dst_team IS NULL THEN RAISE EXCEPTION 'Hedef liste bulunamadı; liste silinmiş olabilir.'; END IF;

  IF v_dst_team = v_src_team THEN
    IF NOT public.can_write_team(v_dst_team) THEN RAISE EXCEPTION 'Bu listede değişiklik yapma yetkin yok; takım yöneticisinden yetki iste.'; END IF;
  ELSE
    IF NOT (public.is_team_admin(v_src_team) AND public.is_team_admin(v_dst_team)) THEN
      RAISE EXCEPTION 'Başka bir takımın listesine taşımak için her iki takımda da yönetici olman gerekiyor; şu an en az birinde üyesin.';
    END IF;
  END IF;

  SELECT name INTO v_from FROM public.projects WHERE id = src.project_id;
  SELECT name INTO v_to FROM public.projects WHERE id = p_project;
  v_status := public.target_status(p_project, src.status_id, src.status);
  SELECT coalesce(min(order_index), 0) - 1 INTO v_min FROM public.tickets WHERE status_id = v_status;

  PERFORM set_config('fira.manual_reorder', '1', true);
  UPDATE public.tickets
     SET project_id = p_project,
         status_id = v_status,
         status = (SELECT name FROM public.ticket_statuses WHERE id = v_status),
         order_index = v_min,
         parent_id = CASE WHEN parent_id IS NOT NULL AND (SELECT project_id FROM public.tickets x WHERE x.id = src.parent_id) <> p_project THEN NULL ELSE parent_id END,
         updated_by = v_me,
         updated_at = now()
   WHERE id = p_ticket;

  -- Tags belong to a list: keep the ones the new list also has (by name), drop the rest.
  INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
  SELECT DISTINCT p_ticket, t2.id
  FROM public.ticket_tag_assignments ta
  JOIN public.tags t1 ON t1.id = ta.tag_id AND t1.project_id = src.project_id
  JOIN public.tags t2 ON t2.project_id = p_project AND t2.name = t1.name
  WHERE ta.ticket_id = p_ticket
  ON CONFLICT DO NOTHING;
  DELETE FROM public.ticket_tag_assignments ta USING public.tags t
   WHERE ta.ticket_id = p_ticket AND t.id = ta.tag_id AND t.project_id <> p_project;

  -- Başka takıma geçtiyse: hedef takımın üyesi olmayan atamalar düşer.
  IF v_dst_team <> v_src_team THEN
    WITH gone AS (
      DELETE FROM public.ticket_assignees a
       WHERE a.ticket_id = p_ticket
         AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = v_dst_team AND tm.user_id = a.user_id)
      RETURNING 1
    ) SELECT count(*) INTO v_dropped FROM gone;
  END IF;

  PERFORM public.log_activity(p_ticket, 'project', v_from, v_to,
    jsonb_build_object('from_project', src.project_id, 'to_project', p_project)
      || CASE WHEN v_dst_team <> v_src_team
              THEN jsonb_build_object('from_team', v_src_team, 'to_team', v_dst_team, 'dropped_assignees', v_dropped)
              ELSE '{}'::jsonb END,
    v_me);

  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket LOOP
    PERFORM public.move_ticket(v_child, p_project);
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.copy_ticket(p_ticket uuid, p_project uuid DEFAULT NULL::uuid, p_parent uuid DEFAULT NULL::uuid, p_suffix text DEFAULT ' (kopya)'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src      public.tickets%ROWTYPE;
  v_me     uuid := auth.uid();
  v_project uuid;
  v_status uuid;
  v_parent uuid;
  v_new    uuid;
  v_min    integer;
  v_child  uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Oturumun düşmüş görünüyor; sayfayı yenileyip yeniden dene.'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı; başkası silmiş ya da taşımış olabilir.'; END IF;
  v_project := coalesce(p_project, src.project_id);
  IF public.project_team(v_project) IS NULL OR public.project_team(v_project) <> public.project_team(src.project_id) THEN
    RAISE EXCEPTION 'Kopyalama yalnız aynı takımın listeleri arasında yapılabilir.';
  END IF;
  IF NOT public.can_write_team(public.project_team(v_project)) THEN RAISE EXCEPTION 'Bu listede değişiklik yapma yetkin yok; takım yöneticisinden yetki iste.'; END IF;

  v_status := public.target_status(v_project, src.status_id, src.status);
  v_parent := coalesce(p_parent, CASE WHEN v_project = src.project_id THEN src.parent_id END);
  SELECT coalesce(min(order_index), 0) - 1 INTO v_min FROM public.tickets WHERE status_id = v_status;

  PERFORM set_config('fira.manual_reorder', '1', true);
  INSERT INTO public.tickets (project_id, parent_id, title, description, status, status_id, priority, due_date, cover_url, created_by, updated_by, order_index)
  VALUES (v_project, v_parent, src.title || coalesce(p_suffix, ''), src.description,
          (SELECT name FROM public.ticket_statuses WHERE id = v_status), v_status,
          src.priority, src.due_date, src.cover_url, v_me, v_me, v_min)
  RETURNING id INTO v_new;

  INSERT INTO public.ticket_assignees (ticket_id, user_id)
  SELECT v_new, a.user_id FROM public.ticket_assignees a WHERE a.ticket_id = p_ticket;

  IF v_project = src.project_id THEN
    INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
    SELECT v_new, ta.tag_id FROM public.ticket_tag_assignments ta WHERE ta.ticket_id = p_ticket;
  ELSE
    INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
    SELECT DISTINCT v_new, t2.id
    FROM public.ticket_tag_assignments ta
    JOIN public.tags t1 ON t1.id = ta.tag_id
    JOIN public.tags t2 ON t2.project_id = v_project AND t2.name = t1.name
    WHERE ta.ticket_id = p_ticket;
  END IF;

  INSERT INTO public.ticket_attachments (ticket_id, file_url, file_name, uploaded_by)
  SELECT v_new, at.file_url, at.file_name, at.uploaded_by FROM public.ticket_attachments at WHERE at.ticket_id = p_ticket;

  INSERT INTO public.ticket_deadlines (ticket_id, date, description)
  SELECT v_new, d.date, d.description FROM public.ticket_deadlines d WHERE d.ticket_id = p_ticket;

  -- Subtasks follow, each keeping its own name.
  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket AND archived_at IS NULL ORDER BY order_index LOOP
    PERFORM public.copy_ticket(v_child, v_project, v_new, '');
  END LOOP;

  RETURN v_new;
END $function$;

-- ========================================
-- 095_revoke_anon_helpers.sql
-- ========================================
-- 095 — Anonim rolün çalıştırabildiği SECURITY DEFINER yardımcıları kapat (#990dfec5).
--
-- 053/054 kuralı: SECURITY DEFINER fonksiyonlar `anon`a açık olmaz. 054'ten sonra
-- eklenen ya da yeniden yaratılan dört fonksiyon PostgreSQL'in varsayılan
-- "PUBLIC EXECUTE" yetkisiyle anonim role de açık kalmıştı:
--   person_name(uuid)   — bir profil kimliğinden ad döndürüyor; oturumsuz biri
--                          anon anahtarıyla /rest/v1/rpc/person_name çağırabiliyordu
--   status_name(uuid)   — durum adı
--   ai_work_cancel_on_done(), tickets_mentions() — tetikleyici fonksiyonları
--
-- person_name/status_name yalnız tetikleyici ve SECURITY DEFINER gövdelerinin
-- içinden (tickets_activity, assignees_activity, log_mentions) çağrılıyor; istemci
-- kodu kullanmıyor. Tetikleyici fonksiyonlarında EXECUTE yetkisi çalışma anında
-- denetlenmez (yalnız CREATE TRIGGER sırasında), o yüzden tetikleyiciler etkilenmez.
-- Politikalarda kullanılan yardımcılar (project_team, ticket_team, team_role,
-- is_team_admin, can_write_team, is_system_admin) bilerek dokunulmadı: anonim bir
-- sorguda politika değerlendirilirken EXECUTE gerekiyor, kapatmak boş sonuç yerine
-- "permission denied" hatası üretirdi. Yalnız ekleme/yetki; şema değişmiyor.

revoke execute on function public.person_name(uuid) from public, anon;
revoke execute on function public.status_name(uuid) from public, anon;
grant execute on function public.person_name(uuid) to authenticated, service_role;
grant execute on function public.status_name(uuid) to authenticated, service_role;

revoke execute on function public.ai_work_cancel_on_done() from public, anon;
revoke execute on function public.tickets_mentions() from public, anon;

-- ========================================
-- 096_canvas_pages.sql
-- ========================================
-- 096: Çizim ve whiteboard (beta) — sayfanın iki yeni türü (#cf0c7678)
--
-- Sayfa ve görevden sonra 3. ve 4. bileşen. İkisi de ağaçta sayfa gibi durur
-- (takım kökü, klasör, liste, görev, sayfa altı), çöp kutusu, favori, arama,
-- taşıma ve yetki sayfalarla aynı. Bu yüzden ayrı tablo değil `pages.kind`:
-- ağaç, sürükle-bırak, çöp kutusu fonksiyonları (067) ve favoriler (075) hiç
-- değişmeden çalışıyor.
--
-- Beta: kullanıcı ayarı bilerek açmadıysa (user_preferences.global → beta.drawing /
-- beta.whiteboard) bu satırları HİÇ görmez. Kural istemcide değil RLS'te: eski
-- sürümde kalmış bir sekme, palet araması (security invoker) ve canlı olaylar da
-- aynı kuralı izliyor. Sayfalar (kind = 'page') için koşul kısa devre yapar;
-- 831 sayfalık takım ağacının sorgusu değişmez.
--
-- İçerik ayrı tabloda (page_scenes): sahne JSON'u sık kaydediliyor ve büyük
-- olabiliyor. pages satırına yazılsaydı her kayıt realtime yayınıyla bütün
-- istemcilere tam satır olarak gidecek ve herkesin ağacını tazeletecekti.
-- page_scenes yayında değil; canlı ortak çalışma özel (RLS korumalı) broadcast
-- kanalından (`canvas:<sayfa id>`) yürür, kalıcı hâl kayıt fonksiyonuyla.
--
-- Birleştirme öğe başına: her öğenin `version` / `versionNonce` alanı var
-- (Excalidraw modeli; whiteboard da aynısını kullanıyor). Büyük sürüm kazanır,
-- eşitlikte küçük nonce — Excalidraw'ın reconcile kuralı. Böylece aynı anda
-- kaydeden iki kişi birbirinin öğesini silmez ve kayıt sırası sonucu değiştirmez.

-- ── Tür ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'page';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pages_kind_check') THEN
    ALTER TABLE public.pages ADD CONSTRAINT pages_kind_check CHECK (kind IN ('page', 'drawing', 'whiteboard'));
  END IF;
END $$;

-- ── Beta tercihi ─────────────────────────────────────────────────────────────
-- Kullanıcının kendi global tercihinden; yalnız 'true' açık sayılır (bozuk bir
-- değer RLS'i hataya düşürmesin diye tür dönüşümü yok).
CREATE OR REPLACE FUNCTION public.fira_beta(p_feature text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT (prefs->'beta'->>p_feature) = 'true'
      FROM user_preferences
     WHERE user_id = auth.uid() AND scope = 'global'
  ), false)
$$;
REVOKE ALL ON FUNCTION public.fira_beta(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fira_beta(text) TO authenticated, service_role;

-- ── Görünürlük ve yazma: sayfa her zaman, diğer türler yalnız betası açık olana ──
DROP POLICY IF EXISTS pages_select ON public.pages;
CREATE POLICY pages_select ON public.pages FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL AND (kind = 'page' OR public.fira_beta(kind)));

DROP POLICY IF EXISTS pages_insert ON public.pages;
CREATE POLICY pages_insert ON public.pages FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_write_team(team_id) AND (kind = 'page' OR public.fira_beta(kind)));

DROP POLICY IF EXISTS pages_update ON public.pages;
CREATE POLICY pages_update ON public.pages FOR UPDATE TO authenticated
  USING (public.can_write_team(team_id) AND (kind = 'page' OR public.fira_beta(kind)))
  WITH CHECK (public.can_write_team(team_id) AND (kind = 'page' OR public.fira_beta(kind)));

-- ── Yazma kuralları: tür değişmez, çizim/whiteboard alt öğe tutmaz ──────────
-- 064'teki fonksiyonun aynısı + iki kural (işaretli).
CREATE OR REPLACE FUNCTION public.pages_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  v_parent_kind text;
  cur uuid;
  hops int := 0;
BEGIN
  IF NEW.parent_page_id IS NOT NULL THEN
    SELECT team_id, kind INTO v_team, v_parent_kind FROM pages WHERE id = NEW.parent_page_id;
    IF v_team IS NULL THEN RAISE EXCEPTION 'Üst sayfa bulunamadı' USING ERRCODE = 'foreign_key_violation'; END IF;
    -- 096: çizim ve whiteboard yapraktır; altına bir şey konamaz.
    IF v_parent_kind IS DISTINCT FROM 'page' THEN
      RAISE EXCEPTION 'Çizim ya da whiteboard''un altına öğe eklenemez' USING ERRCODE = 'check_violation';
    END IF;
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
    IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
      RAISE EXCEPTION 'Sayfa başka bir takıma taşınamaz' USING ERRCODE = 'check_violation';
    END IF;
    -- 096: tür oluşturulurken belirlenir (sayfayı çizime çevirmek içeriği anlamsız bırakır).
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'Öğenin türü değiştirilemez' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.created_by := OLD.created_by;
  END IF;

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
REVOKE ALL ON FUNCTION public.pages_before_write() FROM public, anon, authenticated;

-- ── Sahne ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.page_scenes (
  page_id     uuid PRIMARY KEY REFERENCES public.pages(id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Öğeler (silinenler `isDeleted: true` mezar taşı olarak bir hafta kalır:
  -- çevrimdışı kalmış bir istemci silineni geri getirmesin).
  elements    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Görsel dosyaları: kimlik → { mimeType, url, created }. Dosyanın kendisi depoda.
  files       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Tuvalin ortak ayarları (arka plan rengi, ızgara …).
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  rev         bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Son sürüm kopyasının zamanı (en fazla yarım saatte bir).
  snapshot_at timestamptz
);

ALTER TABLE public.page_scenes ENABLE ROW LEVEL SECURITY;
-- Görünürlük sayfanın kendisinden: pages RLS'i (takım + beta) alt sorguda uygulanır.
DROP POLICY IF EXISTS page_scenes_select ON public.page_scenes;
CREATE POLICY page_scenes_select ON public.page_scenes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id));
GRANT SELECT ON public.page_scenes TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.page_scenes FROM authenticated;
REVOKE ALL ON public.page_scenes FROM anon;

-- ── Sürümler ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.page_scene_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id    uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  elements   jsonb NOT NULL,
  files      jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- O hâli son yazan ve hâlin geçerli olduğu an.
  author_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  saved_at   timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- auto = düzenleme sırasında alınan kopya; restore = geri dönmeden önceki hâl;
  -- import = içe aktarmadan önceki hâl.
  reason     text NOT NULL DEFAULT 'auto' CHECK (reason IN ('auto', 'restore', 'import'))
);
CREATE INDEX IF NOT EXISTS page_scene_versions_page_idx ON public.page_scene_versions(page_id, saved_at DESC);

ALTER TABLE public.page_scene_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS page_scene_versions_select ON public.page_scene_versions;
CREATE POLICY page_scene_versions_select ON public.page_scene_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id));
GRANT SELECT ON public.page_scene_versions TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.page_scene_versions FROM authenticated;
REVOKE ALL ON public.page_scene_versions FROM anon;

-- Sürüm kopyası (fonksiyonların ortak parçası): kopya alınır, eskiler budanır.
-- Sayfa başına en fazla 30 kopya ve 60 gün — sunucu diski paylaşımlı.
CREATE OR REPLACE FUNCTION public.page_scene_snapshot(p_page uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sc page_scenes%ROWTYPE;
BEGIN
  SELECT * INTO sc FROM page_scenes WHERE page_id = p_page;
  IF NOT FOUND THEN RETURN; END IF;
  -- Boş tuval sürüm değildir.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(sc.elements) e WHERE coalesce(e->>'isDeleted', 'false') <> 'true') THEN RETURN; END IF;
  INSERT INTO page_scene_versions (page_id, team_id, elements, files, settings, author_id, saved_at, reason)
  VALUES (sc.page_id, sc.team_id,
          (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(sc.elements) e WHERE coalesce(e->>'isDeleted', 'false') <> 'true'),
          sc.files, sc.settings, sc.updated_by, sc.updated_at, p_reason);
  UPDATE page_scenes SET snapshot_at = now() WHERE page_id = p_page;
  DELETE FROM page_scene_versions v
   WHERE v.page_id = p_page
     AND (v.saved_at < now() - interval '60 days'
          OR v.id NOT IN (SELECT id FROM page_scene_versions WHERE page_id = p_page ORDER BY saved_at DESC LIMIT 30));
END $$;
REVOKE ALL ON FUNCTION public.page_scene_snapshot(uuid, text) FROM public, anon, authenticated;

-- ── Yazma yetkisi (kayıt, geri yükleme ve kanal için ortak) ──────────────────
-- Sayfa var, çöpte değil, çizim/whiteboard, betası açık ve (yazma için) takımda
-- yazma yetkisi var. SECURITY DEFINER: pages'i RLS'siz okur, kuralları kendisi uygular.
CREATE OR REPLACE FUNCTION public.canvas_access(p_page uuid, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_team uuid; v_kind text;
BEGIN
  SELECT team_id, kind INTO v_team, v_kind FROM pages WHERE id = p_page AND archived_at IS NULL;
  IF v_team IS NULL OR v_kind = 'page' THEN RETURN false; END IF;
  IF NOT public.fira_beta(v_kind) THEN RETURN false; END IF;
  IF p_write THEN RETURN public.can_write_team(v_team); END IF;
  RETURN public.team_role(v_team) IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.canvas_access(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.canvas_access(uuid, boolean) TO authenticated;

-- ── Kaydet: öğe başına birleştir ─────────────────────────────────────────────
-- İstemci yalnız değişen öğeleri gönderir. Dönen `rev` her kayıtta bir artar.
CREATE OR REPLACE FUNCTION public.save_page_scene(p_page uuid, p_elements jsonb, p_files jsonb DEFAULT NULL, p_settings jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pg pages%ROWTYPE;
  sc page_scenes%ROWTYPE;
  merged jsonb;
  -- Bir haftadan eski mezar taşları atılır (ms cinsinden, öğelerin `updated` alanıyla aynı birim).
  cutoff bigint := (extract(epoch FROM now()) * 1000)::bigint - 7 * 86400000;
BEGIN
  SELECT * INTO pg FROM pages WHERE id = p_page;
  IF NOT FOUND OR pg.kind = 'page' THEN
    RAISE EXCEPTION 'Çizim bulunamadı' USING ERRCODE = 'no_data_found';
  END IF;
  IF pg.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Çöp kutusundaki öğe düzenlenemez' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.canvas_access(p_page, true) THEN
    RAISE EXCEPTION 'Bu çizimi düzenleme yetkin yok' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_elements IS NULL OR jsonb_typeof(p_elements) <> 'array' THEN
    RAISE EXCEPTION 'Geçersiz öğe listesi' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- nginx gövde sınırı zaten var; bu, tek kayıtta tabloyu şişirecek bir hataya karşı.
  IF octet_length(p_elements::text) > 8000000 THEN
    RAISE EXCEPTION 'Tek seferde çok büyük kayıt' USING ERRCODE = 'program_limit_exceeded';
  END IF;

  INSERT INTO page_scenes (page_id, team_id) VALUES (pg.id, pg.team_id) ON CONFLICT (page_id) DO NOTHING;
  SELECT * INTO sc FROM page_scenes WHERE page_id = pg.id FOR UPDATE;

  -- Yarım saatte bir, değişmeden önceki hâl sürüm olur.
  IF sc.rev > 0 AND (sc.snapshot_at IS NULL OR sc.snapshot_at < now() - interval '30 minutes') THEN
    PERFORM public.page_scene_snapshot(pg.id, 'auto');
  END IF;

  WITH cur AS (
    SELECT e, e->>'id' AS id FROM jsonb_array_elements(sc.elements) e
  ), inc AS (
    SELECT DISTINCT ON (e->>'id') e, e->>'id' AS id
      FROM jsonb_array_elements(p_elements) e
     WHERE jsonb_typeof(e) = 'object' AND jsonb_typeof(e->'id') = 'string' AND length(e->>'id') BETWEEN 1 AND 80
       -- Birleştirme ve sıralamanın okuduğu alanlar sayı olmalı; yoksa bozuk tek
       -- bir öğe sonraki bütün kayıtları tür hatasına düşürürdü.
       AND coalesce(jsonb_typeof(e->'version'), 'number') = 'number'
       AND coalesce(jsonb_typeof(e->'versionNonce'), 'number') = 'number'
       AND coalesce(jsonb_typeof(e->'updated'), 'number') = 'number'
       AND coalesce(jsonb_typeof(e->'z'), 'number') = 'number'
       AND coalesce(jsonb_typeof(e->'index'), 'string') IN ('string', 'null')
     ORDER BY e->>'id', coalesce((e->>'version')::numeric, 0) DESC
  ), pick AS (
    SELECT CASE
             WHEN c.e IS NULL THEN i.e
             WHEN i.e IS NULL THEN c.e
             WHEN coalesce((i.e->>'version')::numeric, 0) > coalesce((c.e->>'version')::numeric, 0) THEN i.e
             WHEN coalesce((i.e->>'version')::numeric, 0) < coalesce((c.e->>'version')::numeric, 0) THEN c.e
             WHEN coalesce((i.e->>'versionNonce')::numeric, 0) < coalesce((c.e->>'versionNonce')::numeric, 0) THEN i.e
             ELSE c.e
           END AS e
      FROM cur c FULL OUTER JOIN inc i ON c.id = i.id
  )
  SELECT coalesce(jsonb_agg(e ORDER BY e->>'index' COLLATE "C" NULLS LAST, (e->>'z')::float8 NULLS LAST, e->>'id'), '[]'::jsonb)
    INTO merged
    FROM pick
   WHERE NOT (coalesce(e->>'isDeleted', 'false') = 'true' AND coalesce((e->>'updated')::numeric, 0) < cutoff);

  UPDATE page_scenes
     SET elements = merged,
         files = CASE WHEN p_files IS NOT NULL AND jsonb_typeof(p_files) = 'object' THEN files || p_files ELSE files END,
         settings = CASE WHEN p_settings IS NOT NULL AND jsonb_typeof(p_settings) = 'object' THEN jsonb_strip_nulls(settings || p_settings) ELSE settings END,
         rev = rev + 1,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE page_id = pg.id
  RETURNING * INTO sc;

  RETURN jsonb_build_object('rev', sc.rev, 'updated_at', sc.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.save_page_scene(uuid, jsonb, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_page_scene(uuid, jsonb, jsonb, jsonb) TO authenticated;

-- ── İçe aktarmadan önce kopya ────────────────────────────────────────────────
-- Tuvale dosyadan ya da başka bir whiteboard'dan içerik eklenmeden önce o anki
-- hâl sürüm olur: yanlış dosya tek tıkla geri alınabilsin.
CREATE OR REPLACE FUNCTION public.snapshot_page_scene(p_page uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.canvas_access(p_page, true) THEN
    RAISE EXCEPTION 'Bu çizimi düzenleme yetkin yok' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.page_scene_snapshot(p_page, 'import');
END $$;
REVOKE ALL ON FUNCTION public.snapshot_page_scene(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.snapshot_page_scene(uuid) TO authenticated;

-- ── Sürüme dön ───────────────────────────────────────────────────────────────
-- O anki hâl önce sürüm olur. Sonra sürümdeki her öğe, şu anki sürümünden büyük
-- bir sürümle geri yazılır; sürümde olmayan öğeler silinmiş işaretlenir. Böylece
-- açık istemciler birleştirmede geri dönüşü kabul eder (eski sürüm numarası
-- olsaydı yok sayarlardı).
CREATE OR REPLACE FUNCTION public.restore_page_scene_version(p_version uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v page_scene_versions%ROWTYPE;
  sc page_scenes%ROWTYPE;
  merged jsonb;
  now_ms bigint := (extract(epoch FROM now()) * 1000)::bigint;
BEGIN
  SELECT * INTO v FROM page_scene_versions WHERE id = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sürüm bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT public.canvas_access(v.page_id, true) THEN
    RAISE EXCEPTION 'Bu çizimi düzenleme yetkin yok' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.page_scene_snapshot(v.page_id, 'restore');
  SELECT * INTO sc FROM page_scenes WHERE page_id = v.page_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO page_scenes (page_id, team_id) VALUES (v.page_id, v.team_id) RETURNING * INTO sc;
  END IF;

  WITH cur AS (
    SELECT e, e->>'id' AS id FROM jsonb_array_elements(sc.elements) e
  ), old AS (
    SELECT e, e->>'id' AS id FROM jsonb_array_elements(v.elements) e
  )
  SELECT coalesce(jsonb_agg(x.e ORDER BY x.e->>'index' COLLATE "C" NULLS LAST, (x.e->>'z')::float8 NULLS LAST, x.e->>'id'), '[]'::jsonb)
    INTO merged
    FROM (
      SELECT CASE
               WHEN o.e IS NOT NULL THEN
                 o.e || jsonb_build_object(
                   'version', greatest(coalesce((o.e->>'version')::numeric, 0), coalesce((c.e->>'version')::numeric, 0)) + 1,
                   'versionNonce', floor(random() * 2147483647)::bigint,
                   'updated', now_ms,
                   'isDeleted', false)
               ELSE
                 c.e || jsonb_build_object(
                   'version', coalesce((c.e->>'version')::numeric, 0) + 1,
                   'versionNonce', floor(random() * 2147483647)::bigint,
                   'updated', now_ms,
                   'isDeleted', true)
             END AS e
        FROM cur c FULL OUTER JOIN old o ON c.id = o.id
    ) x;

  UPDATE page_scenes
     SET elements = merged, files = files || v.files, settings = v.settings,
         rev = rev + 1, updated_at = now(), updated_by = auth.uid()
   WHERE page_id = v.page_id
  RETURNING * INTO sc;
  RETURN jsonb_build_object('rev', sc.rev, 'updated_at', sc.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.restore_page_scene_version(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.restore_page_scene_version(uuid) TO authenticated;

-- Beta kapalıyken bağlantıyla gelen kişiye "bu bir çizim/whiteboard, ayarı aç"
-- diyebilmek için: takımın üyesiyse ve öğe beta yüzünden gizliyse türü döner,
-- aksi hâlde null (varlığı bile sızmaz).
CREATE OR REPLACE FUNCTION public.hidden_page_kind(p_page uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_team uuid; v_kind text;
BEGIN
  SELECT team_id, kind INTO v_team, v_kind FROM pages WHERE id = p_page;
  IF v_team IS NULL OR v_kind = 'page' THEN RETURN NULL; END IF;
  IF public.team_role(v_team) IS NULL THEN RETURN NULL; END IF;
  IF public.fira_beta(v_kind) THEN RETURN NULL; END IF;
  RETURN v_kind;
END $$;
REVOKE ALL ON FUNCTION public.hidden_page_kind(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hidden_page_kind(uuid) TO authenticated;

-- ── Canlı kanal: yalnız çizimi görebilen dinler, yazabilen yayın yapar ───────
-- `canvas:<uuid>` özel kanal (istemci `private: true` ile katılır). Realtime her
-- katılımda bu politikaları kullanıcının kimliğiyle sınar; herkese açık kanalda
-- olduğu gibi sayfa kimliğini bilen herhangi biri dinleyemez ya da öğe gönderemez.
CREATE OR REPLACE FUNCTION public.canvas_topic_access(p_topic text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_topic IS NULL OR p_topic !~ '^canvas:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  RETURN public.canvas_access(substr(p_topic, 8)::uuid, p_write);
END $$;
REVOKE ALL ON FUNCTION public.canvas_topic_access(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.canvas_topic_access(text, boolean) TO authenticated;

DROP POLICY IF EXISTS fira_canvas_receive ON realtime.messages;
CREATE POLICY fira_canvas_receive ON realtime.messages FOR SELECT TO authenticated
  USING (extension IN ('broadcast', 'presence') AND public.canvas_topic_access(realtime.topic(), false));

-- Varlık (kim burada) her üyeye açık; öğe ve imleç yayını yalnız yazabilene.
DROP POLICY IF EXISTS fira_canvas_send ON realtime.messages;
CREATE POLICY fira_canvas_send ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
    (extension = 'presence' AND public.canvas_topic_access(realtime.topic(), false))
    OR (extension = 'broadcast' AND public.canvas_topic_access(realtime.topic(), true))
  );

-- ── Yetim dosya taraması tuvallerin görsellerini de kullanımda saysın ────────
-- 072'deki fonksiyonun aynısı + iki kaynak (işaretli). Kural (CLAUDE.md): yeni bir
-- dosya referansı sütunu bu sorguya da eklenir.
CREATE OR REPLACE FUNCTION public.admin_orphan_files()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SET LOCAL statement_timeout = '60s';

  WITH src AS (
    SELECT file_url AS txt FROM ticket_attachments WHERE file_url IS NOT NULL
    UNION ALL SELECT icon_url FROM projects WHERE icon_url IS NOT NULL
    UNION ALL SELECT background_url FROM projects WHERE background_url IS NOT NULL
    UNION ALL SELECT avatar_url FROM profiles WHERE avatar_url IS NOT NULL
    UNION ALL SELECT avatar_full_url FROM profiles WHERE avatar_full_url IS NOT NULL
    UNION ALL SELECT cover_url FROM tickets WHERE cover_url IS NOT NULL
    UNION ALL SELECT description FROM tickets WHERE description LIKE '%/object/public/ticket-attachments/%'
    UNION ALL SELECT content FROM ticket_comments WHERE content LIKE '%/object/public/ticket-attachments/%'
    UNION ALL SELECT content FROM pages WHERE content LIKE '%/object/public/ticket-attachments/%'
    UNION ALL SELECT content FROM page_versions WHERE content LIKE '%/object/public/ticket-attachments/%'
    -- 096: çizim/whiteboard görselleri (öğelerde ya da dosya tablosunda) ve sürümleri
    UNION ALL SELECT elements::text || files::text FROM page_scenes
    UNION ALL SELECT elements::text || files::text FROM page_scene_versions
  ), raw AS MATERIALIZED (
    SELECT DISTINCT split_part(split_part(substring(piece FROM '^[^)"''[:space:]]+'), '#', 1), '?', 1) AS path
    FROM src, LATERAL regexp_split_to_table(src.txt, '/object/public/ticket-attachments/') WITH ORDINALITY AS t(piece, n)
    WHERE t.n > 1
  ), refs AS MATERIALIZED (
    SELECT path FROM raw WHERE path <> ''
    UNION
    SELECT public.url_decode(path) FROM raw WHERE path LIKE '%\%%'
  ), orph AS MATERIALIZED (
    SELECT o.name, (o.metadata->>'size')::bigint AS size, o.created_at
    FROM storage.objects o
    WHERE o.bucket_id = 'ticket-attachments'
      AND o.name NOT LIKE '%/'
      AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.path = o.name)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM orph),
    'total_bytes', (SELECT coalesce(sum(size), 0) FROM orph),
    'limit', 1000,
    'files', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'bucket', 'ticket-attachments', 'size', size, 'created_at', created_at) ORDER BY created_at), '[]'::jsonb)
      FROM (SELECT * FROM orph ORDER BY created_at LIMIT 1000) z
    )
  ) INTO r;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.admin_orphan_files() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_orphan_files() TO authenticated;

-- ========================================
-- 097_ticket_checklist.sql
-- ========================================
-- 097: Görev içi yapılacaklar listesi (#7c54fb70).
--
-- Alt görev olacak kadar büyük olmayan işler için hafif maddeler (ClickUp'taki
-- Checklist). Her madde bir görevin altında; sırası order_index, tamamlanınca
-- kim/ne zaman tetikleyiciyle yazılır. Görev kartında maddeleri gösterme
-- ayarı görevin kendi satırında (tickets.checklist_on_board).
--
-- Yalnız ekleme: yeni tablo, tickets'a varsayılanlı bir sütun, copy_ticket'e
-- maddeleri kopyalayan blok. Eski istemci ikisini de görmez, çalışmaya devam eder.

CREATE TABLE IF NOT EXISTS public.ticket_checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  done        boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  -- profiles'a bağlı değil: içe aktarılan kişiler madde yazmaz, merge_profile'a gerek yok.
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  done_by     uuid,
  done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ticket_checklist_items_ticket_idx ON public.ticket_checklist_items (ticket_id, order_index);

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS checklist_on_board boolean NOT NULL DEFAULT false;

-- Tamamlanma bilgisi ve zaman damgası sunucuda; madde başka göreve taşınamaz.
CREATE OR REPLACE FUNCTION public.checklist_items_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.title := btrim(NEW.title);
  IF TG_OP = 'UPDATE' THEN
    NEW.ticket_id := OLD.ticket_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    IF NEW.done IS DISTINCT FROM OLD.done THEN
      NEW.done_at := CASE WHEN NEW.done THEN now() END;
      NEW.done_by := CASE WHEN NEW.done THEN auth.uid() END;
    ELSE
      NEW.done_at := OLD.done_at;
      NEW.done_by := OLD.done_by;
    END IF;
  ELSE
    NEW.done_at := CASE WHEN NEW.done THEN now() END;
    NEW.done_by := CASE WHEN NEW.done THEN coalesce(auth.uid(), NEW.created_by) END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS checklist_items_before_write ON public.ticket_checklist_items;
CREATE TRIGGER checklist_items_before_write
  BEFORE INSERT OR UPDATE ON public.ticket_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.checklist_items_before_write();

-- RLS: okumak takım üyesine, yazmak yazabilen üyeye (ticket_links / ticket_deadlines ile aynı).
ALTER TABLE public.ticket_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_select ON public.ticket_checklist_items;
DROP POLICY IF EXISTS checklist_insert ON public.ticket_checklist_items;
DROP POLICY IF EXISTS checklist_update ON public.ticket_checklist_items;
DROP POLICY IF EXISTS checklist_delete ON public.ticket_checklist_items;
CREATE POLICY checklist_select ON public.ticket_checklist_items FOR SELECT TO authenticated
  USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY checklist_insert ON public.ticket_checklist_items FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY checklist_update ON public.ticket_checklist_items FOR UPDATE TO authenticated
  USING (public.can_write_team(public.ticket_team(ticket_id)))
  WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY checklist_delete ON public.ticket_checklist_items FOR DELETE TO authenticated
  USING (public.can_write_team(public.ticket_team(ticket_id)));

REVOKE ALL ON public.ticket_checklist_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_checklist_items TO authenticated;
REVOKE ALL ON FUNCTION public.checklist_items_before_write() FROM public, anon;

-- Canlı güncelleme: diğer açık pencereler ve pano maddeleri hemen görür.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ticket_checklist_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_checklist_items;
  END IF;
END $$;
-- Silinen satırda ticket_id de gelsin (istemci o görevin görünümlerini tazeler).
ALTER TABLE public.ticket_checklist_items REPLICA IDENTITY FULL;

-- copy_ticket: 094'teki tanımın aynısı + panoda gösterme ayarı ve maddeler.
-- Kopyadaki maddeler işaretsiz başlar (kopya çoğu zaman yeni bir iş için şablon).
CREATE OR REPLACE FUNCTION public.copy_ticket(p_ticket uuid, p_project uuid DEFAULT NULL::uuid, p_parent uuid DEFAULT NULL::uuid, p_suffix text DEFAULT ' (kopya)'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src      public.tickets%ROWTYPE;
  v_me     uuid := auth.uid();
  v_project uuid;
  v_status uuid;
  v_parent uuid;
  v_new    uuid;
  v_min    integer;
  v_child  uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Oturumun düşmüş görünüyor; sayfayı yenileyip yeniden dene.'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı; başkası silmiş ya da taşımış olabilir.'; END IF;
  v_project := coalesce(p_project, src.project_id);
  IF public.project_team(v_project) IS NULL OR public.project_team(v_project) <> public.project_team(src.project_id) THEN
    RAISE EXCEPTION 'Kopyalama yalnız aynı takımın listeleri arasında yapılabilir.';
  END IF;
  IF NOT public.can_write_team(public.project_team(v_project)) THEN RAISE EXCEPTION 'Bu listede değişiklik yapma yetkin yok; takım yöneticisinden yetki iste.'; END IF;

  v_status := public.target_status(v_project, src.status_id, src.status);
  v_parent := coalesce(p_parent, CASE WHEN v_project = src.project_id THEN src.parent_id END);
  SELECT coalesce(min(order_index), 0) - 1 INTO v_min FROM public.tickets WHERE status_id = v_status;

  PERFORM set_config('fira.manual_reorder', '1', true);
  INSERT INTO public.tickets (project_id, parent_id, title, description, status, status_id, priority, due_date, cover_url, created_by, updated_by, order_index, checklist_on_board)
  VALUES (v_project, v_parent, src.title || coalesce(p_suffix, ''), src.description,
          (SELECT name FROM public.ticket_statuses WHERE id = v_status), v_status,
          src.priority, src.due_date, src.cover_url, v_me, v_me, v_min, src.checklist_on_board)
  RETURNING id INTO v_new;

  INSERT INTO public.ticket_assignees (ticket_id, user_id)
  SELECT v_new, a.user_id FROM public.ticket_assignees a WHERE a.ticket_id = p_ticket;

  IF v_project = src.project_id THEN
    INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
    SELECT v_new, ta.tag_id FROM public.ticket_tag_assignments ta WHERE ta.ticket_id = p_ticket;
  ELSE
    INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
    SELECT DISTINCT v_new, t2.id
    FROM public.ticket_tag_assignments ta
    JOIN public.tags t1 ON t1.id = ta.tag_id
    JOIN public.tags t2 ON t2.project_id = v_project AND t2.name = t1.name
    WHERE ta.ticket_id = p_ticket;
  END IF;

  INSERT INTO public.ticket_attachments (ticket_id, file_url, file_name, uploaded_by)
  SELECT v_new, at.file_url, at.file_name, at.uploaded_by FROM public.ticket_attachments at WHERE at.ticket_id = p_ticket;

  INSERT INTO public.ticket_deadlines (ticket_id, date, description)
  SELECT v_new, d.date, d.description FROM public.ticket_deadlines d WHERE d.ticket_id = p_ticket;

  INSERT INTO public.ticket_checklist_items (ticket_id, title, done, order_index, created_by)
  SELECT v_new, c.title, false, c.order_index, v_me FROM public.ticket_checklist_items c WHERE c.ticket_id = p_ticket;

  -- Subtasks follow, each keeping its own name.
  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket AND archived_at IS NULL ORDER BY order_index LOOP
    PERFORM public.copy_ticket(v_child, v_project, v_new, '');
  END LOOP;

  RETURN v_new;
END $function$;

-- ========================================
-- 098_palette_search_scope.sql
-- ========================================
-- 098: Palet aramasına kesin kapsam (#31b09040, v0.72.0)
--
-- Görev penceresindeki "Görev bağla" çubuğu paletin arama dilini kullanıyor
-- (bulanık eşleşme, atanan:ben, oluşturan:ad, durum:, …) ama yalnız bulunulan
-- listede arıyor; `liste:ad` yazılınca takımdaki başka bir listede. `liste:`
-- ve `takım:` ada göre bulanık eşleştiği için kapsam için yetmiyor: benzer adlı
-- başka listeler, başka takımlar da giriyordu.
--
-- Eklenen iki isteğe bağlı anahtar, ikisi de kimlik:
--   project_id  yalnız bu listenin görevleri (listeler ve sayfalar dönmez)
--   team_id     yalnız bu takımın görevleri / listeleri / sayfaları
-- Anahtarı göndermeyen istemci (üst çubuktaki palet) için hiçbir şey değişmez.
-- İşlev 083'teki gövdenin aynısı; yalnız bu iki süzgeç eklendi.

create or replace function public.palette_search(p jsonb)
returns table (
  kind text, id uuid, title text, project_id uuid, project_name text, team_id uuid,
  icon text, icon_url text, status_name text, status_color text, score real, activity_at timestamptz
)
language plpgsql stable
security invoker
set search_path = public, extensions
as $$
declare
  split constant text := '\s+';
  v_terms   text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'terms') x where btrim(x) <> ''), '{}');
  v_not     text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'not') x where btrim(x) <> ''), '{}');
  v_phrases text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'phrases') x where btrim(x) <> ''), '{}');
  v_kinds   text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'kinds') x), array['ticket', 'project', 'page']);
  v_has     text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'has') x), '{}');
  v_assignee text := nullif(btrim(p->>'assignee'), '');
  v_creator  text := nullif(btrim(p->>'creator'), '');
  v_status  text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'status'), '')), split);
  v_tag     text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'tag'), '')), split);
  v_list    text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'list'), '')), split);
  v_team    text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'team'), '')), split);
  v_comment text := nullif(public.fira_fold(btrim(p->>'comment')), '');
  v_state    text := p->>'state';          -- open | done
  v_priority text := p->>'priority';       -- critical | high | medium | low | none
  v_due      text := p->>'due';            -- overdue | today | week | none
  v_after    timestamptz := (p->>'after')::timestamptz;       -- last activity at or after
  v_before   timestamptz := (p->>'before')::timestamptz;      -- last activity before
  v_on_from  timestamptz := (p->>'on_from')::timestamptz;     -- any activity in [on_from, on_to)
  v_on_to    timestamptz := (p->>'on_to')::timestamptz;
  v_cr_from  timestamptz := (p->>'created_from')::timestamptz;
  v_cr_to    timestamptz := (p->>'created_to')::timestamptz;
  v_limit    int := least(greatest(coalesce((p->>'limit')::int, 20), 1), 50);
  v_task_only boolean;
  v_dated    boolean := (p->>'after') is not null or (p->>'before') is not null;
  v_uid uuid := auth.uid();
  -- 098: kesin kapsam (görev penceresindeki bağlama çubuğu). Ad değil kimlik.
  v_project uuid := nullif(btrim(p->>'project_id'), '')::uuid;
  v_team_id uuid := nullif(btrim(p->>'team_id'), '')::uuid;
begin
  if v_status = '{}' or v_status = '{""}' then v_status := null; end if;
  if v_tag = '{}' or v_tag = '{""}' then v_tag := null; end if;
  if v_list = '{}' or v_list = '{""}' then v_list := null; end if;
  if v_team = '{}' or v_team = '{""}' then v_team := null; end if;
  -- Filters that only make sense for tasks: when one is set, lists and pages are not returned.
  v_task_only := v_assignee is not null or v_creator is not null or v_status is not null or v_tag is not null or v_list is not null
    or v_comment is not null or v_state is not null or v_priority is not null or v_due is not null
    or coalesce(array_length(v_has, 1), 0) > 0 or v_on_from is not null or v_cr_from is not null
    or v_project is not null;

  if 'ticket' = any(v_kinds) then
    return query
    with base as (
      select t.id, t.title, t.search_fold as dfold, t.project_id, pr.name as pname, pr.team_id as tid,
             s.name as sname, s.color as scolor, s.category as scat, t.updated_at,
             -- The last comment matters only when a date filter uses it; otherwise it is
             -- looked up for the handful of rows that make the list (see below).
             case when v_dated
                  then greatest(t.updated_at, (select max(c.created_at) from ticket_comments c where c.ticket_id = t.id))
                  else t.updated_at end as act,
             t.created_at, t.created_by, t.priority, t.due_date
        from tickets t
        join projects pr on pr.id = t.project_id
        left join ticket_statuses s on s.id = t.status_id
       where t.archived_at is null
         and (v_project is null or t.project_id = v_project)
         and (v_team_id is null or pr.team_id = v_team_id)
         and (v_list is null or public.fira_all_terms(v_list, pr.name) >= 0.8)
         and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_status is null or public.fira_all_terms(v_status, s.name) >= 0.8)
         and (v_state is null
              or (v_state = 'open' and coalesce(s.category, 'active') not in ('done', 'closed'))
              or (v_state = 'done' and s.category in ('done', 'closed')))
         and (v_priority is null or (v_priority = 'none' and t.priority is null) or t.priority::text = v_priority)
         and (v_due is null
              or (v_due = 'none' and t.due_date is null)
              or (v_due = 'overdue' and t.due_date < current_date and coalesce(s.category, 'active') not in ('done', 'closed'))
              or (v_due = 'today' and t.due_date = current_date)
              or (v_due = 'week' and t.due_date between current_date and current_date + 7))
         and (v_tag is null or exists (select 1 from ticket_tag_assignments a join tags g on g.id = a.tag_id
                                        where a.ticket_id = t.id and public.fira_all_terms(v_tag, g.name) >= 0.8))
         and (v_assignee is null
              or (v_assignee = '@me' and exists (select 1 from ticket_assignees a where a.ticket_id = t.id and a.user_id = v_uid))
              or (v_assignee = '@none' and not exists (select 1 from ticket_assignees a where a.ticket_id = t.id))
              or (v_assignee not in ('@me', '@none') and exists (
                    select 1 from ticket_assignees a join profiles pf on pf.id = a.user_id
                     where a.ticket_id = t.id
                       and public.fira_all_terms(regexp_split_to_array(public.fira_fold(v_assignee), split),
                                                 coalesce(pf.full_name, '') || ' ' || coalesce(pf.email, '')) >= 0.8)))
         and (v_creator is null
              or (v_creator = '@me' and t.created_by = v_uid)
              or (v_creator <> '@me' and exists (
                    select 1 from profiles pf where pf.id = t.created_by
                       and public.fira_all_terms(regexp_split_to_array(public.fira_fold(v_creator), split),
                                                 coalesce(pf.full_name, '') || ' ' || coalesce(pf.email, '')) >= 0.8)))
         and (v_comment is null or exists (select 1 from ticket_comments c where c.ticket_id = t.id
                                              and strpos(public.fira_fold(c.content), v_comment) > 0))
         and (not ('file' = any(v_has)) or exists (select 1 from ticket_attachments x where x.ticket_id = t.id))
         and (not ('comment' = any(v_has)) or exists (select 1 from ticket_comments x where x.ticket_id = t.id))
         and (not ('subtask' = any(v_has)) or exists (select 1 from tickets x where x.parent_id = t.id and x.archived_at is null))
         and (not ('link' = any(v_has)) or exists (select 1 from ticket_links x where x.ticket_id = t.id or x.linked_ticket_id = t.id))
         and (not ('due' = any(v_has)) or t.due_date is not null)
         and (not ('desc' = any(v_has)) or coalesce(btrim(t.description), '') <> '')
         and (v_cr_from is null or (t.created_at >= v_cr_from and t.created_at < v_cr_to))
         and (v_on_from is null
              or (t.created_at >= v_on_from and t.created_at < v_on_to)
              or exists (select 1 from ticket_activity a where a.ticket_id = t.id and a.created_at >= v_on_from and a.created_at < v_on_to)
              or exists (select 1 from ticket_comments c where c.ticket_id = t.id and c.created_at >= v_on_from and c.created_at < v_on_to))
    ), scored as (
      select b.*,
             (select case when count(*) = 0 then 1::real
                          when bool_and(q.s >= 0.8) then avg(q.s)::real
                          else 0::real end
                from (select greatest(public.fira_term_score(x, b.title),
                                      case when length(x) >= 3 and strpos(b.dfold, x) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) x) q) as sc
        from base b
       where (v_after is null or b.act >= v_after)
         and (v_before is null or b.act < v_before)
         and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(b.title), x) > 0)
         and not exists (select 1 from unnest(v_phrases) x
                          where strpos(public.fira_fold(b.title), x) = 0 and strpos(b.dfold, x) = 0)
    ), top as (
      select s.id, s.title, s.project_id, s.pname, s.tid, s.sname, s.scolor, s.sc, s.act, s.updated_at
        from scored s
       where s.sc > 0
       order by s.sc desc, s.act desc nulls last, s.updated_at desc nulls last
       limit v_limit
    )
    select 'ticket'::text, x.id, x.title, x.project_id, x.pname, x.tid, null::text, null::text, x.sname, x.scolor, x.sc,
           case when v_dated then x.act
                else greatest(x.updated_at, (select max(c.created_at) from ticket_comments c where c.ticket_id = x.id)) end
      from top x
     order by x.sc desc, 12 desc nulls last;
  end if;

  if v_task_only or (coalesce(array_length(v_terms, 1), 0) = 0 and coalesce(array_length(v_phrases, 1), 0) = 0) then
    return;
  end if;

  -- Lists carry no activity dates: a date filter leaves them out.
  if 'project' = any(v_kinds) and v_after is null and v_before is null then
    return query
    select 'project'::text, pr.id, pr.name, pr.id, pr.name, pr.team_id, pr.icon, pr.icon_url, null::text, null::text,
           public.fira_all_terms(v_terms, pr.name), null::timestamptz
      from projects pr
     where public.fira_all_terms(v_terms, pr.name) > 0
       and (v_team_id is null or pr.team_id = v_team_id)
       and not exists (select 1 from unnest(v_phrases) x where strpos(public.fira_fold(pr.name), x) = 0)
       and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(pr.name), x) > 0)
       and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
     order by 11 desc, pr.name
     limit least(v_limit, 8);
  end if;

  if 'page' = any(v_kinds) then
    return query
    select x.* from (
      select 'page'::text, pg.id, pg.title, pg.project_id, null::text, pg.team_id, null::text, null::text, null::text, null::text,
             (select case when count(*) = 0 then 1::real when bool_and(q.s >= 0.8) then avg(q.s)::real else 0::real end
                from (select greatest(public.fira_term_score(t, pg.title),
                                      case when length(t) >= 3 and strpos(pg.search_fold, t) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) t) q) as sc,
             pg.updated_at
        from pages pg
       where pg.archived_at is null
         and (v_team_id is null or pg.team_id = v_team_id)
         and (v_team is null or exists (select 1 from teams tm where tm.id = pg.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_after is null or pg.updated_at >= v_after)
         and (v_before is null or pg.updated_at < v_before)
         and not exists (select 1 from unnest(v_phrases) ph
                          where strpos(public.fira_fold(pg.title), ph) = 0 and strpos(pg.search_fold, ph) = 0)
         and not exists (select 1 from unnest(v_not) n where strpos(public.fira_fold(pg.title), n) > 0)
    ) x
     where x.sc > 0
     order by x.sc desc, x.updated_at desc
     limit least(v_limit, 8);
  end if;
end;
$$;

revoke all on function public.palette_search(jsonb) from public, anon;
grant execute on function public.palette_search(jsonb) to authenticated;

-- ========================================
-- 099_turkish_omission_fuzzy.sql
-- ========================================
-- 099: Aramada Türkçe harflere duyarlı mesafe (#06903c11, v0.72.1)
--
-- Sorun: "grev" araması "Görev"i bulmuyordu, "gırev" buluyordu. 082'nin kuralı
-- harfleri katlıyor (ö→o) ve kelime düzeyinde Levenshtein uyguluyor, ama
--   1) 5 harften kısa terim yalnız birebir eşleşiyordu ("grev" 4 harf), ve
--   2) atlanan "ö" herhangi bir yanlış harf kadar (tam bir düzeltme) sayılıyordu.
-- "gırev" katlanınca "girev" (5 harf), "gorev"e 1 düzeltme: 0,8 — sınırda geçiyordu.
--
-- Yeni: Türkçe ağırlıklı Levenshtein (`fira_tr_similarity`). ç ğ ı ö ş ü klavyede
-- yoksa ya ASCII karşılığı yazılır (ö → o: katlamayla bedava) ya da hiç yazılmaz.
-- Bu harflerin **atlanması 0,5**, diğer her düzeltme 1; 3–4 harfli terimde diğer
-- düzeltmelere izin yok (genel yazım hatası kısa kelimede gürültü: "grav", "gorv"
-- "görev"i bulmaz). Kelimenin her önekiyle karşılaştırılır (yarım yazılmış kelime).
--   grev / görev          → 0,5 / 5  → 0,90     gırev / görev (düz yol) → 0,80
--   grevleri / görevleri  → 0,94     gncelleme / güncellemesi (önek) → 0,95
--   skstrma / sıkıştırma  → üç ı atlanmış, ş → s: 1,5 / 10 → 0,85 (karışık yazım)
--   blm / bölüm, srm / sürüm → 0,80
-- Birebir geçen terim yine 1 alır: "grev" araması "Grev" başlığını "Görev"in önüne koyar.
-- İstemcide aynısı: src/lib/fuzzy.ts (`trSimilarity`, `termScore`).
--
-- Hız: ağırlıklı yol plpgsql, yalnız ç ğ ı ö ş ü içeren kelimede ve ön süzgeçten
-- geçen metinde çalışır: terim, metnin bu harfler çıkarılmış hâlinde geçiyorsa ya
-- da terimin c g i o s u dışındaki harfleri (en az 3) metnin aynı harfleri de
-- çıkarılmış hâlinde geçiyorsa (bu harfler katlanabilir ya da atlanabilir; geri
-- kalanlar birebir olmalı). Düz yol (082) değişmedi.
--
-- Yalnız puanlama değişir; `palette_search` ve `fira_all_terms` bunu çağırdığı için
-- palet, liste/takım/durum süzgeçleri ve bağlama çubuğu birlikte düzelir.

create or replace function public.fira_tr_similarity(term text, w text)
returns real
language plpgsql immutable parallel safe strict
as $$
declare
  n int := length(term);
  m int := length(w);
  full_cost real := case when length(term) < 5 then 100 else 1 end;
  prev real[];
  cur real[];
  best real := 0;
  i int;
  j int;
  c text;
begin
  if n = 0 or m = 0 then return 0; end if;
  prev := array_fill(0::real, array[m + 1], array[0]);
  for j in 1..m loop
    c := substr(w, j, 1);
    prev[j] := prev[j - 1] + case when strpos('çğıöşü', c) > 0 then 0.5 else full_cost end;
  end loop;
  for i in 1..n loop
    cur := array_fill(0::real, array[m + 1], array[0]);
    cur[0] := i * full_cost;
    for j in 1..m loop
      c := substr(w, j, 1);
      cur[j] := least(
        prev[j] + full_cost,
        cur[j - 1] + case when strpos('çğıöşü', c) > 0 then 0.5 else full_cost end,
        prev[j - 1] + case when translate(c, 'çğıöşüâîûäß', 'cgiosuaiuas') = substr(term, i, 1) then 0 else full_cost end);
    end loop;
    prev := cur;
  end loop;
  for j in 1..m loop
    best := greatest(best, 1 - prev[j] / greatest(n, j));
  end loop;
  return best;
end
$$;

create or replace function public.fira_term_score(term text, txt text)
returns real
language sql immutable parallel safe
set search_path = public, extensions
as $$
  select case
    when term is null or term = '' then 1::real
    when strpos(public.fira_fold(txt), term) > 0 then 1::real
    when length(term) < 3 then 0::real
    else greatest(
      -- Düz yol (082, değişmedi): 5+ harfli terimde katlanmış kelimeye ve önekine Levenshtein.
      case when length(term) < 5 then 0::real else coalesce((
        select max(greatest(
                 1 - extensions.levenshtein(term, w)::real / greatest(length(term), length(w)),
                 case when length(w) > length(term)
                      then 1 - extensions.levenshtein(term, left(w, length(term)))::real / length(term)
                      else 0 end))
          from regexp_split_to_table(public.fira_fold(txt), '[^a-z0-9]+') w
         where w <> ''), 0)::real end,
      -- Türkçe yol (099): ön süzgeçten geçerse, Türkçe harf içeren kelimelerde ağırlıklı mesafe.
      case when strpos(lower(translate(txt, 'ÂÎÛÄİIâîûäßçğıöşüÇĞÖŞÜ', 'aiuaiiaiuas')), term) = 0
             and (length(translate(term, 'cgiosu', '')) < 3
                  or strpos(translate(lower(translate(txt, 'ÂÎÛÄİIâîûäßçğıöşüÇĞÖŞÜ', 'aiuaiiaiuas')), 'cgiosu', ''),
                            translate(term, 'cgiosu', '')) = 0)
           then 0::real
           else coalesce((
             select max(public.fira_tr_similarity(term, w))
               from regexp_split_to_table(lower(translate(txt, 'ÇĞÖŞÜİIÂÎÛÄ', 'çğöşüiiâîûä')), '[^a-z0-9çğıöşüâîûäß]+') w
              where w ~ '[çğıöşü]'), 0)::real end)
  end
$$;

revoke all on function public.fira_tr_similarity(text, text) from public, anon;
grant execute on function public.fira_tr_similarity(text, text) to authenticated, service_role;

-- ========================================
-- 100_agents.sql
-- ========================================
-- 100: Agent identity and the assignment trigger (#cb43ae36).
-- Phase 1 of the Claude–Fira integration (#a5b096a1; decisions on #d30fc029, 1 Oct 2026).
--
-- Until now an AI account was just a profile with is_ai, and the only way to
-- hand it work was the "Claude'a yaptır" button (059). Two changes:
--
--   1. `agents`: every AI account belongs to a person ("whose Claude") and
--      carries its own settings. One row per AI profile.
--   2. Assigning a ticket to an agent starts the work (a pending row in
--      ai_work_requests, same queue as the button); removing the assignment
--      closes it at once (pending or processing → cancelled).
--
-- Additive only: no existing column, policy or function changes, so the
-- previous frontend keeps working and a rollback is frontend-only.

-- ── Agents ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE, -- the AI account
  owner_id       UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,       -- whose agent it is
  assign_trigger BOOLEAN NOT NULL DEFAULT TRUE,   -- assigning a ticket starts the work
  poll_seconds   INTEGER NOT NULL DEFAULT 300 CHECK (poll_seconds BETWEEN 30 AND 3600), -- fallback poll of the queue
  settings       JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- grows by addition (passive jobs, languages, …)
  runner         JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- what the listener last reported about itself
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agents_owner_idx ON public.agents(owner_id);

-- updated_at follows the settings, not the heartbeat.
DROP TRIGGER IF EXISTS agents_updated_at ON public.agents;
CREATE TRIGGER agents_updated_at
  BEFORE UPDATE OF owner_id, assign_trigger, poll_seconds, settings ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
-- Read: whoever can see the AI account (team mates), its owner, system admins.
-- No write policies: every change goes through the functions below.
DROP POLICY IF EXISTS agents_select ON public.agents;
CREATE POLICY agents_select ON public.agents FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.can_see_profile(profile_id) OR public.is_system_admin());
GRANT SELECT ON public.agents TO authenticated;

-- Every existing AI account becomes an agent. The owner is set per installation
-- (agent_set_owner), like profiles.is_admin — not from a migration.
INSERT INTO public.agents (profile_id)
SELECT p.id FROM public.profiles p WHERE p.is_ai
ON CONFLICT (profile_id) DO NOTHING;

-- Owner (or a system admin) changes the settings. Unknown keys are ignored;
-- `settings` is merged key by key.
CREATE OR REPLACE FUNCTION public.agent_update_settings(p_agent uuid, p_patch jsonb)
RETURNS public.agents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.agents;
BEGIN
  SELECT * INTO v FROM public.agents WHERE id = p_agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ajan bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT (coalesce(v.owner_id = auth.uid(), false) OR public.is_system_admin()) THEN
    RAISE EXCEPTION 'Ajanın ayarlarını yalnız sahibi değiştirebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.agents SET
    assign_trigger = coalesce((p_patch ->> 'assign_trigger')::boolean, assign_trigger),
    -- GREATEST/LEAST skip NULLs, so an absent key must not reach them (it would read as 30).
    poll_seconds   = CASE WHEN (p_patch ->> 'poll_seconds') IS NULL THEN poll_seconds
                          ELSE least(3600, greatest(30, (p_patch ->> 'poll_seconds')::int)) END,
    settings       = CASE WHEN jsonb_typeof(p_patch -> 'settings') = 'object' THEN settings || (p_patch -> 'settings') ELSE settings END
  WHERE id = p_agent
  RETURNING * INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.agent_update_settings(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_update_settings(uuid, jsonb) TO authenticated;

-- System admin binds an agent to a person.
CREATE OR REPLACE FUNCTION public.agent_set_owner(p_agent uuid, p_owner uuid)
RETURNS public.agents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.agents;
BEGIN
  PERFORM public.admin_guard();
  UPDATE public.agents SET owner_id = p_owner WHERE id = p_agent RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ajan bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.agent_set_owner(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_set_owner(uuid, uuid) TO authenticated;

-- The agent reports that its listener is alive and reads back the settings it
-- has to follow (the fallback poll interval is changed from the panel).
CREATE OR REPLACE FUNCTION public.agent_seen(p_runner jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.agents;
BEGIN
  UPDATE public.agents
     SET last_seen_at = now(),
         runner = CASE WHEN jsonb_typeof(p_runner) = 'object' THEN p_runner ELSE runner END
   WHERE profile_id = auth.uid()
  RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu hesap bir ajan değil' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN jsonb_build_object('agent_id', v.id, 'assign_trigger', v.assign_trigger, 'poll_seconds', v.poll_seconds, 'settings', v.settings);
END $$;
REVOKE ALL ON FUNCTION public.agent_seen(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_seen(jsonb) TO authenticated;

-- ── Queue: how a request started, and when it was picked up / closed ─────────
ALTER TABLE public.ai_work_requests
  ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'button' CHECK (source IN ('button', 'assign')),
  ADD COLUMN IF NOT EXISTS claimed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- Stamped here so every path (the button, the bridge script, a future runner)
-- leaves the same trace: pending → processing = claimed, any terminal state = finished.
CREATE OR REPLACE FUNCTION public.ai_work_stamp()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'processing' AND OLD.status = 'pending' THEN
    NEW.claimed_at := now();
  ELSIF NEW.status IN ('done', 'failed', 'cancelled') AND OLD.status IN ('pending', 'processing') THEN
    NEW.finished_at := now();
  ELSIF NEW.status = 'pending' AND OLD.status = 'processing' THEN
    NEW.claimed_at := NULL;   -- handed back to the queue
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ai_work_stamp() FROM public, anon;

DROP TRIGGER IF EXISTS ai_work_stamp ON public.ai_work_requests;
CREATE TRIGGER ai_work_stamp
  BEFORE UPDATE OF status ON public.ai_work_requests
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_stamp();

-- ── Assignment starts the work, removing it closes the work ──────────────────
-- Starts only when a person assigns the agent directly (a write to
-- /ticket_assignees). Assignments made inside a function (copy_ticket,
-- move_ticket, import_bundle, recurrence_spawn, merge_profile) do not start
-- anything: copying a ticket must not put an agent to work on the copy.
-- The agent assigning itself is not a hand-off either.
--
-- Removal by anyone but the agent itself cancels the open request, whatever
-- started it. The agent dropping its own assignment is the normal end of a job
-- (it hands the ticket back for review) and must not cancel its own request.
CREATE OR REPLACE FUNCTION public.ai_work_on_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_agent public.agents;
  v_cat   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_agent FROM public.agents WHERE profile_id = NEW.user_id;
    IF NOT FOUND OR NOT v_agent.assign_trigger THEN RETURN NEW; END IF;
    IF v_actor IS NOT DISTINCT FROM NEW.user_id THEN RETURN NEW; END IF;
    IF coalesce(current_setting('request.path', true), '') !~ '/ticket_assignees$' THEN RETURN NEW; END IF;
    SELECT s.category INTO v_cat
      FROM public.tickets t LEFT JOIN public.ticket_statuses s ON s.id = t.status_id
     WHERE t.id = NEW.ticket_id;
    IF v_cat IN ('done', 'closed') THEN RETURN NEW; END IF;
    -- One open request per ticket (059): the button writes its own row first,
    -- so the assignment it makes afterwards lands here as a no-op.
    INSERT INTO public.ai_work_requests (ticket_id, requested_by, ai_user_id, status, source)
    VALUES (NEW.ticket_id, v_actor, NEW.user_id, 'pending', 'assign')
    ON CONFLICT (ticket_id) WHERE status IN ('pending', 'processing') DO NOTHING;
    RETURN NEW;
  END IF;

  IF v_actor IS NOT DISTINCT FROM OLD.user_id THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE profile_id = OLD.user_id) THEN RETURN OLD; END IF;
  UPDATE public.ai_work_requests
     SET status = 'cancelled',
         detail = coalesce(detail, '') || CASE WHEN coalesce(detail, '') = '' THEN '' ELSE ' · ' END || 'atama kaldırıldı, iş durduruldu',
         updated_at = now()
   WHERE ticket_id = OLD.ticket_id AND ai_user_id = OLD.user_id AND status IN ('pending', 'processing');
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.ai_work_on_assignment() FROM public, anon;

DROP TRIGGER IF EXISTS assignees_ai_work ON public.ticket_assignees;
CREATE TRIGGER assignees_ai_work
  AFTER INSERT OR DELETE ON public.ticket_assignees
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_on_assignment();

-- ========================================
-- 101_agent_tokens.sql
-- ========================================
-- 101: Agent keys (#f8016a5f; phase 1 of the Claude–Fira integration, #a5b096a1).
--
-- Until now the agent's listener reached Fira over SSH and psql as the database
-- superuser: outside RLS, and tied to one person's machine. An agent key
-- replaces that. The owner creates a key in Ayarlar › Claude'um, the key is
-- shown once, and the listener trades it for a short-lived session as the
-- agent's own account — so everything it does goes through PostgREST and RLS
-- like any other member, and a key can be revoked without touching the account.
--
-- Additive only: new table and functions.

CREATE TABLE IF NOT EXISTS public.agent_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,          -- sha256 of the key; the key itself is never stored
  prefix       TEXT NOT NULL,                 -- its first characters, to tell keys apart in the list
  label        TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_tokens_agent_idx ON public.agent_tokens(agent_id);

-- Nobody reads or writes the table directly: RLS on, no policy, no grant.
-- The functions below are the only way in.
ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_tokens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_key_hash(p_key text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
$$;
REVOKE ALL ON FUNCTION public.agent_key_hash(text) FROM public, anon, authenticated;

-- Whether the caller may manage this agent's keys: its owner or a system admin.
CREATE OR REPLACE FUNCTION public.agent_can_manage(p_agent uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_system_admin()
      OR EXISTS (SELECT 1 FROM public.agents a WHERE a.id = p_agent AND a.owner_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.agent_can_manage(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_can_manage(uuid) TO authenticated;

-- A new key. Returned once, in the clear; only its hash is kept.
CREATE OR REPLACE FUNCTION public.agent_create_token(p_agent uuid, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_id  uuid;
BEGIN
  IF NOT public.agent_can_manage(p_agent) THEN
    RAISE EXCEPTION 'Ajanın anahtarlarını yalnız sahibi yönetebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT count(*) FROM public.agent_tokens WHERE agent_id = p_agent AND revoked_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'En fazla beş etkin anahtar olabilir; önce kullanılmayanı iptal et' USING ERRCODE = 'check_violation';
  END IF;
  v_key := 'fira_agt_' || encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.agent_tokens (agent_id, token_hash, prefix, label, created_by)
  VALUES (p_agent, public.agent_key_hash(v_key), left(v_key, 13), nullif(btrim(coalesce(p_label, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'key', v_key, 'prefix', left(v_key, 13));
END $$;
REVOKE ALL ON FUNCTION public.agent_create_token(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_create_token(uuid, text) TO authenticated;

-- The keys of an agent, without anything that could be used to sign in.
CREATE OR REPLACE FUNCTION public.agent_list_tokens(p_agent uuid)
RETURNS TABLE (id uuid, prefix text, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.agent_can_manage(p_agent) THEN
    RAISE EXCEPTION 'Ajanın anahtarlarını yalnız sahibi yönetebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT t.id, t.prefix, t.label, t.created_at, t.last_used_at, t.revoked_at
      FROM public.agent_tokens t
     WHERE t.agent_id = p_agent
     ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.agent_list_tokens(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_list_tokens(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.agent_revoke_token(p_token uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agent uuid;
BEGIN
  SELECT agent_id INTO v_agent FROM public.agent_tokens WHERE id = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anahtar bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT public.agent_can_manage(v_agent) THEN
    RAISE EXCEPTION 'Ajanın anahtarlarını yalnız sahibi yönetebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.agent_tokens SET revoked_at = now() WHERE id = p_token AND revoked_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.agent_revoke_token(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_revoke_token(uuid) TO authenticated;

-- Key → session. The one function here that an anonymous caller may run: the
-- listener has nothing but its key. It answers with a short session signed for
-- the AGENT'S OWN account and nothing else — the subject comes from the key's
-- agent row, never from the caller, and only an account marked is_ai can be
-- signed for. A wrong, revoked or orphaned key gets the same refusal.
--
-- The session lasts 15 minutes and cannot be renewed without the key, so
-- revoking a key shuts out a running listener within that time.
CREATE OR REPLACE FUNCTION public.agent_session(p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token  public.agent_tokens;
  v_agent  public.agents;
  v_secret text := current_setting('app.settings.jwt_secret', true);
  v_now    bigint := extract(epoch FROM now())::bigint;
  v_ttl    constant int := 900;
BEGIN
  IF p_key IS NULL OR p_key !~ '^fira_agt_[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Anahtar geçersiz' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  SELECT * INTO v_token FROM public.agent_tokens WHERE token_hash = public.agent_key_hash(p_key) AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anahtar geçersiz' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  SELECT a.* INTO v_agent
    FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.id = v_token.agent_id AND p.is_ai;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anahtar geçersiz' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Sunucuda oturum imzası ayarlı değil' USING ERRCODE = 'config_file_error';
  END IF;

  -- "Last used" is for the owner's eyes; once a minute is plenty.
  UPDATE public.agent_tokens SET last_used_at = now()
   WHERE id = v_token.id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

  RETURN jsonb_build_object(
    'access_token', extensions.sign(
      json_build_object(
        'role', 'authenticated', 'aud', 'authenticated', 'iss', 'fira-agent',
        'sub', v_agent.profile_id, 'agent_id', v_agent.id, 'key_id', v_token.id,
        'iat', v_now, 'exp', v_now + v_ttl),
      v_secret),
    'token_type', 'bearer',
    'expires_in', v_ttl,
    'expires_at', v_now + v_ttl,
    'user_id', v_agent.profile_id,
    'agent_id', v_agent.id,
    'assign_trigger', v_agent.assign_trigger,
    'poll_seconds', v_agent.poll_seconds);
END $$;
REVOKE ALL ON FUNCTION public.agent_session(text) FROM public;
GRANT EXECUTE ON FUNCTION public.agent_session(text) TO anon, authenticated;

-- ========================================
-- 102_agent_work.sql
-- ========================================
-- 102: Claiming and closing a request, for the agent's own tool (#933a6af6;
-- phase 1 of the Claude–Fira integration, #a5b096a1).
--
-- The bridge script did both with psql as the superuser. The same two steps as
-- functions the agent calls with its own session: they run with the CALLER'S
-- rights (no SECURITY DEFINER), so RLS still decides what the agent may touch,
-- and each answers with what happened instead of failing silently.
--
-- Additive only.

-- pending → processing, once. The answer says why not when it is refused, so
-- the tool can tell "someone cancelled it" from "the ticket was finished
-- meanwhile" from "another listener of mine took it".
CREATE OR REPLACE FUNCTION public.agent_claim(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r        record;
  v_ticket uuid;
BEGIN
  SELECT q.status, q.ticket_id, q.ai_user_id, s.category
    INTO r
    FROM public.ai_work_requests q
    JOIN public.tickets t ON t.id = q.ticket_id
    LEFT JOIN public.ticket_statuses s ON s.id = t.status_id
   WHERE q.id = p_request;
  IF NOT FOUND OR r.ai_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not-found');
  END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'request-' || r.status, 'ticket_id', r.ticket_id);
  END IF;
  IF coalesce(r.category, '') IN ('done', 'closed') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'ticket-' || r.category, 'ticket_id', r.ticket_id);
  END IF;

  -- The condition is repeated in the UPDATE: of two listeners racing for the
  -- same row only one finds it still pending.
  UPDATE public.ai_work_requests
     SET status = 'processing'
   WHERE id = p_request AND status = 'pending'
  RETURNING ticket_id INTO v_ticket;
  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'taken', 'ticket_id', r.ticket_id);
  END IF;
  PERFORM public.agent_seen();
  RETURN jsonb_build_object('claimed', true, 'ticket_id', v_ticket);
END $$;
REVOKE ALL ON FUNCTION public.agent_claim(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_claim(uuid) TO authenticated;

-- processing → done | failed. A request that was cancelled meanwhile (the
-- assignment was removed) stays cancelled; the answer carries the status the
-- row really has, so the tool reports "it was stopped" instead of "done".
CREATE OR REPLACE FUNCTION public.agent_finish(p_request uuid, p_status text, p_detail text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF p_status NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'Durum done ya da failed olmalı' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.ai_work_requests
     SET status = p_status, detail = nullif(btrim(coalesce(p_detail, '')), '')
   WHERE id = p_request AND ai_user_id = auth.uid() AND status = 'processing'
  RETURNING status INTO v_status;
  IF v_status IS NOT NULL THEN
    RETURN jsonb_build_object('finished', true, 'status', v_status);
  END IF;
  SELECT status INTO v_status FROM public.ai_work_requests WHERE id = p_request AND ai_user_id = auth.uid();
  RETURN jsonb_build_object('finished', false, 'status', coalesce(v_status, 'not-found'));
END $$;
REVOKE ALL ON FUNCTION public.agent_finish(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_finish(uuid, text, text) TO authenticated;
