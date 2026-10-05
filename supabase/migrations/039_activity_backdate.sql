-- 039 — Geçmiş tarihli aktivite kaydı (içe aktarma için)
--
-- İki eksik vardı:
--  1) Bir görev içe aktarıldığında "oluşturuldu" kaydı, görevin gerçek oluşturma
--     tarihiyle değil, aktarmanın yapıldığı anla yazılıyordu.
--  2) Planner'da "Tamamlanma Tarihi" ve "Tarafından tamamlanmıştır" ayrı iki alan;
--     bunlar yalnızca açıklamaya not düşülüyordu. Artık aktivite günlüğüne gerçek
--     bir "durum → tamamlandı" geçişi olarak, o tarih ve o kişiyle yazılıyorlar.

-- log_activity artık olayın gerçekleştiği anı da alabiliyor (varsayılan: şimdi).
DROP FUNCTION IF EXISTS public.log_activity(uuid, text, text, text, jsonb, uuid);
CREATE OR REPLACE FUNCTION public.log_activity(
  p_ticket uuid, p_kind text, p_from text, p_to text,
  p_meta jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT NULL, p_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ticket IS NULL THEN RETURN; END IF;
  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta, created_at)
  VALUES (p_ticket, COALESCE(p_actor, public.activity_actor()), p_kind, p_from, p_to,
          COALESCE(p_meta, '{}'::jsonb), COALESCE(p_at, now()));
END $$;

-- "Oluşturuldu" kaydı görevin kendi created_at'ini kullansın (içe aktarılan
-- görevlerde günlük gerçek tarihle başlasın).
CREATE OR REPLACE FUNCTION public.tickets_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := COALESCE(public.activity_actor(), NEW.updated_by, NEW.created_by);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.id, 'created', NULL, NEW.title,
      jsonb_build_object('status', public.status_name(NEW.status_id)),
      COALESCE(public.activity_actor(), NEW.created_by), NEW.created_at);
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title,
        jsonb_build_object('child_id', NEW.id), COALESCE(public.activity_actor(), NEW.created_by), NEW.created_at);
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

-- İçe aktarmanın taşıdığı tamamlanma bilgisi: gerçek bir durum geçişi olarak
-- günlüğe yazılır. `p_by_name` eşleşmeyen kişiler için (Planner'da olup Fira'da
-- hesabı olmayanlar) adı saklar; arayüz aktör yoksa onu gösterir.
CREATE OR REPLACE FUNCTION public.log_import_completion(
  p_ticket uuid, p_at timestamptz, p_actor uuid DEFAULT NULL,
  p_from text DEFAULT NULL, p_by_name text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st record;
BEGIN
  IF p_ticket IS NULL OR p_at IS NULL THEN RETURN; END IF;
  IF NOT public.can_write_team(public.ticket_team(p_ticket)) THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;
  -- Aynı içe aktarma iki kez çalıştırılırsa kayıt ikilenmesin.
  IF EXISTS (
    SELECT 1 FROM public.ticket_activity
    WHERE ticket_id = p_ticket AND kind = 'status' AND created_at = p_at AND (meta ->> 'imported') = 'true'
  ) THEN RETURN; END IF;

  SELECT s.name, s.category, s.color INTO st
  FROM public.tickets t JOIN public.ticket_statuses s ON s.id = t.status_id
  WHERE t.id = p_ticket;

  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta, created_at)
  VALUES (p_ticket, p_actor, 'status', p_from, st.name,
          jsonb_build_object('to_category', st.category, 'to_color', st.color, 'by_name', p_by_name, 'imported', true),
          p_at);
END $$;

REVOKE ALL ON FUNCTION public.log_import_completion(uuid, timestamptz, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_import_completion(uuid, timestamptz, uuid, text, text) TO authenticated;
