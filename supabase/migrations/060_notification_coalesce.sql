-- 060: Coalesce inbox notifications for the same task (#746B62E9)
--
-- Feedback: a burst of changes on one task (status, comment, assign, status…)
-- within a couple of minutes produced a separate inbox row each. Fold updates
-- for the SAME task within a 3-minute window into ONE notification instead of
-- creating new ones — the row shows the latest event with a count, and the
-- detail lists every folded change. Toast/Telegram coalescing already existed
-- (client 4s, bot 45s); this brings the persistent inbox in line.

ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS group_count      integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS group_started_at timestamptz;
UPDATE public.user_notifications SET group_started_at = created_at WHERE group_started_at IS NULL;

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
  -- Import rows (BEFORE trigger stamps meta.bulk) never reach the inbox.
  IF coalesce(NEW.meta ->> 'bulk', 'false') = 'true' THEN RETURN NEW; END IF;

  v_event := CASE NEW.kind
    WHEN 'assignee_added'   THEN 'assigned'
    WHEN 'comment_added'    THEN 'comment'
    WHEN 'status'           THEN 'status'
    WHEN 'child_added'      THEN 'subtask'
    WHEN 'attachment_added' THEN 'file'
    ELSE NULL END;
  IF v_event IS NULL THEN RETURN NEW; END IF;

  SELECT title, project_id INTO v_title, v_project FROM public.tickets WHERE id = NEW.ticket_id;

  FOR v_rec IN SELECT user_id FROM public.activity_recipients(NEW.id) LOOP
    -- A recent notification for the same task (any actor) collects this update.
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
             read_at      = NULL,          -- a fresh change resurfaces the task as unread
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

  -- Retention: 90 days, only for the recipients touched here.
  DELETE FROM public.user_notifications n
  USING public.activity_recipients(NEW.id) r
  WHERE n.user_id = r.user_id AND n.created_at < now() - interval '90 days';

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notifications_fanout() FROM public, anon, authenticated;

-- UPDATE events must carry the full new row to subscribed clients.
ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;
