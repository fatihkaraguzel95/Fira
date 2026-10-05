-- 093: görevi başka takımın listesine taşıma (#4e8dc8f1)
--
-- 078'de taşıma aynı takımla sınırlıydı. İstek: "kişi iki takımda da yöneticiyse
-- görevi diğer takımdaki bir listeye de taşıyabilsin". Kural buna göre ikiye
-- ayrıldı:
--   • aynı takım  → eskisi gibi yazma yetkisi (`can_write_team`) yeter,
--   • başka takım → **hem kaynakta hem hedefte** yönetici olmak şart.
--
-- Takım değişince göreve bağlı bazı satırların karşılığı kalmıyor:
--   • Etiketler zaten listeye ait; 078'deki ada göre eşleme aynen çalışıyor.
--   • Atamalar: hedef takımın üyesi olmayan kişiler düşürülüyor. Aksi hâlde
--     göremeyeceği bir görevin üstünde adı kalır, bildirim akışı da onu
--     hedeflemeye devam ederdi. Kaç kişinin düştüğü aktivite satırına yazılır.
-- Alt görevler özyinelemeyle birlikte taşınır (078), yetki her adımda
-- yeniden kontrol edilir.

CREATE OR REPLACE FUNCTION public.move_ticket(p_ticket uuid, p_project uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'görev bulunamadı'; END IF;
  IF src.project_id = p_project THEN RETURN; END IF;

  v_src_team := public.project_team(src.project_id);
  v_dst_team := public.project_team(p_project);
  IF v_dst_team IS NULL THEN RAISE EXCEPTION 'hedef liste bulunamadı'; END IF;

  IF v_dst_team = v_src_team THEN
    IF NOT public.can_write_team(v_dst_team) THEN RAISE EXCEPTION 'yetki yok'; END IF;
  ELSE
    IF NOT (public.is_team_admin(v_src_team) AND public.is_team_admin(v_dst_team)) THEN
      RAISE EXCEPTION 'başka takıma taşımak için iki takımda da yönetici olmalısın';
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
END $$;
REVOKE ALL ON FUNCTION public.move_ticket(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_ticket(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
