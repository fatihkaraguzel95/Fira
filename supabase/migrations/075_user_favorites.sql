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
