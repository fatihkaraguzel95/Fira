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
