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
