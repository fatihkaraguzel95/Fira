-- 058: Bildirim kutusu (#746B62E9, seçenek A)
--
-- Bugüne kadar bildirimler yalnızca canlı ticket_activity akışından üretiliyordu:
-- sekme kapalıyken olanlar kaybolur, "sonradan bakılacak" bir yer yoktu. Bu tablo
-- her alıcı için bir satır tutar; toast ve Telegram aynen devam eder, kutu bunların
-- yanına gelir. Alıcı kümesi bot ile aynı fonksiyondan (activity_recipients) gelir,
-- böylece üç kanal aynı kişilere aynı şeyi söyler.

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_id  uuid NOT NULL REFERENCES public.ticket_activity(id) ON DELETE CASCADE,
  ticket_id    uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  event        text NOT NULL CHECK (event IN ('assigned', 'comment', 'status', 'subtask', 'file')),
  actor_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Anlık kopyalar: kutu satırı görev/yorum sorgusu yapmadan okunabilsin.
  value        text,
  ticket_title text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  UNIQUE (user_id, activity_id)
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx ON public.user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx ON public.user_notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notifications_select ON public.user_notifications;
CREATE POLICY user_notifications_select ON public.user_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Yazma yalnızca trigger (definer) ve RPC üzerinden; istemciye INSERT/UPDATE/DELETE politikası yok.
GRANT SELECT ON public.user_notifications TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_notifications FROM authenticated, anon;

-- ── Dağıtım: ticket_activity → alıcı başına bir satır ─────────────────────────
CREATE OR REPLACE FUNCTION public.notifications_fanout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event text;
BEGIN
  -- İçe aktarma satırları (BEFORE trigger meta.bulk yazar) kutuya da düşmez; özet ayrı gider.
  IF coalesce(NEW.meta ->> 'bulk', 'false') = 'true' THEN RETURN NEW; END IF;

  v_event := CASE NEW.kind
    WHEN 'assignee_added'   THEN 'assigned'
    WHEN 'comment_added'    THEN 'comment'
    WHEN 'status'           THEN 'status'
    WHEN 'child_added'      THEN 'subtask'
    WHEN 'attachment_added' THEN 'file'
    ELSE NULL END;
  IF v_event IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.user_notifications (user_id, activity_id, ticket_id, project_id, event, actor_id, value, ticket_title)
  SELECT r.user_id, NEW.id, NEW.ticket_id, t.project_id, v_event, NEW.actor_id, left(NEW.to_value, 300), t.title
  FROM public.activity_recipients(NEW.id) r
  CROSS JOIN public.tickets t
  WHERE t.id = NEW.ticket_id
  ON CONFLICT DO NOTHING;

  -- Saklama: 90 gün. Ayrı bir cron yerine dağıtım anında, yalnızca ilgili alıcılar için.
  DELETE FROM public.user_notifications n
  USING public.activity_recipients(NEW.id) r
  WHERE n.user_id = r.user_id AND n.created_at < now() - interval '90 days';

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notifications_fanout() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS ticket_activity_notify ON public.ticket_activity;
CREATE TRIGGER ticket_activity_notify
  AFTER INSERT ON public.ticket_activity
  FOR EACH ROW EXECUTE FUNCTION public.notifications_fanout();

-- ── Okundu işaretleme ─────────────────────────────────────────────────────────
-- p_ids verilirse yalnız onlar; p_ticket verilirse o görevdekiler; ikisi de boşsa tümü.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL, p_ticket uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_n int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  UPDATE public.user_notifications
     SET read_at = now()
   WHERE user_id = v_me
     AND read_at IS NULL
     AND (p_ids IS NULL OR id = ANY (p_ids))
     AND (p_ticket IS NULL OR ticket_id = p_ticket);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[], uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[], uuid) TO authenticated;

-- ── Realtime: rozet ve liste anında güncellensin ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END $$;
