-- 094: taşıma/kopyalama kurallarının mesajları (#4e8dc8f1, 28 Eyl 2026)
--
-- Kurallar aynı; yalnız RAISE metinleri değişti. Eskiden 'yetki yok' gibi iki
-- kelimeydi ve istemci bunu "bir şeyler ters gitti"ye çeviriyordu: kullanıcı iki
-- kez taşımayı denedi, neden olmadığını öğrenemedi (aslında demo takımda üye,
-- yönetici değil). Mesaj artık ne yapması gerektiğini de söylüyor; istemci
-- tarafında da bu sınıf hatalar (P0001) kullanıcıya olduğu gibi gösteriliyor.
--
-- Gövdeler sunucudaki güncel tanımdan alındı (093/078), yalnız metinler patched.

CREATE OR REPLACE FUNCTION public.move_ticket(p_ticket uuid, p_project uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src       public.tickets%ROWTYPE;
  v_me      uuid := auth.uid();
  v_status  uuid;
  v_min     integer;
  v_from    text;
  v_to      text;
  v_child   uuid;
  v_src_team uuid;
  v_dst_team uuid;
  v_dropped  integer := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Oturumun düşmüş görünüyor; sayfayı yenileyip yeniden dene.'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı; başkası silmiş ya da taşımış olabilir.'; END IF;
  IF src.project_id = p_project THEN RETURN; END IF;

  v_src_team := public.project_team(src.project_id);
  v_dst_team := public.project_team(p_project);
  IF v_dst_team IS NULL THEN RAISE EXCEPTION 'Hedef liste bulunamadı; liste silinmiş olabilir.'; END IF;

  IF v_dst_team = v_src_team THEN
    IF NOT public.can_write_team(v_dst_team) THEN RAISE EXCEPTION 'Bu listede değişiklik yapma yetkin yok; takım yöneticisinden yetki iste.'; END IF;
  ELSE
    IF NOT (public.is_team_admin(v_src_team) AND public.is_team_admin(v_dst_team)) THEN
      RAISE EXCEPTION 'Başka bir takımın listesine taşımak için her iki takımda da yönetici olman gerekiyor; şu an en az birinde üyesin.';
    END IF;
  END IF;

  SELECT name INTO v_from FROM public.projects WHERE id = src.project_id;
  SELECT name INTO v_to FROM public.projects WHERE id = p_project;
  v_status := public.target_status(p_project, src.status_id, src.status);
  SELECT coalesce(min(order_index), 0) - 1 INTO v_min FROM public.tickets WHERE status_id = v_status;

  PERFORM set_config('fira.manual_reorder', '1', true);
  UPDATE public.tickets
     SET project_id = p_project,
         status_id = v_status,
         status = (SELECT name FROM public.ticket_statuses WHERE id = v_status),
         order_index = v_min,
         parent_id = CASE WHEN parent_id IS NOT NULL AND (SELECT project_id FROM public.tickets x WHERE x.id = src.parent_id) <> p_project THEN NULL ELSE parent_id END,
         updated_by = v_me,
         updated_at = now()
   WHERE id = p_ticket;

  -- Tags belong to a list: keep the ones the new list also has (by name), drop the rest.
  INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
  SELECT DISTINCT p_ticket, t2.id
  FROM public.ticket_tag_assignments ta
  JOIN public.tags t1 ON t1.id = ta.tag_id AND t1.project_id = src.project_id
  JOIN public.tags t2 ON t2.project_id = p_project AND t2.name = t1.name
  WHERE ta.ticket_id = p_ticket
  ON CONFLICT DO NOTHING;
  DELETE FROM public.ticket_tag_assignments ta USING public.tags t
   WHERE ta.ticket_id = p_ticket AND t.id = ta.tag_id AND t.project_id <> p_project;

  -- Başka takıma geçtiyse: hedef takımın üyesi olmayan atamalar düşer.
  IF v_dst_team <> v_src_team THEN
    WITH gone AS (
      DELETE FROM public.ticket_assignees a
       WHERE a.ticket_id = p_ticket
         AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = v_dst_team AND tm.user_id = a.user_id)
      RETURNING 1
    ) SELECT count(*) INTO v_dropped FROM gone;
  END IF;

  PERFORM public.log_activity(p_ticket, 'project', v_from, v_to,
    jsonb_build_object('from_project', src.project_id, 'to_project', p_project)
      || CASE WHEN v_dst_team <> v_src_team
              THEN jsonb_build_object('from_team', v_src_team, 'to_team', v_dst_team, 'dropped_assignees', v_dropped)
              ELSE '{}'::jsonb END,
    v_me);

  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket LOOP
    PERFORM public.move_ticket(v_child, p_project);
  END LOOP;
END $function$;

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
  INSERT INTO public.tickets (project_id, parent_id, title, description, status, status_id, priority, due_date, cover_url, created_by, updated_by, order_index)
  VALUES (v_project, v_parent, src.title || coalesce(p_suffix, ''), src.description,
          (SELECT name FROM public.ticket_statuses WHERE id = v_status), v_status,
          src.priority, src.due_date, src.cover_url, v_me, v_me, v_min)
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

  -- Subtasks follow, each keeping its own name.
  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket AND archived_at IS NULL ORDER BY order_index LOOP
    PERFORM public.copy_ticket(v_child, v_project, v_new, '');
  END LOOP;

  RETURN v_new;
END $function$;
