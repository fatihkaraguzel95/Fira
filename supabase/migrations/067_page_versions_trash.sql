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
