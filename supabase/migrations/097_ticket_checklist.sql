-- 097: Görev içi yapılacaklar listesi (#7c54fb70).
--
-- Alt görev olacak kadar büyük olmayan işler için hafif maddeler (ClickUp'taki
-- Checklist). Her madde bir görevin altında; sırası order_index, tamamlanınca
-- kim/ne zaman tetikleyiciyle yazılır. Görev kartında maddeleri gösterme
-- ayarı görevin kendi satırında (tickets.checklist_on_board).
--
-- Yalnız ekleme: yeni tablo, tickets'a varsayılanlı bir sütun, copy_ticket'e
-- maddeleri kopyalayan blok. Eski istemci ikisini de görmez, çalışmaya devam eder.

CREATE TABLE IF NOT EXISTS public.ticket_checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  done        boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  -- profiles'a bağlı değil: içe aktarılan kişiler madde yazmaz, merge_profile'a gerek yok.
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  done_by     uuid,
  done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ticket_checklist_items_ticket_idx ON public.ticket_checklist_items (ticket_id, order_index);

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS checklist_on_board boolean NOT NULL DEFAULT false;

-- Tamamlanma bilgisi ve zaman damgası sunucuda; madde başka göreve taşınamaz.
CREATE OR REPLACE FUNCTION public.checklist_items_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.title := btrim(NEW.title);
  IF TG_OP = 'UPDATE' THEN
    NEW.ticket_id := OLD.ticket_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    IF NEW.done IS DISTINCT FROM OLD.done THEN
      NEW.done_at := CASE WHEN NEW.done THEN now() END;
      NEW.done_by := CASE WHEN NEW.done THEN auth.uid() END;
    ELSE
      NEW.done_at := OLD.done_at;
      NEW.done_by := OLD.done_by;
    END IF;
  ELSE
    NEW.done_at := CASE WHEN NEW.done THEN now() END;
    NEW.done_by := CASE WHEN NEW.done THEN coalesce(auth.uid(), NEW.created_by) END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS checklist_items_before_write ON public.ticket_checklist_items;
CREATE TRIGGER checklist_items_before_write
  BEFORE INSERT OR UPDATE ON public.ticket_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.checklist_items_before_write();

-- RLS: okumak takım üyesine, yazmak yazabilen üyeye (ticket_links / ticket_deadlines ile aynı).
ALTER TABLE public.ticket_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_select ON public.ticket_checklist_items;
DROP POLICY IF EXISTS checklist_insert ON public.ticket_checklist_items;
DROP POLICY IF EXISTS checklist_update ON public.ticket_checklist_items;
DROP POLICY IF EXISTS checklist_delete ON public.ticket_checklist_items;
CREATE POLICY checklist_select ON public.ticket_checklist_items FOR SELECT TO authenticated
  USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY checklist_insert ON public.ticket_checklist_items FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY checklist_update ON public.ticket_checklist_items FOR UPDATE TO authenticated
  USING (public.can_write_team(public.ticket_team(ticket_id)))
  WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY checklist_delete ON public.ticket_checklist_items FOR DELETE TO authenticated
  USING (public.can_write_team(public.ticket_team(ticket_id)));

REVOKE ALL ON public.ticket_checklist_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_checklist_items TO authenticated;
REVOKE ALL ON FUNCTION public.checklist_items_before_write() FROM public, anon;

-- Canlı güncelleme: diğer açık pencereler ve pano maddeleri hemen görür.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ticket_checklist_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_checklist_items;
  END IF;
END $$;
-- Silinen satırda ticket_id de gelsin (istemci o görevin görünümlerini tazeler).
ALTER TABLE public.ticket_checklist_items REPLICA IDENTITY FULL;

-- copy_ticket: 094'teki tanımın aynısı + panoda gösterme ayarı ve maddeler.
-- Kopyadaki maddeler işaretsiz başlar (kopya çoğu zaman yeni bir iş için şablon).
CREATE OR REPLACE FUNCTION public.copy_ticket(p_ticket uuid, p_project uuid DEFAULT NULL::uuid, p_parent uuid DEFAULT NULL::uuid, p_suffix text DEFAULT ' (kopya)'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src      public.tickets%ROWTYPE;
  v_me     uuid := auth.uid();
  v_project uuid;
  v_status uuid;
  v_parent uuid;
  v_new    uuid;
  v_min    integer;
  v_child  uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Oturumun düşmüş görünüyor; sayfayı yenileyip yeniden dene.'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı; başkası silmiş ya da taşımış olabilir.'; END IF;
  v_project := coalesce(p_project, src.project_id);
  IF public.project_team(v_project) IS NULL OR public.project_team(v_project) <> public.project_team(src.project_id) THEN
    RAISE EXCEPTION 'Kopyalama yalnız aynı takımın listeleri arasında yapılabilir.';
  END IF;
  IF NOT public.can_write_team(public.project_team(v_project)) THEN RAISE EXCEPTION 'Bu listede değişiklik yapma yetkin yok; takım yöneticisinden yetki iste.'; END IF;

  v_status := public.target_status(v_project, src.status_id, src.status);
  v_parent := coalesce(p_parent, CASE WHEN v_project = src.project_id THEN src.parent_id END);
  SELECT coalesce(min(order_index), 0) - 1 INTO v_min FROM public.tickets WHERE status_id = v_status;

  PERFORM set_config('fira.manual_reorder', '1', true);
  INSERT INTO public.tickets (project_id, parent_id, title, description, status, status_id, priority, due_date, cover_url, created_by, updated_by, order_index, checklist_on_board)
  VALUES (v_project, v_parent, src.title || coalesce(p_suffix, ''), src.description,
          (SELECT name FROM public.ticket_statuses WHERE id = v_status), v_status,
          src.priority, src.due_date, src.cover_url, v_me, v_me, v_min, src.checklist_on_board)
  RETURNING id INTO v_new;

  INSERT INTO public.ticket_assignees (ticket_id, user_id)
  SELECT v_new, a.user_id FROM public.ticket_assignees a WHERE a.ticket_id = p_ticket;

  IF v_project = src.project_id THEN
    INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
    SELECT v_new, ta.tag_id FROM public.ticket_tag_assignments ta WHERE ta.ticket_id = p_ticket;
  ELSE
    INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
    SELECT DISTINCT v_new, t2.id
    FROM public.ticket_tag_assignments ta
    JOIN public.tags t1 ON t1.id = ta.tag_id
    JOIN public.tags t2 ON t2.project_id = v_project AND t2.name = t1.name
    WHERE ta.ticket_id = p_ticket;
  END IF;

  INSERT INTO public.ticket_attachments (ticket_id, file_url, file_name, uploaded_by)
  SELECT v_new, at.file_url, at.file_name, at.uploaded_by FROM public.ticket_attachments at WHERE at.ticket_id = p_ticket;

  INSERT INTO public.ticket_deadlines (ticket_id, date, description)
  SELECT v_new, d.date, d.description FROM public.ticket_deadlines d WHERE d.ticket_id = p_ticket;

  INSERT INTO public.ticket_checklist_items (ticket_id, title, done, order_index, created_by)
  SELECT v_new, c.title, false, c.order_index, v_me FROM public.ticket_checklist_items c WHERE c.ticket_id = p_ticket;

  -- Subtasks follow, each keeping its own name.
  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket AND archived_at IS NULL ORDER BY order_index LOOP
    PERFORM public.copy_ticket(v_child, v_project, v_new, '');
  END LOOP;

  RETURN v_new;
END $function$;
