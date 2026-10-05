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
