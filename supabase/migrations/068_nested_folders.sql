-- 068: nested folders (#1F44279C: "Klasörün altına klasör de eklenebilir").
-- team_folders.parent_id: a folder may sit inside another folder of the same team.
-- Deleting a folder moves what it holds — lists, pages, subfolders — to its parent
-- (before: lists went to the team root through the FK's SET NULL).

ALTER TABLE public.team_folders ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.team_folders(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS team_folders_parent_idx ON public.team_folders(parent_id);

-- Same team, never inside itself or its own subfolder.
CREATE OR REPLACE FUNCTION public.team_folders_check_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cur uuid; hops int := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Klasör kendi içine taşınamaz.' USING ERRCODE = 'check_violation';
  END IF;
  -- (a parent not there yet is fine: a restore inserts all folders in one
  -- statement and the foreign key checks existence at its end)
  IF EXISTS (SELECT 1 FROM team_folders WHERE id = NEW.parent_id AND team_id <> NEW.team_id) THEN
    RAISE EXCEPTION 'Üst klasör aynı takımda olmalı.' USING ERRCODE = 'check_violation';
  END IF;
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL AND hops < 100 LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Klasör kendi alt klasörünün içine taşınamaz.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_id INTO cur FROM team_folders WHERE id = cur;
    hops := hops + 1;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS team_folders_check_parent ON public.team_folders;
CREATE TRIGGER team_folders_check_parent BEFORE INSERT OR UPDATE OF parent_id ON public.team_folders
  FOR EACH ROW EXECUTE FUNCTION public.team_folders_check_parent();

-- Contents move up one level. Skipped while the whole team is being deleted
-- (the cascade removes everything anyway; moving rows mid-cascade would fight it).
CREATE OR REPLACE FUNCTION public.team_folders_before_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id) THEN RETURN OLD; END IF;
  UPDATE team_folders SET parent_id = OLD.parent_id WHERE parent_id = OLD.id;
  UPDATE projects SET folder_id = OLD.parent_id WHERE folder_id = OLD.id;
  UPDATE pages SET folder_id = OLD.parent_id WHERE folder_id = OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.team_folders_before_delete() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_folders_check_parent() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS team_folders_before_delete ON public.team_folders;
CREATE TRIGGER team_folders_before_delete BEFORE DELETE ON public.team_folders
  FOR EACH ROW EXECUTE FUNCTION public.team_folders_before_delete();

-- Backups carry parent_id (export reads select *); restore/copy keeps the nesting.
CREATE OR REPLACE FUNCTION public.import_bundle(p_bundle jsonb, p_mode text, p_target_team uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  me uuid := auth.uid();
  v_bundle_team uuid;
  v_team uuid;
  v_counts jsonb := '{}'::jsonb;
  v_unmapped text[];
  n int;
  has_owner boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Oturum yok'; END IF;
  IF p_mode NOT IN ('restore', 'skip', 'copy') THEN RAISE EXCEPTION 'Geçersiz mod: %', p_mode; END IF;
  IF coalesce((p_bundle->>'schema_version')::int, 0) <> 1 THEN RAISE EXCEPTION 'Desteklenmeyen yedek şeması (v%)', p_bundle->>'schema_version'; END IF;
  v_bundle_team := (p_bundle->'team'->>'id')::uuid;

  CREATE TEMP TABLE _ids (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE _users (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP;

  -- users by e-mail
  INSERT INTO _users
  SELECT (p->>'id')::uuid, pr.id
  FROM jsonb_array_elements(coalesce(p_bundle->'profiles', '[]')) p
  JOIN profiles pr ON lower(pr.email) = lower(p->>'email')
  ON CONFLICT DO NOTHING;
  SELECT coalesce(array_agg(p->>'email'), '{}') INTO v_unmapped
  FROM jsonb_array_elements(coalesce(p_bundle->'profiles', '[]')) p
  WHERE NOT EXISTS (SELECT 1 FROM _users u WHERE u.old = (p->>'id')::uuid);

  -- entity ids
  INSERT INTO _ids
  SELECT (e->>'id')::uuid, CASE WHEN p_mode = 'copy' THEN gen_random_uuid() ELSE (e->>'id')::uuid END
  FROM (
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'team_colors', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'team_folders', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'projects', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_statuses', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'tags', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_comments', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_attachments', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_deadlines', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_links', '[]')) e
  ) x
  WHERE e ? 'id'
  ON CONFLICT DO NOTHING;

  -- ── team ────────────────────────────────────────────────────────────────
  IF p_mode = 'copy' THEN
    IF p_target_team IS NOT NULL THEN
      IF NOT public.is_team_admin(p_target_team) THEN RAISE EXCEPTION 'Hedef takımda yönetici değilsiniz'; END IF;
      v_team := p_target_team;
    ELSE
      v_team := gen_random_uuid();
      INSERT INTO teams (id, name, code, created_by)
      VALUES (v_team, (p_bundle->'team'->>'name') || ' (kopya)', upper(substr(md5(random()::text), 1, 8)), me);
      INSERT INTO team_members (team_id, user_id, role) VALUES (v_team, me, 'owner') ON CONFLICT DO NOTHING; -- a teams trigger may already add the creator
    END IF;
  ELSE
    v_team := v_bundle_team;
    IF EXISTS (SELECT 1 FROM teams WHERE id = v_team) THEN
      IF NOT public.is_team_admin(v_team) THEN RAISE EXCEPTION 'Bu takımda yönetici değilsiniz'; END IF;
      IF p_mode = 'restore' THEN
        UPDATE teams SET name = p_bundle->'team'->>'name' WHERE id = v_team;
      END IF;
    ELSE
      INSERT INTO teams (id, name, code, created_by, created_at)
      VALUES (v_team, p_bundle->'team'->>'name', coalesce(p_bundle->'team'->>'code', upper(substr(md5(random()::text), 1, 8))), me, coalesce((p_bundle->'team'->>'created_at')::timestamptz, now()));
      INSERT INTO team_members (team_id, user_id, role) VALUES (v_team, me, 'owner') ON CONFLICT DO NOTHING; -- a teams trigger may already add the creator
    END IF;
  END IF;
  INSERT INTO _ids VALUES (v_bundle_team, v_team) ON CONFLICT (old) DO UPDATE SET new = EXCLUDED.new;

  -- ── members (only users that exist here; never demote/replace the owner) ──
  SELECT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_team AND role = 'owner') INTO has_owner;
  INSERT INTO team_members (team_id, user_id, role, joined_at)
  SELECT v_team, u.new,
         CASE WHEN m->>'role' = 'owner' AND has_owner THEN 'admin' ELSE coalesce(m->>'role', 'member') END,
         coalesce((m->>'joined_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'members', '[]')) m
  JOIN _users u ON u.old = (m->>'user_id')::uuid
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('members', n);

  -- ── colours ───────────────────────────────────────────────────────────
  INSERT INTO team_colors (id, team_id, name, hex, order_index, created_at)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', e->>'hex', coalesce((e->>'order_index')::int, 0), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'team_colors', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, hex = EXCLUDED.hex, order_index = EXCLUDED.order_index
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('team_colors', n);

  -- ── folders ───────────────────────────────────────────────────────────
  INSERT INTO team_folders (id, team_id, name, color_id, order_index, created_by, created_at, parent_id)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', imp_id((e->>'color_id')::uuid), coalesce((e->>'order_index')::int, 0), imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()), imp_id((e->>'parent_id')::uuid)
  FROM jsonb_array_elements(coalesce(p_bundle->'team_folders', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color_id = EXCLUDED.color_id, order_index = EXCLUDED.order_index, parent_id = EXCLUDED.parent_id
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('team_folders', n);

  -- ── lists (projects) ──────────────────────────────────────────────────
  INSERT INTO projects (id, team_id, name, description, created_by, created_at, archived, folder_id, icon, icon_url, color_id, order_index)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', e->>'description', imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()),
         coalesce((e->>'archived')::boolean, false), imp_id((e->>'folder_id')::uuid), e->>'icon', e->>'icon_url', imp_id((e->>'color_id')::uuid), coalesce((e->>'order_index')::int, 0)
  FROM jsonb_array_elements(coalesce(p_bundle->'projects', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, archived = EXCLUDED.archived, folder_id = EXCLUDED.folder_id,
    icon = EXCLUDED.icon, icon_url = EXCLUDED.icon_url, color_id = EXCLUDED.color_id, order_index = EXCLUDED.order_index
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('projects', n);

  -- ── statuses ──────────────────────────────────────────────────────────
  INSERT INTO ticket_statuses (id, project_id, name, color, order_index, category, is_cancelled)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'project_id')::uuid), e->>'name', coalesce(e->>'color', '#6b7280'), coalesce((e->>'order_index')::int, 0),
         coalesce(e->>'category', 'active'), coalesce((e->>'is_cancelled')::boolean, false)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_statuses', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, order_index = EXCLUDED.order_index, category = EXCLUDED.category, is_cancelled = EXCLUDED.is_cancelled
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_statuses', n);

  -- ── tags ──────────────────────────────────────────────────────────────
  INSERT INTO tags (id, project_id, name, color, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'project_id')::uuid), e->>'name', coalesce(e->>'color', '#6b7280'), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'tags', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tags', n);

  -- ── tickets (parents first: insert everything without parent_id, then link) ──
  INSERT INTO tickets (id, title, description, status, status_id, priority, assignee_id, due_date, created_by, created_at, updated_at, order_index, project_id, updated_by, archived_at, parent_id)
  SELECT imp_id((e->>'id')::uuid), e->>'title', e->>'description', coalesce(e->>'status', 'todo'), imp_id((e->>'status_id')::uuid),
         CASE WHEN e->>'priority' IN ('low','medium','high','critical') THEN (e->>'priority')::ticket_priority ELSE NULL END,
         (SELECT new FROM _users WHERE old = (e->>'assignee_id')::uuid), (e->>'due_date')::date,
         imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()), coalesce((e->>'updated_at')::timestamptz, now()),
         coalesce((e->>'order_index')::int, 0), imp_id((e->>'project_id')::uuid), (SELECT new FROM _users WHERE old = (e->>'updated_by')::uuid),
         (e->>'archived_at')::timestamptz, NULL
  FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, status_id = EXCLUDED.status_id,
    priority = EXCLUDED.priority, due_date = EXCLUDED.due_date, updated_at = EXCLUDED.updated_at, order_index = EXCLUDED.order_index,
    project_id = EXCLUDED.project_id, archived_at = EXCLUDED.archived_at
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tickets', n);

  UPDATE tickets t SET parent_id = imp_id((e->>'parent_id')::uuid)
  FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e
  WHERE t.id = imp_id((e->>'id')::uuid) AND e->>'parent_id' IS NOT NULL
    AND (p_mode <> 'skip' OR t.parent_id IS NULL)
    AND EXISTS (SELECT 1 FROM tickets p WHERE p.id = imp_id((e->>'parent_id')::uuid));

  -- ── assignees / tags / deadlines / comments / attachments / links ─────
  INSERT INTO ticket_assignees (ticket_id, user_id)
  SELECT imp_id((e->>'ticket_id')::uuid), u.new
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_assignees', '[]')) e JOIN _users u ON u.old = (e->>'user_id')::uuid
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_assignees', n);

  INSERT INTO ticket_tag_assignments (ticket_id, tag_id)
  SELECT imp_id((e->>'ticket_id')::uuid), imp_id((e->>'tag_id')::uuid)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_tag_assignments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid)) AND EXISTS (SELECT 1 FROM tags g WHERE g.id = imp_id((e->>'tag_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_tag_assignments', n);

  INSERT INTO ticket_deadlines (id, ticket_id, date, description, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), (e->>'date')::date, e->>'description', coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_deadlines', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, description = EXCLUDED.description WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_deadlines', n);

  INSERT INTO ticket_comments (id, ticket_id, author_id, content, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), imp_user((e->>'author_id')::uuid, me), e->>'content', coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_comments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_comments', n);

  INSERT INTO ticket_attachments (id, ticket_id, file_url, file_name, uploaded_by, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), e->>'file_url', e->>'file_name', imp_user((e->>'uploaded_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_attachments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET file_url = EXCLUDED.file_url, file_name = EXCLUDED.file_name WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_attachments', n);

  INSERT INTO ticket_links (id, ticket_id, linked_ticket_id, created_by, created_at, order_index)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), imp_id((e->>'linked_ticket_id')::uuid), imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()), coalesce((e->>'order_index')::int, 0)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_links', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid)) AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'linked_ticket_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_links', n);

  RETURN jsonb_build_object(
    'mode', p_mode,
    'team_id', v_team,
    'counts', v_counts,
    'unmapped_users', to_jsonb(v_unmapped),
    'id_map', CASE WHEN p_mode = 'copy' THEN (SELECT coalesce(jsonb_object_agg(old, new), '{}') FROM _ids) ELSE '{}'::jsonb END
  );
END $function$;
