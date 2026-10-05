-- 113: Passive jobs · translation of descriptions and comments (#fa4b05e9; phase 4, #0fc67dbb).
--
-- Each person says which languages they read and which one they want the rest translated into
-- (user_preferences, scope global: "reading": { "read": ["tr","en"], "to": "tr" }). A ticket's
-- description or a comment that is in none of a reader's languages gets a translation into that
-- reader's language, made by a runner as a passive job (110): one call, no tools.
--
-- Like the pictures, two things have to say yes:
--   ai_team_passive.translate    the team's switch, a switch of its own, OFF until an admin turns it on
--   the runner's own settings    on the computer of the person who lends the subscription
--
-- One row per (content, target language). The row carries the hash of the text it was made for:
--   * the text changes  -> its rows are deleted here (triggers), so the content is a job again;
--   * the reader's screen compares the hash with the text it is showing, so a translation that
--     arrived for an older text is never shown under a newer one (the two are fetched apart).
--
-- status: processing | done (text = the translation) | none (no translation needed: the text is in
-- a language every reader of that target reads; source_lang says which) | failed | skipped.
-- A 'none' row becomes a job again when a reader who does not read that language joins the target.
--
-- Nothing derived is written to tickets or ticket_comments (that would move updated_at, wake every
-- open client and raise "somebody else changed it" for the person editing).

ALTER TABLE public.ai_team_passive ADD COLUMN IF NOT EXISTS translate BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.content_translations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  ticket_id   UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  comment_id  UUID REFERENCES public.ticket_comments(id) ON DELETE CASCADE,   -- NULL: the ticket's description
  target_lang TEXT NOT NULL,
  source_hash TEXT NOT NULL,   -- sha256 (hex) of the text this row was made for
  source_lang TEXT,            -- the language the text is in, as the job found it
  status      TEXT NOT NULL CHECK (status IN ('processing', 'done', 'none', 'failed', 'skipped')),
  text        TEXT,            -- the translation (Markdown), when status = done
  model       TEXT,
  attempts    INT NOT NULL DEFAULT 1,
  error       TEXT,
  claimed_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ms          INTEGER,
  cost_usd    NUMERIC(10, 4)
);
CREATE UNIQUE INDEX IF NOT EXISTS content_translations_description_key ON public.content_translations (ticket_id, target_lang) WHERE comment_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS content_translations_comment_key ON public.content_translations (comment_id, target_lang) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_translations_ticket_idx ON public.content_translations (ticket_id);
CREATE INDEX IF NOT EXISTS content_translations_team_idx ON public.content_translations (team_id, finished_at);

-- Read by the team; written only by the functions below (no write policy, no write grant).
ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_translations_select ON public.content_translations;
CREATE POLICY content_translations_select ON public.content_translations FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL);
REVOKE ALL ON public.content_translations FROM anon, authenticated;
GRANT SELECT ON public.content_translations TO authenticated;

-- The text changed: what was made for the old text goes away.
CREATE OR REPLACE FUNCTION public.tickets_translations_stale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    DELETE FROM content_translations WHERE ticket_id = NEW.id AND comment_id IS NULL;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tickets_translations_stale ON public.tickets;
CREATE TRIGGER tickets_translations_stale AFTER UPDATE OF description ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_translations_stale();
REVOKE ALL ON FUNCTION public.tickets_translations_stale() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.comments_translations_stale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    DELETE FROM content_translations WHERE comment_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS comments_translations_stale ON public.ticket_comments;
CREATE TRIGGER comments_translations_stale AFTER UPDATE OF content ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_translations_stale();
REVOKE ALL ON FUNCTION public.comments_translations_stale() FROM public, anon, authenticated;

-- The languages a team's content is translated into, and for each the languages that need no
-- translation into it: those EVERY reader of that target reads (the target itself always).
-- A reader is a member of the team who said what they read (an agent's account has no such
-- preference unless somebody uses the screen as that account, and then it reads like anybody).
-- Internal: who reads what is each person's own preference; only the sets leave this function,
-- and only through agent_translate_next.
CREATE OR REPLACE FUNCTION public.ai_translation_targets(p_team uuid) RETURNS TABLE (target text, skip text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH readers AS (
    SELECT tm.user_id AS uid,
           lower(up.prefs #>> '{reading,to}') AS target,
           ARRAY(SELECT lower(x) FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(up.prefs #> '{reading,read}') = 'array' THEN up.prefs #> '{reading,read}' ELSE '[]'::jsonb END) x
                  WHERE x ~* '^[a-z]{2,3}$') AS reads
      FROM team_members tm
      JOIN user_preferences up ON up.user_id = tm.user_id AND up.scope = 'global'
     WHERE tm.team_id = p_team AND up.prefs #>> '{reading,to}' ~* '^[a-z]{2,3}$'
  )
  SELECT g.target,
         ARRAY(SELECT l FROM readers r, unnest(r.reads || ARRAY[r.target]) l
                WHERE r.target = g.target GROUP BY l HAVING count(DISTINCT r.uid) = g.n ORDER BY l)
    FROM (SELECT r.target, count(*) AS n FROM readers r GROUP BY r.target) g
$$;
REVOKE ALL ON FUNCTION public.ai_translation_targets(uuid) FROM public, anon, authenticated;

-- The next text that has no translation yet into a language somebody of its team reads in, claimed
-- for the calling agent; NULL when there is none. Only teams that turned the job on AND that the
-- agent is a member of. Newest text first.
CREATE OR REPLACE FUNCTION public.agent_translate_next() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  c      record;
  v_id   uuid;
  v_hash text;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM agents a WHERE a.profile_id = v_uid) THEN
    RAISE EXCEPTION 'Pasif işleri yalnız bir ajan hesabı alabilir.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    WITH teams_on AS (
      SELECT m.team_id FROM team_members m
        JOIN ai_team_passive s ON s.team_id = m.team_id AND s.translate
       WHERE m.user_id = v_uid
    ), targets AS (
      SELECT o.team_id, g.target, g.skip FROM teams_on o CROSS JOIN LATERAL ai_translation_targets(o.team_id) g
    ), contents AS (
      SELECT t.id AS ticket_id, NULL::uuid AS comment_id, t.description AS body, t.title, p.name AS list_name, p.team_id, t.updated_at AS at
        FROM tickets t
        JOIN projects p ON p.id = t.project_id
        JOIN teams_on o ON o.team_id = p.team_id
       WHERE t.archived_at IS NULL AND length(btrim(coalesce(t.description, ''))) >= 2
      UNION ALL
      SELECT cm.ticket_id, cm.id, cm.content, t.title, p.name, p.team_id, coalesce(cm.edited_at, cm.created_at)
        FROM ticket_comments cm
        JOIN tickets t ON t.id = cm.ticket_id AND t.archived_at IS NULL
        JOIN projects p ON p.id = t.project_id
        JOIN teams_on o ON o.team_id = p.team_id
       WHERE length(btrim(coalesce(cm.content, ''))) >= 2
    )
    SELECT k.ticket_id, k.comment_id, k.body, k.title, k.list_name, k.team_id, g.target, g.skip, x.id AS row_id
      FROM contents k
      JOIN targets g ON g.team_id = k.team_id
      LEFT JOIN content_translations x
             ON x.ticket_id = k.ticket_id AND x.comment_id IS NOT DISTINCT FROM k.comment_id AND x.target_lang = g.target
     WHERE x.id IS NULL
        OR (x.attempts < 3 AND x.status = 'processing' AND x.claimed_at < now() - interval '10 minutes')
        OR (x.attempts < 3 AND x.status = 'failed' AND x.finished_at < now() - interval '1 hour')
        OR (x.status = 'none' AND x.source_lang IS NOT NULL AND NOT (x.source_lang = ANY (g.skip)))
     ORDER BY k.at DESC
     LIMIT 5
  LOOP
    v_hash := encode(sha256(convert_to(c.body, 'UTF8')), 'hex');
    v_id := NULL;
    IF c.row_id IS NULL THEN
      BEGIN
        INSERT INTO content_translations (team_id, ticket_id, comment_id, target_lang, source_hash, status, claimed_by)
        VALUES (c.team_id, c.ticket_id, c.comment_id, c.target, v_hash, 'processing', v_uid)
        RETURNING id INTO v_id;
      EXCEPTION WHEN unique_violation THEN v_id := NULL;   -- another runner took it between the look and the claim
      END;
    ELSE
      UPDATE content_translations x
         SET status = 'processing', claimed_by = v_uid, claimed_at = now(), source_hash = v_hash,
             attempts = CASE WHEN x.status = 'none' THEN 1 ELSE x.attempts + 1 END,
             error = NULL, finished_at = NULL, text = NULL
       WHERE x.id = c.row_id
         AND (x.status = 'none'
              OR (x.attempts < 3 AND (x.status = 'failed' OR (x.status = 'processing' AND x.claimed_at < now() - interval '10 minutes'))))
      RETURNING x.id INTO v_id;
    END IF;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'kind', 'translate',
                                'field', CASE WHEN c.comment_id IS NULL THEN 'description' ELSE 'comment' END,
                                'target', c.target, 'skip', to_jsonb(c.skip), 'text', c.body,
                                'ticket_id', c.ticket_id, 'comment_id', c.comment_id, 'ticket_title', c.title,
                                'list', c.list_name, 'team_id', c.team_id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.agent_translate_next() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_translate_next() TO authenticated;

-- The result of a claimed job. A result without text says "no translation needed" (status none).
-- Only the agent that holds the claim can write it, and only once. A job whose text changed
-- meanwhile has no row any more (the trigger above) and is refused.
CREATE OR REPLACE FUNCTION public.agent_translate_save(p_id uuid, p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_text text := nullif(left(coalesce(p_result ->> 'text', ''), 60000), '');
  v_ms   numeric;
  v_cost numeric;
BEGIN
  IF jsonb_typeof(p_result -> 'ms') = 'number' THEN v_ms := (p_result ->> 'ms')::numeric; END IF;
  IF jsonb_typeof(p_result -> 'cost_usd') = 'number' THEN v_cost := (p_result ->> 'cost_usd')::numeric; END IF;
  UPDATE content_translations
     SET status = CASE WHEN v_text IS NULL THEN 'none' ELSE 'done' END,
         text = v_text,
         source_lang = nullif(left(lower(btrim(coalesce(p_result ->> 'lang', ''))), 8), ''),
         model = nullif(left(coalesce(p_result ->> 'model', ''), 80), ''),
         ms = CASE WHEN v_ms IS NULL THEN NULL ELSE least(3600000, greatest(0, round(v_ms)))::int END,
         cost_usd = CASE WHEN v_cost IS NULL THEN NULL ELSE least(1000, greatest(0, v_cost)) END,
         error = NULL, finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_translate_save(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_translate_save(uuid, jsonb) TO authenticated;

-- The job could not be done. `p_skip`: the text is not something to translate (too long) and
-- should not be tried again; otherwise it may be retried, three times in all.
CREATE OR REPLACE FUNCTION public.agent_translate_fail(p_id uuid, p_error text, p_skip boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  UPDATE content_translations
     SET status = CASE WHEN p_skip THEN 'skipped' ELSE 'failed' END,
         error = nullif(left(btrim(coalesce(p_error, '')), 500), ''), finished_at = now()
   WHERE id = p_id AND claimed_by = v_uid AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu iş sende değil ya da artık sürmüyor.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_translate_fail(uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_translate_fail(uuid, text, boolean) TO authenticated;
