-- 110: Passive jobs · the text in a picture (#1c2ace54; phase 4, #0fc67dbb).
--
-- A passive job is not agent work: one call, no tools; in goes a picture, out comes what is
-- written in it, a line about what it shows, and its language. Decision (1 Oct 2026): these jobs
-- run on a person's own subscription, by their runner while it is idle ("donation"); nothing of
-- the kind runs on the server.
--
-- Two things have to say yes before a team's pictures are read:
--   ai_team_passive.image_text   the team's switch, set by its admins; OFF until somebody turns it on.
--                                A team's content does not go to a model by itself.
--   the runner's own settings    on the computer of the person who lends the subscription (runner.json).
--
-- There is no queue table and no trigger on uploads: the runner asks for the next picture that has
-- no result yet (agent_passive_next), and the row it gets in file_texts is its claim. A claim that
-- is not answered in ten minutes can be taken again; a picture that was tried three times is left alone.
--
-- file_texts.file_url is not a reference that keeps a file alive: admin_orphan_files does not
-- count it, and a row may outlive its file (it is small, and harmless).

CREATE TABLE IF NOT EXISTS public.ai_team_passive (
  team_id    UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  image_text BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.ai_team_passive_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.team_id := OLD.team_id; END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_team_passive_before_write ON public.ai_team_passive;
CREATE TRIGGER ai_team_passive_before_write BEFORE INSERT OR UPDATE ON public.ai_team_passive
  FOR EACH ROW EXECUTE FUNCTION public.ai_team_passive_before_write();
REVOKE ALL ON FUNCTION public.ai_team_passive_before_write() FROM public, anon;

ALTER TABLE public.ai_team_passive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_team_passive_select ON public.ai_team_passive;
CREATE POLICY ai_team_passive_select ON public.ai_team_passive FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
DROP POLICY IF EXISTS ai_team_passive_insert ON public.ai_team_passive;
CREATE POLICY ai_team_passive_insert ON public.ai_team_passive FOR INSERT TO authenticated
  WITH CHECK (public.is_team_admin(team_id));
DROP POLICY IF EXISTS ai_team_passive_update ON public.ai_team_passive;
CREATE POLICY ai_team_passive_update ON public.ai_team_passive FOR UPDATE TO authenticated
  USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
REVOKE ALL ON public.ai_team_passive FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_team_passive TO authenticated;

-- What was read from a picture. One row per file (its address as the attachment stores it).
CREATE TABLE IF NOT EXISTS public.file_texts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL CHECK (status IN ('processing', 'done', 'failed', 'skipped')),
  text        TEXT,          -- what is written in the picture, as it stands
  description TEXT,          -- one or two sentences on what the picture shows
  lang        TEXT,          -- the language of the text (tr, en, de, …), when there is text
  model       TEXT,
  attempts    INT NOT NULL DEFAULT 1,
  error       TEXT,
  claimed_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS file_texts_team_idx ON public.file_texts (team_id);

-- Read by the team; written only by the functions below (no write policy, no write grant).
ALTER TABLE public.file_texts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS file_texts_select ON public.file_texts;
CREATE POLICY file_texts_select ON public.file_texts FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
REVOKE ALL ON public.file_texts FROM anon, authenticated;
GRANT SELECT ON public.file_texts TO authenticated;

-- The next picture that has no result yet, claimed for the calling agent; NULL when there is none.
-- Only pictures of teams that turned the job on AND that the agent is a member of.
CREATE OR REPLACE FUNCTION public.agent_passive_next() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  c     record;
  v_id  uuid;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM agents a WHERE a.profile_id = v_uid) THEN
    RAISE EXCEPTION 'Pasif işleri yalnız bir ajan hesabı alabilir.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    SELECT a.file_url, a.file_name, a.ticket_id, t.title, p.name AS list_name, p.team_id
      FROM ticket_attachments a
      JOIN tickets t ON t.id = a.ticket_id AND t.archived_at IS NULL
      JOIN projects p ON p.id = t.project_id
      JOIN ai_team_passive s ON s.team_id = p.team_id AND s.image_text
      JOIN team_members m ON m.team_id = p.team_id AND m.user_id = v_uid
      LEFT JOIN file_texts ft ON ft.file_url = a.file_url
     WHERE lower(a.file_name) ~ '\.(png|jpe?g|webp|gif)$'
       AND (ft.id IS NULL
            OR (ft.attempts < 3 AND ft.status = 'processing' AND ft.claimed_at < now() - interval '10 minutes')
            OR (ft.attempts < 3 AND ft.status = 'failed' AND ft.finished_at < now() - interval '1 hour'))
     ORDER BY a.created_at DESC
     LIMIT 5
  LOOP
    v_id := NULL;
    INSERT INTO file_texts AS f (team_id, file_url, status, claimed_by, claimed_at, attempts)
    VALUES (c.team_id, c.file_url, 'processing', v_uid, now(), 1)
    ON CONFLICT (file_url) DO UPDATE
      SET status = 'processing', claimed_by = v_uid, claimed_at = now(), attempts = f.attempts + 1, error = NULL, finished_at = NULL
      WHERE f.attempts < 3
        AND ((f.status = 'processing' AND f.claimed_at < now() - interval '10 minutes') OR f.status = 'failed')
    RETURNING f.id INTO v_id;
    -- Another runner took it between the look and the claim: try the next one.
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'kind', 'image_text', 'file_url', c.file_url, 'file_name', c.file_name,
                                'ticket_id', c.ticket_id, 'ticket_title', c.title, 'list', c.list_name, 'team_id', c.team_id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.agent_passive_next() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_passive_next() TO authenticated;

-- The result of a claimed job. Only the agent that holds the claim can write it, and only once.
CREATE OR REPLACE FUNCTION public.agent_passive_save(p_id uuid, p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  UPDATE file_texts
     SET status = 'done',
         text = nullif(left(coalesce(p_result ->> 'text', ''), 20000), ''),
         description = nullif(left(btrim(coalesce(p_result ->> 'description', '')), 1000), ''),
         lang = nullif(left(lower(btrim(coalesce(p_result ->> 'lang', ''))), 8), ''),
         model = nullif(left(coalesce(p_result ->> 'model', ''), 80), ''),
         error = NULL, finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_passive_save(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_passive_save(uuid, jsonb) TO authenticated;

-- The job could not be done. `p_skip`: the picture is not something to read (not a picture after all,
-- too large, gone) and should not be tried again; otherwise it may be retried, three times in all.
CREATE OR REPLACE FUNCTION public.agent_passive_fail(p_id uuid, p_error text, p_skip boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  UPDATE file_texts
     SET status = CASE WHEN p_skip THEN 'skipped' ELSE 'failed' END,
         error = nullif(left(btrim(coalesce(p_error, '')), 500), ''), finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_passive_fail(uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_passive_fail(uuid, text, boolean) TO authenticated;
