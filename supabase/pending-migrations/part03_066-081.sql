-- Fira migrations 066 -> 081  (part 3/7)
-- Supabase Dashboard -> SQL Editor: bu dosyanin tamamini yapistirip calistirin.
-- Parcalari SIRAYLA calistirin; bir parca hata verirse sonrakine gecmeyin.

-- ========================================
-- 066_pages_storage_refs.sql
-- ========================================
-- 066: Sayfalardaki dosyalar yetim sayılmasın (#AAC9D463)
--
-- admin_orphan_files (051) bir depolama nesnesini, hiçbir sütun ona işaret
-- etmiyorsa "yetim" listeler; Yönetim ekranı bu listeden toplu silme yapar.
-- 064 sayfaları getirdi ve sayfa içeriği (markdown) görsel/dosya URL'leri
-- taşıyor — ama liste sayfalara bakmıyordu: sayfaya yapıştırılan her görsel ve
-- OneNote'tan aktarılacak ~700 dosya yetim görünür, silinebilirdi.
-- Kural (CLAUDE.md, Storage temizliği): yeni bir dosya referansı sütunu bu
-- sorguya da eklenir.

CREATE OR REPLACE FUNCTION public.admin_orphan_files()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    AND NOT EXISTS (SELECT 1 FROM ticket_comments c WHERE c.content LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM pages pg WHERE pg.content LIKE '%/' || o.name || '%');
  RETURN r;
END $function$;

REVOKE ALL ON FUNCTION public.admin_orphan_files() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_orphan_files() TO authenticated;

-- 064'teki tetikleyici fonksiyonu SECURITY DEFINER; doğrudan çağrılamasın
-- (CLAUDE.md, Güvenlik: yeni SECURITY DEFINER fonksiyon → REVOKE).
REVOKE ALL ON FUNCTION public.pages_before_write() FROM public, anon, authenticated;

-- ========================================
-- 067_page_versions_trash.sql
-- ========================================
-- 067: Sayfa sürüm geçmişi, çöp kutusu, içe aktarma koruması (#0EEC220C)
--
-- "İstemeden yapılan hata" hiçbir şeyi geri getirilemez hâle getirmesin:
--  • page_versions: bir sayfanın geçmiş hâlleri. Fira'da düzenlemede tetikleyici
--    yazar; OneNote içe aktarması dosyadaki eski revizyonları buraya getirir.
--  • Çöp kutusu: silme artık yumuşak (pages.archived_at, 064'te vardı). 60 gün
--    sonra kalıcı silinir (OneNote'un geri dönüşüm kutusu gibi). Zamanlanmış
--    görev yok (paylaşımlı sunucuya pg_cron kurmadık): süre dolanlar çöp kutusu
--    açılırken ve bir sayfa silinirken temizlenir.
--  • pages.source_hash: içe aktarılan son içeriğin özeti. Yeniden aktarmada
--    sayfanın özeti tutmuyorsa sayfa Fira'da düzenlenmiştir, üzerine yazılmaz.

-- ── Sürümler ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.page_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id     uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  title       text NOT NULL,
  content     text NOT NULL,
  -- Fira kullanıcısı; OneNote'tan gelen sürümde null olabilir, adı author_name'de.
  author_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name text,
  -- Bu hâlin geçerli olduğu an (o sürümün kaydedilme zamanı).
  saved_at    timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- fira = düzenlemeden önceki hâl; onenote = dosyadaki eski revizyon ya da
  -- Fira'da düzenlenmiş sayfaya gelmeyen OneNote güncellemesi; conflict = çakışmada
  -- kullanıcının kaydedilmeyen taslağı.
  source      text NOT NULL DEFAULT 'fira' CHECK (source IN ('fira', 'onenote', 'conflict')),
  source_ref  text
);

CREATE INDEX IF NOT EXISTS page_versions_page_idx ON public.page_versions(page_id, saved_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS page_versions_source_ref_uq ON public.page_versions(page_id, source_ref) WHERE source_ref IS NOT NULL;

-- Takım, sayfadan türetilir; istemcinin yazdığına güvenilmez.
CREATE OR REPLACE FUNCTION public.page_versions_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT team_id INTO NEW.team_id FROM pages WHERE id = NEW.page_id;
  IF NEW.team_id IS NULL THEN RAISE EXCEPTION 'Sayfa bulunamadı' USING ERRCODE = 'foreign_key_violation'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.page_versions_before_insert() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS page_versions_before_insert ON public.page_versions;
CREATE TRIGGER page_versions_before_insert BEFORE INSERT ON public.page_versions
  FOR EACH ROW EXECUTE FUNCTION public.page_versions_before_insert();

ALTER TABLE public.page_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS page_versions_select ON public.page_versions;
CREATE POLICY page_versions_select ON public.page_versions FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL);

-- Doğrudan ekleme yalnız içe aktarma (onenote) ve çakışma taslağı (conflict) için;
-- olağan sürümleri tetikleyici yazar. Güncelleme/silme yok: geçmiş değişmez,
-- sayfa kalıcı silinince kendiliğinden gider.
DROP POLICY IF EXISTS page_versions_insert ON public.page_versions;
CREATE POLICY page_versions_insert ON public.page_versions FOR INSERT TO authenticated
  WITH CHECK (
    source IN ('onenote', 'conflict')
    AND public.can_write_team(team_id)
    AND (author_id IS NULL OR author_id = auth.uid())
  );

GRANT SELECT, INSERT ON public.page_versions TO authenticated;
REVOKE UPDATE, DELETE ON public.page_versions FROM authenticated, anon;

-- ── Düzenlemede anlık kopya ─────────────────────────────────────────────────
-- Başlık ya da içerik değişince ÖNCEKİ hâl sürüm olur. Otomatik kayıt 1,5 sn'de
-- bir yazdığı için aynı kişinin kesintisiz düzenlemesi tek sürümdür: önceki hâl
-- yine aynı kişiye ait ve 10 dakikadan yeniyse kopya alınmaz (oturumun başındaki
-- hâl zaten alınmıştır). Başka biri düzenlemeye başlarsa hep kopya alınır.
CREATE OR REPLACE FUNCTION public.pages_snapshot_version()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := COALESCE(auth.uid(), NEW.updated_by);
BEGIN
  IF NEW.title IS NOT DISTINCT FROM OLD.title AND NEW.content IS NOT DISTINCT FROM OLD.content THEN
    RETURN NEW;
  END IF;
  -- İçe aktarma / geri yükleme gibi yollar oturum ayarıyla kopyayı kendisi yönetebilir.
  IF current_setting('fira.skip_page_snapshot', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.updated_by IS NOT DISTINCT FROM actor AND OLD.updated_at > now() - interval '10 minutes' THEN
    RETURN NEW;
  END IF;
  -- Boş taslak (yeni açılmış sayfa) sürüm değildir.
  IF btrim(OLD.title) = '' AND btrim(OLD.content) = '' THEN RETURN NEW; END IF;
  INSERT INTO page_versions (page_id, team_id, title, content, author_id, saved_at, source)
  VALUES (OLD.id, OLD.team_id, OLD.title, OLD.content, OLD.updated_by, OLD.updated_at, 'fira');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pages_snapshot_version() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS pages_snapshot_version ON public.pages;
CREATE TRIGGER pages_snapshot_version AFTER UPDATE OF title, content ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.pages_snapshot_version();

-- ── İçe aktarma koruması ────────────────────────────────────────────────────
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS source_hash text;

-- ── Çöp kutusu ──────────────────────────────────────────────────────────────
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Süresi dolanları kalıcı sil (alt sayfalar FK ile gider).
CREATE OR REPLACE FUNCTION public.purge_expired_pages(p_team uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF public.team_role(p_team) IS NULL THEN RAISE EXCEPTION 'Yetki yok' USING ERRCODE = 'insufficient_privilege'; END IF;
  DELETE FROM pages WHERE team_id = p_team AND archived_at < now() - interval '60 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purge_expired_pages(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_pages(uuid) TO authenticated;

-- Sayfayı ve altındaki (henüz çöpte olmayan) sayfaları çöpe at. Yetki silme ile
-- aynı: oluşturan ya da takım yöneticisi.
CREATE OR REPLACE FUNCTION public.trash_page(p_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pg pages%ROWTYPE;
  n int;
  stamp timestamptz := now();
BEGIN
  SELECT * INTO pg FROM pages WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sayfa bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT (public.can_write_team(pg.team_id) AND (pg.created_by = auth.uid() OR public.is_team_admin(pg.team_id))) THEN
    RAISE EXCEPTION 'Bu sayfayı silme yetkin yok' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('fira.skip_page_snapshot', 'on', true);
  WITH RECURSIVE sub AS (
    SELECT id FROM pages WHERE id = p_id
    UNION ALL SELECT c.id FROM pages c JOIN sub ON c.parent_page_id = sub.id WHERE c.archived_at IS NULL
  )
  UPDATE pages SET archived_at = stamp, archived_by = auth.uid() WHERE id IN (SELECT id FROM sub);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.purge_expired_pages(pg.team_id);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.trash_page(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trash_page(uuid) TO authenticated;

-- Geri yükle: sayfa ve onunla aynı anda çöpe giden alt sayfaları. Üst sayfası da
-- çöpteyse o da (yalnız kendisi) geri gelir — sayfa askıda kalmasın.
CREATE OR REPLACE FUNCTION public.restore_page(p_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pg pages%ROWTYPE;
  n int;
  cur uuid;
BEGIN
  SELECT * INTO pg FROM pages WHERE id = p_id;
  IF NOT FOUND OR pg.archived_at IS NULL THEN RETURN 0; END IF;
  IF NOT public.can_write_team(pg.team_id) THEN
    RAISE EXCEPTION 'Bu takımda yazma yetkin yok' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH RECURSIVE sub AS (
    SELECT id FROM pages WHERE id = p_id
    UNION ALL SELECT c.id FROM pages c JOIN sub ON c.parent_page_id = sub.id WHERE c.archived_at = pg.archived_at
  )
  UPDATE pages SET archived_at = NULL, archived_by = NULL WHERE id IN (SELECT id FROM sub);
  GET DIAGNOSTICS n = ROW_COUNT;
  cur := pg.parent_page_id;
  WHILE cur IS NOT NULL LOOP
    UPDATE pages SET archived_at = NULL, archived_by = NULL WHERE id = cur AND archived_at IS NOT NULL;
    SELECT parent_page_id INTO cur FROM pages WHERE id = cur;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.restore_page(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.restore_page(uuid) TO authenticated;

-- ── Yetim dosya: eski sürümlerin görselleri de kullanımda sayılır ───────────
CREATE OR REPLACE FUNCTION public.admin_orphan_files()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    AND NOT EXISTS (SELECT 1 FROM ticket_comments c WHERE c.content LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM pages pg WHERE pg.content LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM page_versions v WHERE v.content LIKE '%/' || o.name || '%');
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.admin_orphan_files() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_orphan_files() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'page_versions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.page_versions;
  END IF;
END $$;

-- ── Sürüme dön ──────────────────────────────────────────────────────────────
-- Geri dönmeden önce o anki hâl HER ZAMAN sürüm olur (tetikleyicinin "aynı kişi,
-- 10 dakika" birleştirmesi burada kayıp demek olurdu). Sonra sayfa o sürümün
-- başlık ve içeriğine döner; eski sürüm silinmez (Confluence gibi).
CREATE OR REPLACE FUNCTION public.restore_page_version(p_version uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v page_versions%ROWTYPE;
  pg pages%ROWTYPE;
  stamp timestamptz;
BEGIN
  SELECT * INTO v FROM page_versions WHERE id = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sürüm bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO pg FROM pages WHERE id = v.page_id;
  IF NOT public.can_write_team(pg.team_id) THEN
    RAISE EXCEPTION 'Bu sayfayı düzenleme yetkin yok' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (btrim(pg.title) = '' AND btrim(pg.content) = '') THEN
    INSERT INTO page_versions (page_id, team_id, title, content, author_id, saved_at, source)
    VALUES (pg.id, pg.team_id, pg.title, pg.content, pg.updated_by, pg.updated_at, 'fira');
  END IF;
  PERFORM set_config('fira.skip_page_snapshot', 'on', true);
  UPDATE pages SET title = v.title, content = v.content WHERE id = pg.id RETURNING updated_at INTO stamp;
  PERFORM set_config('fira.skip_page_snapshot', 'off', true);
  RETURN stamp;
END $$;
REVOKE ALL ON FUNCTION public.restore_page_version(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.restore_page_version(uuid) TO authenticated;

-- ========================================
-- 068_nested_folders.sql
-- ========================================
-- 068: nested folders (#1F44279C: "Klasörün altına klasör de eklenebilir").
-- team_folders.parent_id: a folder may sit inside another folder of the same team.
-- Deleting a folder moves what it holds — lists, pages, subfolders — to its parent
-- (before: lists went to the team root through the FK's SET NULL).

ALTER TABLE public.team_folders ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.team_folders(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS team_folders_parent_idx ON public.team_folders(parent_id);

-- Same team, never inside itself or its own subfolder.
CREATE OR REPLACE FUNCTION public.team_folders_check_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cur uuid; hops int := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Klasör kendi içine taşınamaz.' USING ERRCODE = 'check_violation';
  END IF;
  -- (a parent not there yet is fine: a restore inserts all folders in one
  -- statement and the foreign key checks existence at its end)
  IF EXISTS (SELECT 1 FROM team_folders WHERE id = NEW.parent_id AND team_id <> NEW.team_id) THEN
    RAISE EXCEPTION 'Üst klasör aynı takımda olmalı.' USING ERRCODE = 'check_violation';
  END IF;
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL AND hops < 100 LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Klasör kendi alt klasörünün içine taşınamaz.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_id INTO cur FROM team_folders WHERE id = cur;
    hops := hops + 1;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS team_folders_check_parent ON public.team_folders;
CREATE TRIGGER team_folders_check_parent BEFORE INSERT OR UPDATE OF parent_id ON public.team_folders
  FOR EACH ROW EXECUTE FUNCTION public.team_folders_check_parent();

-- Contents move up one level. Skipped while the whole team is being deleted
-- (the cascade removes everything anyway; moving rows mid-cascade would fight it).
CREATE OR REPLACE FUNCTION public.team_folders_before_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id) THEN RETURN OLD; END IF;
  UPDATE team_folders SET parent_id = OLD.parent_id WHERE parent_id = OLD.id;
  UPDATE projects SET folder_id = OLD.parent_id WHERE folder_id = OLD.id;
  UPDATE pages SET folder_id = OLD.parent_id WHERE folder_id = OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.team_folders_before_delete() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_folders_check_parent() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS team_folders_before_delete ON public.team_folders;
CREATE TRIGGER team_folders_before_delete BEFORE DELETE ON public.team_folders
  FOR EACH ROW EXECUTE FUNCTION public.team_folders_before_delete();

-- Backups carry parent_id (export reads select *); restore/copy keeps the nesting.
CREATE OR REPLACE FUNCTION public.import_bundle(p_bundle jsonb, p_mode text, p_target_team uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  me uuid := auth.uid();
  v_bundle_team uuid;
  v_team uuid;
  v_counts jsonb := '{}'::jsonb;
  v_unmapped text[];
  n int;
  has_owner boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Oturum yok'; END IF;
  IF p_mode NOT IN ('restore', 'skip', 'copy') THEN RAISE EXCEPTION 'Geçersiz mod: %', p_mode; END IF;
  IF coalesce((p_bundle->>'schema_version')::int, 0) <> 1 THEN RAISE EXCEPTION 'Desteklenmeyen yedek şeması (v%)', p_bundle->>'schema_version'; END IF;
  v_bundle_team := (p_bundle->'team'->>'id')::uuid;

  CREATE TEMP TABLE _ids (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE _users (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP;

  -- users by e-mail
  INSERT INTO _users
  SELECT (p->>'id')::uuid, pr.id
  FROM jsonb_array_elements(coalesce(p_bundle->'profiles', '[]')) p
  JOIN profiles pr ON lower(pr.email) = lower(p->>'email')
  ON CONFLICT DO NOTHING;
  SELECT coalesce(array_agg(p->>'email'), '{}') INTO v_unmapped
  FROM jsonb_array_elements(coalesce(p_bundle->'profiles', '[]')) p
  WHERE NOT EXISTS (SELECT 1 FROM _users u WHERE u.old = (p->>'id')::uuid);

  -- entity ids
  INSERT INTO _ids
  SELECT (e->>'id')::uuid, CASE WHEN p_mode = 'copy' THEN gen_random_uuid() ELSE (e->>'id')::uuid END
  FROM (
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'team_colors', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'team_folders', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'projects', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_statuses', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'tags', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_comments', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_attachments', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_deadlines', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_links', '[]')) e
  ) x
  WHERE e ? 'id'
  ON CONFLICT DO NOTHING;

  -- ── team ────────────────────────────────────────────────────────────────
  IF p_mode = 'copy' THEN
    IF p_target_team IS NOT NULL THEN
      IF NOT public.is_team_admin(p_target_team) THEN RAISE EXCEPTION 'Hedef takımda yönetici değilsiniz'; END IF;
      v_team := p_target_team;
    ELSE
      v_team := gen_random_uuid();
      INSERT INTO teams (id, name, code, created_by)
      VALUES (v_team, (p_bundle->'team'->>'name') || ' (kopya)', upper(substr(md5(random()::text), 1, 8)), me);
      INSERT INTO team_members (team_id, user_id, role) VALUES (v_team, me, 'owner') ON CONFLICT DO NOTHING; -- a teams trigger may already add the creator
    END IF;
  ELSE
    v_team := v_bundle_team;
    IF EXISTS (SELECT 1 FROM teams WHERE id = v_team) THEN
      IF NOT public.is_team_admin(v_team) THEN RAISE EXCEPTION 'Bu takımda yönetici değilsiniz'; END IF;
      IF p_mode = 'restore' THEN
        UPDATE teams SET name = p_bundle->'team'->>'name' WHERE id = v_team;
      END IF;
    ELSE
      INSERT INTO teams (id, name, code, created_by, created_at)
      VALUES (v_team, p_bundle->'team'->>'name', coalesce(p_bundle->'team'->>'code', upper(substr(md5(random()::text), 1, 8))), me, coalesce((p_bundle->'team'->>'created_at')::timestamptz, now()));
      INSERT INTO team_members (team_id, user_id, role) VALUES (v_team, me, 'owner') ON CONFLICT DO NOTHING; -- a teams trigger may already add the creator
    END IF;
  END IF;
  INSERT INTO _ids VALUES (v_bundle_team, v_team) ON CONFLICT (old) DO UPDATE SET new = EXCLUDED.new;

  -- ── members (only users that exist here; never demote/replace the owner) ──
  SELECT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_team AND role = 'owner') INTO has_owner;
  INSERT INTO team_members (team_id, user_id, role, joined_at)
  SELECT v_team, u.new,
         CASE WHEN m->>'role' = 'owner' AND has_owner THEN 'admin' ELSE coalesce(m->>'role', 'member') END,
         coalesce((m->>'joined_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'members', '[]')) m
  JOIN _users u ON u.old = (m->>'user_id')::uuid
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('members', n);

  -- ── colours ───────────────────────────────────────────────────────────
  INSERT INTO team_colors (id, team_id, name, hex, order_index, created_at)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', e->>'hex', coalesce((e->>'order_index')::int, 0), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'team_colors', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, hex = EXCLUDED.hex, order_index = EXCLUDED.order_index
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('team_colors', n);

  -- ── folders ───────────────────────────────────────────────────────────
  INSERT INTO team_folders (id, team_id, name, color_id, order_index, created_by, created_at, parent_id)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', imp_id((e->>'color_id')::uuid), coalesce((e->>'order_index')::int, 0), imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()), imp_id((e->>'parent_id')::uuid)
  FROM jsonb_array_elements(coalesce(p_bundle->'team_folders', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color_id = EXCLUDED.color_id, order_index = EXCLUDED.order_index, parent_id = EXCLUDED.parent_id
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('team_folders', n);

  -- ── lists (projects) ──────────────────────────────────────────────────
  INSERT INTO projects (id, team_id, name, description, created_by, created_at, archived, folder_id, icon, icon_url, color_id, order_index)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', e->>'description', imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()),
         coalesce((e->>'archived')::boolean, false), imp_id((e->>'folder_id')::uuid), e->>'icon', e->>'icon_url', imp_id((e->>'color_id')::uuid), coalesce((e->>'order_index')::int, 0)
  FROM jsonb_array_elements(coalesce(p_bundle->'projects', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, archived = EXCLUDED.archived, folder_id = EXCLUDED.folder_id,
    icon = EXCLUDED.icon, icon_url = EXCLUDED.icon_url, color_id = EXCLUDED.color_id, order_index = EXCLUDED.order_index
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('projects', n);

  -- ── statuses ──────────────────────────────────────────────────────────
  INSERT INTO ticket_statuses (id, project_id, name, color, order_index, category, is_cancelled)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'project_id')::uuid), e->>'name', coalesce(e->>'color', '#6b7280'), coalesce((e->>'order_index')::int, 0),
         coalesce(e->>'category', 'active'), coalesce((e->>'is_cancelled')::boolean, false)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_statuses', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, order_index = EXCLUDED.order_index, category = EXCLUDED.category, is_cancelled = EXCLUDED.is_cancelled
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_statuses', n);

  -- ── tags ──────────────────────────────────────────────────────────────
  INSERT INTO tags (id, project_id, name, color, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'project_id')::uuid), e->>'name', coalesce(e->>'color', '#6b7280'), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'tags', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tags', n);

  -- ── tickets (parents first: insert everything without parent_id, then link) ──
  INSERT INTO tickets (id, title, description, status, status_id, priority, assignee_id, due_date, created_by, created_at, updated_at, order_index, project_id, updated_by, archived_at, parent_id)
  SELECT imp_id((e->>'id')::uuid), e->>'title', e->>'description', coalesce(e->>'status', 'todo'), imp_id((e->>'status_id')::uuid),
         CASE WHEN e->>'priority' IN ('low','medium','high','critical') THEN (e->>'priority')::ticket_priority ELSE NULL END,
         (SELECT new FROM _users WHERE old = (e->>'assignee_id')::uuid), (e->>'due_date')::date,
         imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()), coalesce((e->>'updated_at')::timestamptz, now()),
         coalesce((e->>'order_index')::int, 0), imp_id((e->>'project_id')::uuid), (SELECT new FROM _users WHERE old = (e->>'updated_by')::uuid),
         (e->>'archived_at')::timestamptz, NULL
  FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, status_id = EXCLUDED.status_id,
    priority = EXCLUDED.priority, due_date = EXCLUDED.due_date, updated_at = EXCLUDED.updated_at, order_index = EXCLUDED.order_index,
    project_id = EXCLUDED.project_id, archived_at = EXCLUDED.archived_at
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tickets', n);

  UPDATE tickets t SET parent_id = imp_id((e->>'parent_id')::uuid)
  FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e
  WHERE t.id = imp_id((e->>'id')::uuid) AND e->>'parent_id' IS NOT NULL
    AND (p_mode <> 'skip' OR t.parent_id IS NULL)
    AND EXISTS (SELECT 1 FROM tickets p WHERE p.id = imp_id((e->>'parent_id')::uuid));

  -- ── assignees / tags / deadlines / comments / attachments / links ─────
  INSERT INTO ticket_assignees (ticket_id, user_id)
  SELECT imp_id((e->>'ticket_id')::uuid), u.new
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_assignees', '[]')) e JOIN _users u ON u.old = (e->>'user_id')::uuid
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_assignees', n);

  INSERT INTO ticket_tag_assignments (ticket_id, tag_id)
  SELECT imp_id((e->>'ticket_id')::uuid), imp_id((e->>'tag_id')::uuid)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_tag_assignments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid)) AND EXISTS (SELECT 1 FROM tags g WHERE g.id = imp_id((e->>'tag_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_tag_assignments', n);

  INSERT INTO ticket_deadlines (id, ticket_id, date, description, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), (e->>'date')::date, e->>'description', coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_deadlines', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, description = EXCLUDED.description WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_deadlines', n);

  INSERT INTO ticket_comments (id, ticket_id, author_id, content, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), imp_user((e->>'author_id')::uuid, me), e->>'content', coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_comments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_comments', n);

  INSERT INTO ticket_attachments (id, ticket_id, file_url, file_name, uploaded_by, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), e->>'file_url', e->>'file_name', imp_user((e->>'uploaded_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_attachments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET file_url = EXCLUDED.file_url, file_name = EXCLUDED.file_name WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_attachments', n);

  INSERT INTO ticket_links (id, ticket_id, linked_ticket_id, created_by, created_at, order_index)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), imp_id((e->>'linked_ticket_id')::uuid), imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()), coalesce((e->>'order_index')::int, 0)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_links', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid)) AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'linked_ticket_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_links', n);

  RETURN jsonb_build_object(
    'mode', p_mode,
    'team_id', v_team,
    'counts', v_counts,
    'unmapped_users', to_jsonb(v_unmapped),
    'id_map', CASE WHEN p_mode = 'copy' THEN (SELECT coalesce(jsonb_object_agg(old, new), '{}') FROM _ids) ELSE '{}'::jsonb END
  );
END $function$;

-- ========================================
-- 069_admin_pages.sql
-- ========================================
-- Yönetim paneli sayfaları da görsün (#87BB78EE).
--
-- 064–068 sayfaları, sürümleri, çöp kutusunu, iç içe klasörleri ve OneNote
-- aktarımını getirdi; Yönetim ekranı bunların hiçbirini göstermiyordu:
-- "kaç sayfa var, kaç sürüm birikti, çöpte ne bekliyor, aktarım ne zaman oldu"
-- sorularının cevabı yalnızca SQL ile alınabiliyordu.
--
-- admin_overview() JSONB döndürüyor; yeni anahtarlar eklemek eski istemciyi
-- bozmaz (bilmediği anahtarı okumaz). Sayım yapılan her şey admin_guard()
-- arkasında kalır.

CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'teams', (SELECT count(*) FROM teams),
    'lists', (SELECT count(*) FROM projects),
    'folders', (SELECT count(*) FROM team_folders),
    'users', (SELECT count(*) FROM profiles),
    'tickets', (SELECT count(*) FROM tickets WHERE parent_id IS NULL),
    'subtasks', (SELECT count(*) FROM tickets WHERE parent_id IS NOT NULL),
    'open_tickets', (SELECT count(*) FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.archived_at IS NULL AND coalesce(s.category, 'active') NOT IN ('closed', 'done')),
    'comments', (SELECT count(*) FROM ticket_comments),
    'attachments', (SELECT count(*) FROM ticket_attachments),
    -- Sayfalar (064) ve sürümleri (067)
    'pages', (SELECT count(*) FROM pages WHERE archived_at IS NULL),
    'pages_trashed', (SELECT count(*) FROM pages WHERE archived_at IS NOT NULL),
    -- 60 günü dolmuş, ilk çöp listesi açılışında purge_expired_pages ile gidecek olanlar
    'pages_purge_due', (SELECT count(*) FROM pages WHERE archived_at IS NOT NULL AND archived_at < now() - interval '60 days'),
    'page_versions', (SELECT count(*) FROM page_versions),
    -- Sayfa nereden geldi: elle yazılan, OneNote'tan aktarılan, tablodan gelen
    'pages_by_source', (
      SELECT coalesce(jsonb_object_agg(src, n), '{}'::jsonb)
      FROM (SELECT coalesce(source, 'manual') src, count(*) n FROM pages WHERE archived_at IS NULL GROUP BY 1) s
    ),
    'last_page_import', (SELECT max(created_at) FROM pages WHERE source = 'onenote'),
    'last_page_edit', (SELECT max(updated_at) FROM pages WHERE archived_at IS NULL),
    -- Sayfaların/sürümlerin gösterdiği depolama nesneleri (admin_orphan_files'ın saydığı küme değil,
    -- yalnızca kaç dosyaya bağlı olduğumuzu gösterir)
    'page_files', (
      SELECT count(DISTINCT m[1]) FROM (
        SELECT regexp_matches(content, '/object/public/ticket-attachments/([^)"''[:space:]]+)', 'g') m FROM pages WHERE content IS NOT NULL
        UNION ALL
        SELECT regexp_matches(content, '/object/public/ticket-attachments/([^)"''[:space:]]+)', 'g') m FROM page_versions WHERE content IS NOT NULL
      ) x
    ),
    -- "Claude'a yaptır" kuyruğu (059)
    'ai_requests', (
      SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      FROM (SELECT status, count(*) n FROM ai_work_requests GROUP BY 1) a
    ),
    'last_ai_request', (SELECT max(created_at) FROM ai_work_requests),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'storage_bytes', (SELECT coalesce(sum((metadata->>'size')::bigint), 0) FROM storage.objects),
    'db_bytes', pg_database_size(current_database()),
    'active_users_7d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '7 days'),
    'active_users_30d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '30 days'),
    'pg_version', current_setting('server_version'),
    'last_status', (SELECT jsonb_build_object('collected_at', collected_at, 'payload', payload) FROM system_status ORDER BY collected_at DESC LIMIT 1),
    'last_deploy', (SELECT jsonb_build_object('deployed_at', deployed_at, 'version', version, 'bundle', bundle, 'note', note) FROM deploy_log ORDER BY deployed_at DESC LIMIT 1),
    'settings', (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM system_settings),
    'realtime_tables', (SELECT coalesce(jsonb_agg(tablename ORDER BY tablename), '[]'::jsonb) FROM pg_publication_tables WHERE pubname = 'supabase_realtime'),
    'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit)), '[]'::jsonb) FROM storage.buckets)
  ) INTO r;
  RETURN r;
END $$;

-- En çok sayfa tutan takımlar + çöp kutusunda bekleyenler: "ne nerede duruyor"
-- sorusunun panelden cevabı.
CREATE OR REPLACE FUNCTION public.admin_pages() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'by_team', (
      SELECT coalesce(jsonb_agg(x ORDER BY (x->>'pages')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'team', t.name,
          'pages', count(*) FILTER (WHERE p.archived_at IS NULL),
          'trashed', count(*) FILTER (WHERE p.archived_at IS NOT NULL),
          'imported', count(*) FILTER (WHERE p.archived_at IS NULL AND p.source = 'onenote'),
          'versions', (SELECT count(*) FROM page_versions v JOIN pages q ON q.id = v.page_id WHERE q.team_id = t.id),
          'last_edit', max(p.updated_at)
        ) x
        FROM teams t JOIN pages p ON p.team_id = t.id
        GROUP BY t.id, t.name
      ) s
    ),
    'trash_soon', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'team', t.name, 'archived_at', p.archived_at) ORDER BY p.archived_at), '[]'::jsonb)
      FROM pages p JOIN teams t ON t.id = p.team_id
      WHERE p.archived_at IS NOT NULL AND p.archived_at < now() - interval '53 days'
    )
  ) INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.admin_pages() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_pages() TO authenticated;

-- ========================================
-- 070_admin_pages_fast.sql
-- ========================================
-- 069'daki "sayfaların gösterdiği dosya sayısı" alanı, bütün sayfa ve sürüm
-- içeriklerinde regex araması yapıyordu: admin_overview() 7,5 saniye sürmeye
-- başladı (ölçüldü; aramanın kendisi 7,4 sn). Yönetim ekranı her açılışta bunu
-- çağırıyor.
--
-- Aynı bilgi depolama yolundan çok daha ucuza çıkıyor: sayfa dosyaları
-- `<kullanıcı>/<sayfa id>/…` altına yükleniyor (064), yani ikinci yol parçası
-- bir sayfa id'si ise o nesne bir sayfaya ait. Üstelik boyutu da verir.

CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB; pf JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object('n', count(*), 'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0))
    INTO pf
    FROM storage.objects o
   WHERE split_part(o.name, '/', 2) IN (SELECT id::text FROM pages);
  SELECT jsonb_build_object(
    'teams', (SELECT count(*) FROM teams),
    'lists', (SELECT count(*) FROM projects),
    'folders', (SELECT count(*) FROM team_folders),
    'users', (SELECT count(*) FROM profiles),
    'tickets', (SELECT count(*) FROM tickets WHERE parent_id IS NULL),
    'subtasks', (SELECT count(*) FROM tickets WHERE parent_id IS NOT NULL),
    'open_tickets', (SELECT count(*) FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.archived_at IS NULL AND coalesce(s.category, 'active') NOT IN ('closed', 'done')),
    'comments', (SELECT count(*) FROM ticket_comments),
    'attachments', (SELECT count(*) FROM ticket_attachments),
    'pages', (SELECT count(*) FROM pages WHERE archived_at IS NULL),
    'pages_trashed', (SELECT count(*) FROM pages WHERE archived_at IS NOT NULL),
    'pages_purge_due', (SELECT count(*) FROM pages WHERE archived_at IS NOT NULL AND archived_at < now() - interval '60 days'),
    'page_versions', (SELECT count(*) FROM page_versions),
    'pages_by_source', (
      SELECT coalesce(jsonb_object_agg(src, n), '{}'::jsonb)
      FROM (SELECT coalesce(source, 'manual') src, count(*) n FROM pages WHERE archived_at IS NULL GROUP BY 1) s
    ),
    'last_page_import', (SELECT max(created_at) FROM pages WHERE source = 'onenote'),
    'last_page_edit', (SELECT max(updated_at) FROM pages WHERE archived_at IS NULL),
    'page_files', pf->'n',
    'page_bytes', pf->'bytes',
    'ai_requests', (
      SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      FROM (SELECT status, count(*) n FROM ai_work_requests GROUP BY 1) a
    ),
    'last_ai_request', (SELECT max(created_at) FROM ai_work_requests),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'storage_bytes', (SELECT coalesce(sum((metadata->>'size')::bigint), 0) FROM storage.objects),
    'db_bytes', pg_database_size(current_database()),
    'active_users_7d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '7 days'),
    'active_users_30d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '30 days'),
    'pg_version', current_setting('server_version'),
    'last_status', (SELECT jsonb_build_object('collected_at', collected_at, 'payload', payload) FROM system_status ORDER BY collected_at DESC LIMIT 1),
    'last_deploy', (SELECT jsonb_build_object('deployed_at', deployed_at, 'version', version, 'bundle', bundle, 'note', note) FROM deploy_log ORDER BY deployed_at DESC LIMIT 1),
    'settings', (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM system_settings),
    'realtime_tables', (SELECT coalesce(jsonb_agg(tablename ORDER BY tablename), '[]'::jsonb) FROM pg_publication_tables WHERE pubname = 'supabase_realtime'),
    'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit)), '[]'::jsonb) FROM storage.buckets)
  ) INTO r;
  RETURN r;
END $$;

-- ========================================
-- 071_orphan_files_fast.sql
-- ========================================
-- Yetim dosya listesi 500 dönüyordu (#F236F25C).
--
-- Eski sorgu her depolama nesnesi için her metin sütununda ayrı `LIKE '%…%'`
-- taraması yapıyordu: 8.765 nesne × (görev + yorum + sayfa + sürüm) satırları.
-- Sayfalar (064) ve sürümleri (067) geldikçe maliyet patladı — ölçüm: yalnız
-- `pages` şartı 97 sn, 400 nesnelik örnekte bütün şartlar 151 sn. PostgREST'in
-- 8 sn'lik `statement_timeout`'una takılıp 500 dönüyordu.
--
-- Yeni yol: referans verilen yollar **bir kez** çıkarılır (metinler yalnız bir
-- kez taranır), sonra depolama nesneleriyle anti-join yapılır: 4,6 sn.
-- Doğrulama: 400 nesnelik örnekte iki yöntem birebir aynı sonucu verdi
-- (0 fark, 129 referanslı).
--
-- Dönüş şekli de değişti: liste artık ilk 1000 ile sınırlı, toplam sayı ve
-- boyut ayrıca dönüyor — 6.000 satırlık tabloyu tarayıcıya yıkmak ve hepsini
-- tek silme isteğine koymak kendi başına bir sorundu.

CREATE OR REPLACE FUNCTION public.admin_orphan_files()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  -- Bakım sorgusu: 8 sn'lik varsayılan sınır bunun için fazla dar.
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
  ), refs AS MATERIALIZED (
    -- Bir metinde geçen her depolama yolu. Parçalama + baştan eşleme, global
    -- regexp taramasından ucuz; yollarımız kaçışsız (ASCII) üretiliyor.
    SELECT DISTINCT substring(piece FROM '^[^)"''[:space:]]+') AS path
    FROM src, LATERAL regexp_split_to_table(src.txt, '/object/public/ticket-attachments/') WITH ORDINALITY AS t(piece, n)
    WHERE t.n > 1
  ), orph AS MATERIALIZED (
    SELECT o.name, (o.metadata->>'size')::bigint AS size, o.created_at
    FROM storage.objects o
    WHERE o.bucket_id = 'ticket-attachments'
      AND o.name NOT LIKE '%/'                      -- klasör kayıtları
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
-- 072_orphan_refs_strip_query.sql
-- ========================================
-- Yetim dosya taraması avatarları yetim sanıyordu (#7EFB0246).
--
-- 071 referansları metinden çıkarırken yolu olduğu gibi alıyordu; avatar
-- adresleri ise önbellek kırmak için "?t=…" ile saklanıyor:
--   profiles.avatar_url = …/ticket-attachments/avatars/<id>/avatar.webp?t=1
-- Depolamadaki nesnenin adı "avatars/<id>/avatar.webp" olduğu için eşleşme
-- tutmadı, dosya yetim listesine düştü ve yönetim temizliğinde silindi.
-- (051'deki eski sorgu `LIKE '%' || o.name || '%'` yaptığı için sorgu dizesi
-- zararsızdı; hız düzeltmesiyle birlikte bu tolerans kayboldu.)
--
-- Düzeltme: çıkarılan her yoldan sorgu dizesi ve çapa (#…) atılır — istemci
-- tarafındaki `storagePathFromUrl` ile aynı kural. Ayrıca yüzde kaçışlı yollar
-- için çözülmüş hâl de referans sayılır (bugün böyle bir ad yok; adres
-- kodlaması dosya adına Türkçe harf ya da boşluk girdiği gün aynı kaza
-- tekrarlamasın diye).

CREATE OR REPLACE FUNCTION public.url_decode(input text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path TO 'public' AS $function$
DECLARE bin bytea := ''; piece text;
BEGIN
  IF position('%' in input) = 0 THEN RETURN input; END IF;
  FOR piece IN SELECT (regexp_matches(input, '(%[0-9a-fA-F]{2}|.)', 'g'))[1] LOOP
    IF length(piece) = 3 THEN bin := bin || decode(substring(piece, 2, 2), 'hex');
    ELSE bin := bin || convert_to(piece, 'utf8'); END IF;
  END LOOP;
  RETURN convert_from(bin, 'utf8');
EXCEPTION WHEN others THEN RETURN input;   -- bozuk kaçış: ham hâli kullan
END $function$;

REVOKE ALL ON FUNCTION public.url_decode(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.url_decode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_orphan_files()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  -- Bakım sorgusu: 8 sn'lik varsayılan sınır bunun için fazla dar.
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
  ), raw AS MATERIALIZED (
    -- Bir metinde geçen her depolama yolu. Parçalama + baştan eşleme, global
    -- regexp taramasından ucuz.
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
      AND o.name NOT LIKE '%/'                      -- klasör kayıtları
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
-- 073_team_invites_inbox.sql
-- ========================================
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

-- ========================================
-- 074_ai_work_cancel_on_done.sql
-- ========================================
-- "Claude'a yaptır" kuyruğu: bitmiş göreve iş yapılmasın (#10BE8F38, 15 Eyl).
--
-- İki olay: (1) Kullanıcı istek kuyruktayken görevi "Tamamlandı" yaptı, istek
-- pending kaldı ve AI yine işledi. (2) Kullanıcı "İptal"e bastı, istek
-- cancelled oldu, ama AI işe başlarken durumu koşulsuz "processing" yazıp
-- iptali ezdi.
--
-- Veritabanı tarafı: görev tamamlanan/kapatılan bir duruma geçince o görevin
-- bekleyen istekleri iptal olur. İşe başlama koşulu (yalnız pending → processing)
-- köprü betiğinde (`~/.fira_ai_claim.sh`); burada ayrıca bir "cancelled'ı
-- processing'e çevirme" koruması var ki köprü unutsa bile iptal ezilemesin.

CREATE OR REPLACE FUNCTION public.ai_work_cancel_on_done()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cat text;
BEGIN
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT category INTO v_cat FROM ticket_statuses WHERE id = NEW.status_id;
    IF v_cat IN ('done', 'closed') THEN
      UPDATE ai_work_requests
         SET status = 'cancelled',
             detail = coalesce(detail, '') || CASE WHEN coalesce(detail, '') = '' THEN '' ELSE ' · ' END || 'görev tamamlandı, istek iptal edildi',
             updated_at = now()
       WHERE ticket_id = NEW.id AND status = 'pending';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tickets_ai_work_cancel_on_done ON public.tickets;
CREATE TRIGGER tickets_ai_work_cancel_on_done
  AFTER UPDATE OF status_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_cancel_on_done();

-- İptal edilmiş ya da bitmiş bir istek yeniden "processing" olamaz.
CREATE OR REPLACE FUNCTION public.ai_work_guard_transitions()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'processing' AND OLD.status IN ('cancelled', 'done', 'failed') THEN
    RAISE EXCEPTION 'İstek % durumunda, yeniden başlatılamaz', OLD.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_work_guard_transitions ON public.ai_work_requests;
CREATE TRIGGER ai_work_guard_transitions
  BEFORE UPDATE OF status ON public.ai_work_requests
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_guard_transitions();

-- ========================================
-- 075_user_favorites.sql
-- ========================================
-- Favoriler (#D6B3097E): kişiye özel sabitlenmiş görev / sayfa / liste.
--
-- Arama yalnız görevlerde çalıştığı için sık gidilen şeylere tek tıkla ulaşmak
-- istendi. Her satır tek bir hedefe bağlanır (üç nullable FK, `num_nonnulls = 1`
-- — sayfaların üst nesne kalıbı, 064); hedef silinince satır da gider. Satır
-- yalnız sahibinindir: başkasının favorisi görünmez, RLS sahibe kilitli.
--
-- "Son açılanlar" tabloya yazılmaz: `user_preferences` (global) içinde
-- `recents` anahtarı olarak durur — sayaçtır, veri değil.

CREATE TABLE IF NOT EXISTS public.user_favorites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ticket_id   uuid REFERENCES public.tickets(id) ON DELETE CASCADE,
  page_id     uuid REFERENCES public.pages(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  order_index int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_favorites_one_target CHECK (num_nonnulls(ticket_id, page_id, project_id) = 1)
);

-- Aynı şey iki kez favorilenemez.
CREATE UNIQUE INDEX IF NOT EXISTS user_favorites_ticket_uq  ON public.user_favorites(user_id, ticket_id)  WHERE ticket_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_favorites_page_uq    ON public.user_favorites(user_id, page_id)    WHERE page_id    IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_favorites_project_uq ON public.user_favorites(user_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_favorites_user_idx ON public.user_favorites(user_id, order_index, created_at);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_favorites_select ON public.user_favorites;
DROP POLICY IF EXISTS user_favorites_insert ON public.user_favorites;
DROP POLICY IF EXISTS user_favorites_update ON public.user_favorites;
DROP POLICY IF EXISTS user_favorites_delete ON public.user_favorites;
CREATE POLICY user_favorites_select ON public.user_favorites FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Yalnız görebildiği bir şeyi favorileyebilir: hedefin RLS'i zaten okumayı sınırlar,
-- burada ek olarak hedefin takımına üye olması istenir.
CREATE POLICY user_favorites_insert ON public.user_favorites FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND (
      (ticket_id  IS NOT NULL AND public.team_role(public.ticket_team(ticket_id)) IS NOT NULL) OR
      (page_id    IS NOT NULL AND public.team_role((SELECT team_id FROM public.pages    WHERE id = page_id))    IS NOT NULL) OR
      (project_id IS NOT NULL AND public.team_role((SELECT team_id FROM public.projects WHERE id = project_id)) IS NOT NULL)
    )
  );
CREATE POLICY user_favorites_update ON public.user_favorites FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_favorites_delete ON public.user_favorites FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_favorites TO authenticated;
REVOKE ALL ON public.user_favorites FROM anon;

-- Kenar çubuğu canlı kalsın (başka sekmede eklenen favori burada da görünsün).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_favorites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_favorites;
  END IF;
END $$;
ALTER TABLE public.user_favorites REPLICA IDENTITY FULL;

-- ========================================
-- 076_mentions.sql
-- ========================================
-- 076: @mentions in comments and descriptions (#3461B7F0)
--
-- The editor writes a mention as a markdown link `[@Name](fira://u/<user id>)`,
-- so the text stays readable anywhere markdown is shown. The server reads those
-- links back: every newly mentioned team member gets a `mentioned` activity row
-- (meta.user_id, like assignee_added) and, through the usual fanout, an inbox
-- row / toast / Telegram message with event `mention`. A mention is personal:
-- it reaches the mentioned user even when they are neither assigned nor the
-- creator, and even when they muted the task.

-- ── Who is mentioned in a text ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mention_user_ids(p_text text)
RETURNS uuid[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(DISTINCT m[1]::uuid), '{}'::uuid[])
  FROM regexp_matches(coalesce(p_text, ''), 'fira://u/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g') AS m
$$;

-- Log one `mentioned` row per user who is in the text now, was not before, is a
-- member of the task's team and is not the author. Bulk imports never mention.
CREATE OR REPLACE FUNCTION public.log_mentions(p_ticket uuid, p_new text, p_old text, p_meta jsonb, p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  v_uid  uuid;
BEGIN
  IF p_ticket IS NULL OR p_new IS NULL OR position('fira://u/' in p_new) = 0 THEN RETURN; END IF;
  SELECT p.team_id INTO v_team FROM public.tickets t JOIN public.projects p ON p.id = t.project_id WHERE t.id = p_ticket;
  IF v_team IS NULL THEN RETURN; END IF;
  FOREACH v_uid IN ARRAY public.mention_user_ids(p_new) LOOP
    CONTINUE WHEN v_uid = p_actor;
    CONTINUE WHEN v_uid = ANY (public.mention_user_ids(p_old));
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = v_team AND tm.user_id = v_uid);
    PERFORM public.log_activity(p_ticket, 'mentioned', NULL, left(p_new, 120),
      coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('user_id', v_uid, 'user_name', public.person_name(v_uid)), p_actor);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.log_mentions(uuid, text, text, jsonb, uuid) FROM public, anon, authenticated;

-- ── Comments: mentions in a new comment ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.comments_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'comment_added', NULL, left(NEW.content, 120), '{}'::jsonb, NEW.author_id);
    PERFORM public.log_mentions(NEW.ticket_id, NEW.content, NULL, jsonb_build_object('comment_id', NEW.id), NEW.author_id);
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'comment_removed', left(OLD.content, 120), NULL, '{}'::jsonb);
  RETURN OLD;
END $$;

-- ── Descriptions: mentions added to a task's description ──────────────────────
-- A separate trigger so tickets_activity() (046) stays as it is.
CREATE OR REPLACE FUNCTION public.tickets_mentions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := COALESCE(public.activity_actor(),
                         CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by
                              WHEN NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_mentions(NEW.id, NEW.description, NULL, '{"field":"description"}'::jsonb, actor);
  ELSIF NEW.description IS DISTINCT FROM OLD.description THEN
    PERFORM public.log_mentions(NEW.id, NEW.description, OLD.description, '{"field":"description"}'::jsonb, actor);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tickets_mentions ON public.tickets;
CREATE TRIGGER tickets_mentions AFTER INSERT OR UPDATE OF description ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_mentions();

-- ── Recipients: a mention goes to the mentioned person, mute or not ───────────
CREATE OR REPLACE FUNCTION public.activity_recipients(p_activity uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (
    SELECT id, ticket_id, actor_id, kind, meta FROM public.ticket_activity WHERE id = p_activity
  )
  SELECT (a.meta->>'user_id')::uuid
  FROM a
  WHERE a.kind = 'mentioned' AND a.meta ? 'user_id' AND (a.meta->>'user_id')::uuid IS DISTINCT FROM a.actor_id
  UNION
  SELECT DISTINCT c.user_id
  FROM a
  JOIN LATERAL (
    SELECT ta.user_id FROM public.ticket_assignees ta WHERE ta.ticket_id = a.ticket_id
    UNION
    SELECT t.created_by FROM public.tickets t WHERE t.id = a.ticket_id
  ) c ON true
  WHERE a.kind <> 'mentioned'
    AND c.user_id IS NOT NULL
    AND c.user_id IS DISTINCT FROM a.actor_id
    AND (a.kind <> 'assignee_added' OR c.user_id::text = a.meta->>'user_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.ticket_mutes m
       WHERE m.user_id = c.user_id AND m.ticket_id = a.ticket_id
    )
$$;
REVOKE ALL ON FUNCTION public.activity_recipients(uuid) FROM public, anon, authenticated;

-- ── Inbox: the new event ──────────────────────────────────────────────────────
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_event_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_event_check
  CHECK (event IN ('assigned', 'comment', 'status', 'subtask', 'file', 'team_invite', 'mention'));

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
  IF coalesce(NEW.meta ->> 'bulk', 'false') = 'true' THEN RETURN NEW; END IF;

  v_event := CASE NEW.kind
    WHEN 'assignee_added'   THEN 'assigned'
    WHEN 'comment_added'    THEN 'comment'
    WHEN 'status'           THEN 'status'
    WHEN 'child_added'      THEN 'subtask'
    WHEN 'attachment_added' THEN 'file'
    WHEN 'mentioned'        THEN 'mention'
    ELSE NULL END;
  IF v_event IS NULL THEN RETURN NEW; END IF;

  SELECT title, project_id INTO v_title, v_project FROM public.tickets WHERE id = NEW.ticket_id;

  FOR v_rec IN SELECT user_id FROM public.activity_recipients(NEW.id) LOOP
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
             read_at      = NULL,
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

  DELETE FROM public.user_notifications n
  USING public.activity_recipients(NEW.id) r
  WHERE n.user_id = r.user_id AND n.created_at < now() - interval '90 days';

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notifications_fanout() FROM public, anon, authenticated;

-- ========================================
-- 077_comment_actions.sql
-- ========================================
-- 077: Comments that carry an action (#83CC7930)
--
-- "Assign with a comment", "close with a comment", "block with a comment": the
-- comment is posted first and the change follows from the client, so the
-- activity log reads "wrote a comment · closed the task". The action is kept on
-- the comment as a small JSON so the timeline can show a badge next to it:
--   {"kind":"assign","user_id":"…","user_name":"…"}
--   {"kind":"close","status":"Tamamlandı"}
--   {"kind":"block","status":"Bloke"}
-- Nothing on the server acts on it; RLS on ticket_comments is unchanged.

ALTER TABLE public.ticket_comments ADD COLUMN IF NOT EXISTS action jsonb;

ALTER TABLE public.ticket_comments DROP CONSTRAINT IF EXISTS ticket_comments_action_check;
ALTER TABLE public.ticket_comments ADD CONSTRAINT ticket_comments_action_check
  CHECK (action IS NULL OR action ->> 'kind' IN ('assign', 'close', 'block'));

NOTIFY pgrst, 'reload schema';

-- ========================================
-- 078_copy_move_ticket.sql
-- ========================================
-- 078: Copy a task, move a task to another list (#7120F27C)
--
-- Both run on the server so a task and everything hanging off it travel in one
-- transaction: subtasks (recursively), assignees, tags, attachment rows and
-- deadlines. Rules:
--   * target list must be in the SAME team (assignees stay valid, RLS stays simple)
--   * status: same status when the list does not change; otherwise the target
--     list's status with the same name, else its first column
--   * tags: same rows in the same list; matched by name in another list, the
--     rest dropped (tags belong to a list)
--   * the copy goes to the top of its column; the root copy gets " (kopya)"
--   * links (ticket_links) and comments are NOT copied; moving keeps both
-- Activity: the copy logs its own `created`; a move logs `project` (old → new
-- list name) on the moved task and each moved subtask.

CREATE OR REPLACE FUNCTION public.target_status(p_project uuid, p_status_id uuid, p_status_name text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT id FROM public.ticket_statuses WHERE id = p_status_id AND project_id = p_project),
    (SELECT id FROM public.ticket_statuses WHERE project_id = p_project AND name = p_status_name ORDER BY order_index LIMIT 1),
    (SELECT id FROM public.ticket_statuses WHERE project_id = p_project ORDER BY order_index LIMIT 1)
  )
$$;
REVOKE ALL ON FUNCTION public.target_status(uuid, uuid, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.copy_ticket(p_ticket uuid, p_project uuid DEFAULT NULL, p_parent uuid DEFAULT NULL, p_suffix text DEFAULT ' (kopya)')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'görev bulunamadı'; END IF;
  v_project := coalesce(p_project, src.project_id);
  IF public.project_team(v_project) IS NULL OR public.project_team(v_project) <> public.project_team(src.project_id) THEN
    RAISE EXCEPTION 'hedef liste aynı takımda olmalı';
  END IF;
  IF NOT public.can_write_team(public.project_team(v_project)) THEN RAISE EXCEPTION 'yetki yok'; END IF;

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
END $$;
REVOKE ALL ON FUNCTION public.copy_ticket(uuid, uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.copy_ticket(uuid, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.move_ticket(p_ticket uuid, p_project uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  src      public.tickets%ROWTYPE;
  v_me     uuid := auth.uid();
  v_status uuid;
  v_min    integer;
  v_from   text;
  v_to     text;
  v_child  uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'görev bulunamadı'; END IF;
  IF src.project_id = p_project THEN RETURN; END IF;
  IF public.project_team(p_project) IS NULL OR public.project_team(p_project) <> public.project_team(src.project_id) THEN
    RAISE EXCEPTION 'hedef liste aynı takımda olmalı';
  END IF;
  IF NOT public.can_write_team(public.project_team(p_project)) THEN RAISE EXCEPTION 'yetki yok'; END IF;

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

  PERFORM public.log_activity(p_ticket, 'project', v_from, v_to, jsonb_build_object('from_project', src.project_id, 'to_project', p_project), v_me);

  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket LOOP
    PERFORM public.move_ticket(v_child, p_project);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.move_ticket(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_ticket(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ========================================
-- 079_list_views.sql
-- ========================================
-- Kayıtlı liste görünümleri (#883CF8 / TL-09).
--
-- Bir görünüm = liste yapılandırması (gruplama, sıralama, sütunlar, alt görev
-- modu, görünüm anahtarları) + filtre + tür (liste / pano). Üç kapsam:
--   project : bir listeye ait; kişisel ya da takımla paylaşılan
--   team    : takımın tüm listeleri (ileride; şimdilik yalnız şema)
--   me      : kişinin kendi "Görevlerim" görünümleri (paylaşılamaz)
-- Kişisel görünümü yalnız sahibi görür; paylaşılanı takım üyeleri görür,
-- sahibi ya da takım yöneticisi değiştirir/siler (korumalı görünüm de aynı
-- kural — istemci başkasına "Farklı kaydet" önerir). Takım varsayılanı:
-- paylaşılan + is_default, liste başına en fazla bir tane (tetikleyici eskisini
-- düşürür). Kişisel varsayılan tabloda değil, kullanıcı tercihlerinde
-- (`list:<projectId>.defaultView`).
--
-- Yalnız ekleme: mevcut tablolara dokunulmaz (pilot geri alma kuralı).

CREATE TABLE IF NOT EXISTS public.list_views (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        text NOT NULL CHECK (scope IN ('project', 'team', 'me')),
  project_id   uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  team_id      uuid REFERENCES public.teams(id)    ON DELETE CASCADE,
  owner_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  icon         text,
  type         text NOT NULL DEFAULT 'list' CHECK (type IN ('list', 'board')),
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared    boolean NOT NULL DEFAULT false,
  is_default   boolean NOT NULL DEFAULT false,
  is_protected boolean NOT NULL DEFAULT false,
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT list_views_scope_target CHECK (
    (scope = 'project' AND project_id IS NOT NULL) OR
    (scope = 'team'    AND team_id IS NOT NULL AND project_id IS NULL) OR
    (scope = 'me'      AND project_id IS NULL AND team_id IS NULL AND is_shared = false)
  )
);

CREATE INDEX IF NOT EXISTS list_views_project_idx ON public.list_views(project_id, position, created_at);
CREATE INDEX IF NOT EXISTS list_views_owner_idx   ON public.list_views(owner_id, scope, position);

-- team_id listeden türetilir (istemciye güvenilmez); kişisel kapsam paylaşılamaz;
-- yeni takım varsayılanı eskisini düşürür.
CREATE OR REPLACE FUNCTION public.list_views_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.scope = 'project' THEN
    NEW.team_id := (SELECT team_id FROM public.projects WHERE id = NEW.project_id);
  END IF;
  IF NEW.scope = 'me' THEN
    NEW.is_shared := false; NEW.is_default := false; NEW.is_protected := false;
  END IF;
  IF NOT NEW.is_shared THEN NEW.is_default := false; END IF;
  IF NEW.is_default AND NEW.project_id IS NOT NULL THEN
    UPDATE public.list_views SET is_default = false
     WHERE project_id = NEW.project_id AND is_default AND id <> NEW.id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.list_views_before_write() FROM public, anon;

DROP TRIGGER IF EXISTS list_views_before_write ON public.list_views;
CREATE TRIGGER list_views_before_write BEFORE INSERT OR UPDATE ON public.list_views
  FOR EACH ROW EXECUTE FUNCTION public.list_views_before_write();

ALTER TABLE public.list_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS list_views_select ON public.list_views;
DROP POLICY IF EXISTS list_views_insert ON public.list_views;
DROP POLICY IF EXISTS list_views_update ON public.list_views;
DROP POLICY IF EXISTS list_views_delete ON public.list_views;

CREATE POLICY list_views_select ON public.list_views FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR (is_shared AND public.team_role(team_id) IS NOT NULL));

-- Politika, BEFORE tetikleyicisinin doldurduğu satırı görür: team_id hazırdır.
CREATE POLICY list_views_insert ON public.list_views FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid() AND (
      scope = 'me' OR
      (NOT is_shared AND public.team_role(team_id) IS NOT NULL) OR
      (is_shared AND public.can_write_team(team_id))
    )
  );

CREATE POLICY list_views_update ON public.list_views FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR (is_shared AND public.is_team_admin(team_id)))
  WITH CHECK (owner_id = auth.uid() OR (is_shared AND public.is_team_admin(team_id)));

CREATE POLICY list_views_delete ON public.list_views FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR (is_shared AND public.is_team_admin(team_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.list_views TO authenticated;
REVOKE ALL ON public.list_views FROM anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'list_views'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.list_views;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ========================================
-- 080_link_flip_cycle_check.sql
-- ========================================
-- 080: Bağ yönü değiştirilebilsin (#9a68d017, v0.36.4)
-- check_ticket_link döngü kontrolü UPDATE'te güncellenen satırın ESKİ hâlini de
-- geziyordu: "A engelliyor B" satırını "B engelliyor A" yapmak, A→B hâlâ tabloda
-- göründüğü için "Döngü oluşur" ile reddediliyordu. Kontrol artık güncellenen
-- satırı (NEW.id) dışarıda bırakır. Yalnız fonksiyon gövdesi değişir; şema aynı.
CREATE OR REPLACE FUNCTION public.check_ticket_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.ticket_team(NEW.linked_ticket_id) IS DISTINCT FROM public.ticket_team(NEW.ticket_id) THEN
    RAISE EXCEPTION 'Yalnızca aynı takımdaki görevler bağlanabilir' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.ticket_id = NEW.linked_ticket_id THEN
    RAISE EXCEPTION 'Görev kendisine bağlanamaz' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    WITH RECURSIVE down AS (
      SELECT l.linked_ticket_id AS id, 1 AS depth FROM ticket_links l
       WHERE l.ticket_id = NEW.linked_ticket_id AND (TG_OP <> 'UPDATE' OR l.id <> NEW.id)
      UNION
      SELECT l.linked_ticket_id, d.depth + 1 FROM ticket_links l JOIN down d ON l.ticket_id = d.id
       WHERE d.depth < 50 AND (TG_OP <> 'UPDATE' OR l.id <> NEW.id)
    ) SELECT 1 FROM down WHERE id = NEW.ticket_id
  ) THEN
    RAISE EXCEPTION 'Döngü oluşur: hedef görev zaten bu görevi (dolaylı olarak) bağlıyor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

-- ========================================
-- 081_subtask_keep_order.sql
-- ========================================
-- 081: Alt görev tamamlanınca (ya da durumu değişince) sırası değişmesin (#9da49444, v0.37.1)
--
-- 045'in "durum değişince hedef sütunun en üstüne" kuralı alt görevlere de uygulanıyordu.
-- Alt görevin order_index'i aynı zamanda üst görevin alt görev listesindeki sırasıdır
-- (görev penceresi ChildTicketList, yeni liste buildRows): kural onu sütundaki en küçük
-- değerin bir altına çektiği için tamamlanan alt görev listenin başına zıplıyordu.
-- Kural artık yalnız üst düzey görevlere (parent_id null) uygulanır; alt görev durum
-- değiştirince yerinde kalır. Elle sıralama (reorder_tickets, useReorderChildren) aynen çalışır.
-- Yalnız fonksiyon gövdesi değişir; eski istemci etkilenmez.
create or replace function public.ticket_top_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status_id is distinct from old.status_id
     and new.parent_id is null
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
