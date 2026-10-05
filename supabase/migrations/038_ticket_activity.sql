-- 038 — Görev aktivite günlüğü
--
-- Şimdiye kadar yalnızca "kim oluşturdu / kim en son değiştirdi" tutuluyordu; ne
-- değiştiği kayıtlı değildi. Bu migration her değişikliği tetikleyicilerle
-- (trigger) yazar: durum geçişleri, öncelik, başlık, açıklama, bitiş tarihi,
-- arşiv, üst görev, atamalar, etiketler, ekler, son tarihler, bağlantılar,
-- yorumlar ve alt görev ekleme/silme.
--
-- Neden trigger: kayıt istemciden bağımsız olur (içe aktarma, psql, ileride API)
-- ve hiçbir istemci "loglamayı unutamaz". Değerler o anki *adlarıyla* saklanır,
-- böylece durum yeniden adlandırılsa/silinse bile geçmiş okunabilir kalır.

CREATE TABLE IF NOT EXISTS public.ticket_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind        text NOT NULL,
  from_value  text,
  to_value    text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_activity_ticket_idx ON public.ticket_activity (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_activity_kind_idx ON public.ticket_activity (kind);

ALTER TABLE public.ticket_activity ENABLE ROW LEVEL SECURITY;

-- Görevi görebilen günlüğü de görür. Yazma yalnızca tetikleyicilerden (SECURITY
-- DEFINER) olur; istemcilere INSERT/UPDATE/DELETE politikası verilmez.
DROP POLICY IF EXISTS ticket_activity_select ON public.ticket_activity;
CREATE POLICY ticket_activity_select ON public.ticket_activity
  FOR SELECT TO authenticated
  USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);

GRANT SELECT ON public.ticket_activity TO authenticated;

-- ── Yardımcılar ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_actor() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT p.id FROM public.profiles p WHERE p.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.log_activity(
  p_ticket uuid, p_kind text, p_from text, p_to text, p_meta jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ticket IS NULL THEN RETURN; END IF;
  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta)
  VALUES (p_ticket, COALESCE(p_actor, public.activity_actor()), p_kind, p_from, p_to, COALESCE(p_meta, '{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.status_name(p uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT name FROM public.ticket_statuses WHERE id = p
$$;

CREATE OR REPLACE FUNCTION public.person_name(p uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(full_name, ''), email) FROM public.profiles WHERE id = p
$$;

-- ── tickets ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tickets_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := COALESCE(public.activity_actor(), NEW.updated_by, NEW.created_by);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.id, 'created', NULL, NEW.title,
      jsonb_build_object('status', public.status_name(NEW.status_id)), COALESCE(public.activity_actor(), NEW.created_by));
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title,
        jsonb_build_object('child_id', NEW.id), COALESCE(public.activity_actor(), NEW.created_by));
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(OLD.parent_id, 'child_removed', OLD.title, NULL,
        jsonb_build_object('child_id', OLD.id), actor);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    PERFORM public.log_activity(NEW.id, 'status', public.status_name(OLD.status_id), public.status_name(NEW.status_id),
      jsonb_build_object('to_category', (SELECT category FROM public.ticket_statuses WHERE id = NEW.status_id),
                         'to_color', (SELECT color FROM public.ticket_statuses WHERE id = NEW.status_id)), actor);
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM public.log_activity(NEW.id, 'priority', OLD.priority::text, NEW.priority::text, '{}'::jsonb, actor);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    PERFORM public.log_activity(NEW.id, 'title', OLD.title, NEW.title, '{}'::jsonb, actor);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    -- Açıklamanın tamamı saklanmaz (yorum/eki büyütür); uzunluk farkı yeterli ipucu.
    PERFORM public.log_activity(NEW.id, 'description', NULL, NULL,
      jsonb_build_object('from_len', length(COALESCE(OLD.description, '')), 'to_len', length(COALESCE(NEW.description, ''))), actor);
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    PERFORM public.log_activity(NEW.id, 'due_date', OLD.due_date::text, NEW.due_date::text, '{}'::jsonb, actor);
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM public.log_activity(NEW.id, CASE WHEN NEW.archived_at IS NULL THEN 'unarchived' ELSE 'archived' END, NULL, NULL, '{}'::jsonb, actor);
  END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM public.log_activity(NEW.id, 'parent',
      (SELECT title FROM public.tickets WHERE id = OLD.parent_id),
      (SELECT title FROM public.tickets WHERE id = NEW.parent_id), '{}'::jsonb, actor);
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title, jsonb_build_object('child_id', NEW.id), actor);
    END IF;
    IF OLD.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(OLD.parent_id, 'child_removed', OLD.title, NULL, jsonb_build_object('child_id', OLD.id), actor);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tickets_activity_ins ON public.tickets;
CREATE TRIGGER tickets_activity_ins AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_activity();
DROP TRIGGER IF EXISTS tickets_activity_upd ON public.tickets;
CREATE TRIGGER tickets_activity_upd AFTER UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_activity();
DROP TRIGGER IF EXISTS tickets_activity_del ON public.tickets;
CREATE TRIGGER tickets_activity_del AFTER DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_activity();

-- ── Bağlı tablolar ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assignees_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'assignee_added', NULL, public.person_name(NEW.user_id), jsonb_build_object('user_id', NEW.user_id));
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'assignee_removed', public.person_name(OLD.user_id), NULL, jsonb_build_object('user_id', OLD.user_id));
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS assignees_activity ON public.ticket_assignees;
CREATE TRIGGER assignees_activity AFTER INSERT OR DELETE ON public.ticket_assignees
  FOR EACH ROW EXECUTE FUNCTION public.assignees_activity();

CREATE OR REPLACE FUNCTION public.tags_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'tag_added', NULL, (SELECT name FROM public.tags WHERE id = NEW.tag_id),
      jsonb_build_object('color', (SELECT color FROM public.tags WHERE id = NEW.tag_id)));
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'tag_removed', (SELECT name FROM public.tags WHERE id = OLD.tag_id), NULL, '{}'::jsonb);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS tags_activity ON public.ticket_tag_assignments;
CREATE TRIGGER tags_activity AFTER INSERT OR DELETE ON public.ticket_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tags_activity();

CREATE OR REPLACE FUNCTION public.attachments_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'attachment_added', NULL, NEW.file_name, '{}'::jsonb);
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'attachment_removed', OLD.file_name, NULL, '{}'::jsonb);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS attachments_activity ON public.ticket_attachments;
CREATE TRIGGER attachments_activity AFTER INSERT OR DELETE ON public.ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION public.attachments_activity();

CREATE OR REPLACE FUNCTION public.deadlines_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'deadline_added', NULL, NEW.date::text, jsonb_build_object('note', NEW.description));
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'deadline_removed', OLD.date::text, NULL, jsonb_build_object('note', OLD.description));
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS deadlines_activity ON public.ticket_deadlines;
CREATE TRIGGER deadlines_activity AFTER INSERT OR DELETE ON public.ticket_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.deadlines_activity();

CREATE OR REPLACE FUNCTION public.comments_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'comment_added', NULL, left(NEW.content, 120), '{}'::jsonb, NEW.author_id);
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'comment_removed', left(OLD.content, 120), NULL, '{}'::jsonb);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS comments_activity ON public.ticket_comments;
CREATE TRIGGER comments_activity AFTER INSERT OR DELETE ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_activity();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_links') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.links_activity() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          PERFORM public.log_activity(NEW.ticket_id, 'link_added', NULL, (SELECT title FROM public.tickets WHERE id = NEW.linked_ticket_id), '{}'::jsonb);
          RETURN NEW;
        END IF;
        PERFORM public.log_activity(OLD.ticket_id, 'link_removed', (SELECT title FROM public.tickets WHERE id = OLD.linked_ticket_id), NULL, '{}'::jsonb);
        RETURN OLD;
      END $b$;
    $f$;
    DROP TRIGGER IF EXISTS links_activity ON public.ticket_links;
    CREATE TRIGGER links_activity AFTER INSERT OR DELETE ON public.ticket_links
      FOR EACH ROW EXECUTE FUNCTION public.links_activity();
  END IF;
END $$;

-- ── Geçmiş için tek seferlik doldurma ────────────────────────────────────────
-- Var olan görevlerin oluşturulma kaydı yazılır; ne zaman hangi duruma geçtikleri
-- kayıtlı olmadığı için o geçişler uydurulmaz (günlük bu migration'dan itibaren dolar).
INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, to_value, meta, created_at)
SELECT t.id, t.created_by, 'created', t.title,
       jsonb_build_object('status', public.status_name(t.status_id), 'backfilled', true), t.created_at
FROM public.tickets t
WHERE NOT EXISTS (SELECT 1 FROM public.ticket_activity a WHERE a.ticket_id = t.id AND a.kind = 'created');

-- Realtime yayını (diğer sekmeler anında görsün)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ticket_activity'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_activity;
    END IF;
  END IF;
END $$;
