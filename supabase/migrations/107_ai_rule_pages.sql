-- 107: Agent rules as Fira pages (#f10b0cf7; phase 2, #0a6cc77d).
--
-- How an agent is to work used to live in the repository's CLAUDE.md, in one
-- computer's memory files and in chat history: the team could neither read nor
-- change it, and somebody else's Claude could not work by the same rules.
--
-- A rule is an ordinary page (so everybody reads it, edits it, and its versions
-- are kept — 067). This table only says WHICH pages are rules and for what:
--
--   project_id NULL  → a rule of the whole team
--   project_id set   → a rule of that list, read after the team's
--   required         → the team means it: a personal preference does not override it
--
-- Personal preferences are not here: they are the owner's, and live in
-- agents.settings (100).
--
-- Additive: one new table. Nothing existing changes.

CREATE TABLE IF NOT EXISTS public.ai_rule_pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  page_id     UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  required    BOOLEAN NOT NULL DEFAULT false,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A page is a rule of the team once, and of a given list once.
CREATE UNIQUE INDEX IF NOT EXISTS ai_rule_pages_once
  ON public.ai_rule_pages (page_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS ai_rule_pages_team_idx ON public.ai_rule_pages(team_id, project_id);

-- The team is the page's team, never the client's word; a list rule's page is in
-- the list's own team; a canvas has no text to be a rule. What a row points at
-- does not change afterwards (drop it and add another).
-- Refusals a person sees are raised without an ERRCODE, so the app shows them as written.
CREATE OR REPLACE FUNCTION public.ai_rule_pages_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  v_kind text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.page_id := OLD.page_id;
    NEW.project_id := OLD.project_id;
    NEW.team_id := OLD.team_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    RETURN NEW;
  END IF;
  SELECT team_id, kind INTO v_team, v_kind FROM pages WHERE id = NEW.page_id;
  IF v_team IS NULL THEN RAISE EXCEPTION 'Kural sayfası bulunamadı.'; END IF;
  IF v_kind <> 'page' THEN RAISE EXCEPTION 'Çizim ve whiteboard kural sayfası olamaz.'; END IF;
  IF NEW.project_id IS NOT NULL AND public.project_team(NEW.project_id) IS DISTINCT FROM v_team THEN
    RAISE EXCEPTION 'Kural sayfası listeyle aynı takımda olmalı.';
  END IF;
  NEW.team_id := v_team;
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_rule_pages_before_write ON public.ai_rule_pages;
CREATE TRIGGER ai_rule_pages_before_write BEFORE INSERT OR UPDATE ON public.ai_rule_pages
  FOR EACH ROW EXECUTE FUNCTION public.ai_rule_pages_before_write();
REVOKE ALL ON FUNCTION public.ai_rule_pages_before_write() FROM public, anon;

ALTER TABLE public.ai_rule_pages ENABLE ROW LEVEL SECURITY;
-- Everybody in the team reads the rules (the agent is a member like any other);
-- the team's admins decide which pages are rules and which of them are required.
DROP POLICY IF EXISTS ai_rule_pages_select ON public.ai_rule_pages;
CREATE POLICY ai_rule_pages_select ON public.ai_rule_pages FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
DROP POLICY IF EXISTS ai_rule_pages_insert ON public.ai_rule_pages;
CREATE POLICY ai_rule_pages_insert ON public.ai_rule_pages FOR INSERT TO authenticated
  WITH CHECK (public.is_team_admin(team_id));
DROP POLICY IF EXISTS ai_rule_pages_update ON public.ai_rule_pages;
CREATE POLICY ai_rule_pages_update ON public.ai_rule_pages FOR UPDATE TO authenticated
  USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
DROP POLICY IF EXISTS ai_rule_pages_delete ON public.ai_rule_pages;
CREATE POLICY ai_rule_pages_delete ON public.ai_rule_pages FOR DELETE TO authenticated
  USING (public.is_team_admin(team_id));
REVOKE ALL ON public.ai_rule_pages FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_rule_pages TO authenticated;
