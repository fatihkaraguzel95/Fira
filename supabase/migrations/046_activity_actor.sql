-- 046: Aktivite günlüğünde aktörün doğru saklanması
--
-- Sorun: `tickets_activity()` aktörü `COALESCE(auth.uid(), NEW.updated_by, NEW.created_by)`
-- ile buluyordu. Uygulama dışından (psql, script, içe aktarma) yapılan bir güncellemede
-- auth.uid() boş olduğu için görevin ESKİ `updated_by` değeri aktör sayılıyordu: günlükte
-- değişikliği en son dokunan kişi yapmış gibi görünüyor, o kişi de "kendi yaptığın
-- değişiklik bildirilmez" kuralına takılıp bildirim alamıyordu.
--
-- Çözüm: oturum yoksa yalnızca aynı güncellemede DEĞİŞEN `updated_by` aktör kabul edilir;
-- bilinmiyorsa NULL kalır (arayüzde "Biri" olarak görünür ve bildirim engellenmez).

CREATE OR REPLACE FUNCTION public.tickets_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Aktör: oturum sahibi. Oturum yoksa (psql, script, içe aktarma) yalnızca bu
  -- güncellemede DEĞİŞEN updated_by kabul edilir; eski değere düşmek "değişikliği
  -- en son dokunan kişi yapmış" gibi yanlış bir kayıt üretiyordu ve kullanıcı kendi
  -- yapmadığı değişiklikler için bildirim alamıyordu. Bilinmiyorsa NULL kalır.
  actor uuid := CASE
    WHEN TG_OP = 'INSERT' THEN COALESCE(public.activity_actor(), NEW.created_by)
    ELSE COALESCE(public.activity_actor(),
                  CASE WHEN NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END)
  END;
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
END $function$;
