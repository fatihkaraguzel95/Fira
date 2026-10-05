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
