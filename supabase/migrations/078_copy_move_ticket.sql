-- 078: Copy a task, move a task to another list (#7120F27C)
--
-- Both run on the server so a task and everything hanging off it travel in one
-- transaction: subtasks (recursively), assignees, tags, attachment rows and
-- deadlines. Rules:
--   * target list must be in the SAME team (assignees stay valid, RLS stays simple)
--   * status: same status when the list does not change; otherwise the target
--     list's status with the same name, else its first column
--   * tags: same rows in the same list; matched by name in another list, the
--     rest dropped (tags belong to a list)
--   * the copy goes to the top of its column; the root copy gets " (kopya)"
--   * links (ticket_links) and comments are NOT copied; moving keeps both
-- Activity: the copy logs its own `created`; a move logs `project` (old → new
-- list name) on the moved task and each moved subtask.

CREATE OR REPLACE FUNCTION public.target_status(p_project uuid, p_status_id uuid, p_status_name text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT id FROM public.ticket_statuses WHERE id = p_status_id AND project_id = p_project),
    (SELECT id FROM public.ticket_statuses WHERE project_id = p_project AND name = p_status_name ORDER BY order_index LIMIT 1),
    (SELECT id FROM public.ticket_statuses WHERE project_id = p_project ORDER BY order_index LIMIT 1)
  )
$$;
REVOKE ALL ON FUNCTION public.target_status(uuid, uuid, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.copy_ticket(p_ticket uuid, p_project uuid DEFAULT NULL, p_parent uuid DEFAULT NULL, p_suffix text DEFAULT ' (kopya)')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'görev bulunamadı'; END IF;
  v_project := coalesce(p_project, src.project_id);
  IF public.project_team(v_project) IS NULL OR public.project_team(v_project) <> public.project_team(src.project_id) THEN
    RAISE EXCEPTION 'hedef liste aynı takımda olmalı';
  END IF;
  IF NOT public.can_write_team(public.project_team(v_project)) THEN RAISE EXCEPTION 'yetki yok'; END IF;

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
END $$;
REVOKE ALL ON FUNCTION public.copy_ticket(uuid, uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.copy_ticket(uuid, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.move_ticket(p_ticket uuid, p_project uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  src      public.tickets%ROWTYPE;
  v_me     uuid := auth.uid();
  v_status uuid;
  v_min    integer;
  v_from   text;
  v_to     text;
  v_child  uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'görev bulunamadı'; END IF;
  IF src.project_id = p_project THEN RETURN; END IF;
  IF public.project_team(p_project) IS NULL OR public.project_team(p_project) <> public.project_team(src.project_id) THEN
    RAISE EXCEPTION 'hedef liste aynı takımda olmalı';
  END IF;
  IF NOT public.can_write_team(public.project_team(p_project)) THEN RAISE EXCEPTION 'yetki yok'; END IF;

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

  PERFORM public.log_activity(p_ticket, 'project', v_from, v_to, jsonb_build_object('from_project', src.project_id, 'to_project', p_project), v_me);

  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket LOOP
    PERFORM public.move_ticket(v_child, p_project);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.move_ticket(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_ticket(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
