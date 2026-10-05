-- 036: system admin role + admin page backend
--  profiles.is_admin (set only via SQL), is_system_admin()
--  system_status   — server collector writes a JSON report every 5 min (disk, containers, backups, versions)
--  system_settings — announcement / maintenance flags (readable by everyone, writable by admins)
--  deploy_log      — one row per deploy (written by the deploy step)
--  admin_audit     — who did what in the admin page
--  admin_* RPCs    — overview, metrics, users, ban, purge, orphan files, auth log

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE profiles SET is_admin = true WHERE id IN ('9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63', 'b7b4c570-4b45-492e-9e02-5970c88ee48c');

CREATE OR REPLACE FUNCTION public.is_system_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_admin FROM profiles WHERE id = auth.uid()), false)
$$;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;

-- ── tables ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_status (
  id BIGSERIAL PRIMARY KEY,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL
);
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_status_admin ON system_status;
CREATE POLICY system_status_admin ON system_status FOR SELECT TO authenticated USING (public.is_system_admin());

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_read ON system_settings;
DROP POLICY IF EXISTS settings_write ON system_settings;
CREATE POLICY settings_read ON system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY settings_write ON system_settings FOR ALL TO authenticated USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

CREATE TABLE IF NOT EXISTS deploy_log (
  id BIGSERIAL PRIMARY KEY,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version TEXT,
  bundle TEXT,
  note TEXT
);
ALTER TABLE deploy_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deploy_log_admin ON deploy_log;
CREATE POLICY deploy_log_admin ON deploy_log FOR SELECT TO authenticated USING (public.is_system_admin());

CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  details JSONB
);
ALTER TABLE admin_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_audit_admin ON admin_audit;
CREATE POLICY admin_audit_admin ON admin_audit FOR SELECT TO authenticated USING (public.is_system_admin());

-- admins may delete any storage object (orphan cleanup)
DROP POLICY IF EXISTS storage_delete_admin ON storage.objects;
CREATE POLICY storage_delete_admin ON storage.objects FOR DELETE TO authenticated USING (public.is_system_admin());

-- realtime for settings (announcement / maintenance reach clients live)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'system_settings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_settings;
  END IF;
END $$;

-- ── helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_guard() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_system_admin() THEN RAISE EXCEPTION 'Yalnızca sistem yöneticisi' USING ERRCODE = 'insufficient_privilege'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_log(p_action TEXT, p_target TEXT, p_details JSONB DEFAULT NULL) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO admin_audit (actor, action, target, details) VALUES (auth.uid(), p_action, p_target, p_details)
$$;

-- ── overview ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'teams', (SELECT count(*) FROM teams),
    'lists', (SELECT count(*) FROM projects),
    'users', (SELECT count(*) FROM profiles),
    'tickets', (SELECT count(*) FROM tickets WHERE parent_id IS NULL),
    'subtasks', (SELECT count(*) FROM tickets WHERE parent_id IS NOT NULL),
    'open_tickets', (SELECT count(*) FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.archived_at IS NULL AND coalesce(s.category, 'active') NOT IN ('closed', 'done')),
    'comments', (SELECT count(*) FROM ticket_comments),
    'attachments', (SELECT count(*) FROM ticket_attachments),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'storage_bytes', (SELECT coalesce(sum((metadata->>'size')::bigint), 0) FROM storage.objects),
    'db_bytes', pg_database_size(current_database()),
    'active_users_7d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '7 days'),
    'active_users_30d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '30 days'),
    'pg_version', current_setting('server_version'),
    'last_status', (SELECT jsonb_build_object('collected_at', collected_at, 'payload', payload) FROM system_status ORDER BY collected_at DESC LIMIT 1),
    'last_deploy', (SELECT jsonb_build_object('deployed_at', deployed_at, 'version', version, 'bundle', bundle, 'note', note) FROM deploy_log ORDER BY deployed_at DESC LIMIT 1),
    'settings', (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM system_settings),
    'realtime_tables', (SELECT coalesce(jsonb_agg(tablename ORDER BY tablename), '[]'::jsonb) FROM pg_publication_tables WHERE pubname = 'supabase_realtime'),
    'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit)), '[]'::jsonb) FROM storage.buckets)
  ) INTO r;
  RETURN r;
END $$;

-- ── metrics ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_metrics(p_days INT DEFAULT 30) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB; since TIMESTAMPTZ := now() - (greatest(p_days, 1) || ' days')::interval;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'days', p_days,
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'created', c.n, 'closed', cl.n, 'comments', cm.n, 'logins', lg.n) ORDER BY d), '[]'::jsonb)
      FROM generate_series(date_trunc('day', since), date_trunc('day', now()), interval '1 day') d
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t WHERE date_trunc('day', t.created_at) = d) c ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id WHERE s.category IN ('closed','done') AND date_trunc('day', t.updated_at) = d) cl ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM ticket_comments x WHERE date_trunc('day', x.created_at) = d) cm ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM auth.audit_log_entries a WHERE a.payload->>'action' = 'login' AND date_trunc('day', a.created_at) = d) lg ON true
    ),
    'status_categories', (
      SELECT coalesce(jsonb_object_agg(cat, n), '{}'::jsonb) FROM (
        SELECT coalesce(s.category, 'active') cat, count(*) n FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.archived_at IS NULL GROUP BY 1
      ) x
    ),
    'top_users', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('email', email, 'name', full_name, 'tickets', tk, 'comments', cm) ORDER BY tk + cm DESC), '[]'::jsonb) FROM (
        SELECT p.email, p.full_name,
          (SELECT count(*) FROM tickets t WHERE t.created_by = p.id AND t.created_at > since) tk,
          (SELECT count(*) FROM ticket_comments c WHERE c.author_id = p.id AND c.created_at > since) cm
        FROM profiles p
      ) u WHERE tk + cm > 0 LIMIT 10
    ),
    'avg_close_hours', (
      SELECT round(coalesce(avg(extract(epoch FROM (t.updated_at - t.created_at)) / 3600), 0)::numeric, 1)
      FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id WHERE s.category IN ('closed','done') AND t.updated_at > since
    ),
    'archived', (SELECT count(*) FROM tickets WHERE archived_at IS NOT NULL),
    'per_list', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('list', p.name, 'team', tm.name, 'open', o.n, 'total', tt.n) ORDER BY tt.n DESC), '[]'::jsonb)
      FROM projects p JOIN teams tm ON tm.id = p.team_id
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.project_id = p.id AND t.archived_at IS NULL AND coalesce(s.category,'active') NOT IN ('closed','done')) o ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t WHERE t.project_id = p.id) tt ON true
    )
  ) INTO r;
  RETURN r;
END $$;

-- ── users & teams ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_users() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'email', p.email, 'full_name', p.full_name, 'is_admin', p.is_admin, 'avatar_url', p.avatar_url,
    'created_at', p.created_at, 'last_sign_in_at', u.last_sign_in_at, 'banned_until', u.banned_until,
    'teams', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', m.role)), '[]'::jsonb) FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = p.id)
  ) ORDER BY u.last_sign_in_at DESC NULLS LAST), '[]'::jsonb)
  INTO r FROM profiles p LEFT JOIN auth.users u ON u.id = p.id;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_teams() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'created_at', t.created_at,
    'owner', (SELECT p.email FROM team_members m JOIN profiles p ON p.id = m.user_id WHERE m.team_id = t.id AND m.role = 'owner' LIMIT 1),
    'members', (SELECT count(*) FROM team_members m WHERE m.team_id = t.id),
    'lists', (SELECT count(*) FROM projects p WHERE p.team_id = t.id),
    'tickets', (SELECT count(*) FROM tickets x JOIN projects p ON p.id = x.project_id WHERE p.team_id = t.id),
    'pending_invites', (SELECT count(*) FROM team_invitations i WHERE i.team_id = t.id AND i.status = 'pending')
  ) ORDER BY t.created_at), '[]'::jsonb) INTO r FROM teams t;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_admin(p_user UUID, p_admin BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_guard();
  IF p_user = auth.uid() AND NOT p_admin THEN RAISE EXCEPTION 'Kendi yönetici yetkinizi kaldıramazsınız'; END IF;
  UPDATE profiles SET is_admin = p_admin WHERE id = p_user;
  PERFORM public.admin_log('set_admin', p_user::text, jsonb_build_object('is_admin', p_admin));
END $$;

CREATE OR REPLACE FUNCTION public.admin_ban_user(p_user UUID, p_until TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_guard();
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'Kendinizi devre dışı bırakamazsınız'; END IF;
  UPDATE auth.users SET banned_until = p_until WHERE id = p_user;
  IF p_until IS NOT NULL THEN DELETE FROM auth.sessions WHERE user_id = p_user; END IF;
  PERFORM public.admin_log(CASE WHEN p_until IS NULL THEN 'unban_user' ELSE 'ban_user' END, p_user::text, jsonb_build_object('until', p_until));
END $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_sessions(p_user UUID) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  PERFORM public.admin_guard();
  DELETE FROM auth.sessions WHERE user_id = p_user;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.admin_log('revoke_sessions', p_user::text, jsonb_build_object('count', n));
  RETURN n;
END $$;

-- ── tools ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_purge_archived(p_days INT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  PERFORM public.admin_guard();
  DELETE FROM tickets WHERE archived_at IS NOT NULL AND archived_at < now() - (greatest(p_days, 1) || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.admin_log('purge_archived', NULL, jsonb_build_object('days', p_days, 'deleted', n));
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.admin_orphan_files() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'bucket', o.bucket_id, 'size', (o.metadata->>'size')::bigint, 'created_at', o.created_at) ORDER BY o.created_at), '[]'::jsonb)
  INTO r
  FROM storage.objects o
  WHERE o.bucket_id = 'ticket-attachments'
    AND o.name NOT LIKE '%/'  -- folders
    AND NOT EXISTS (SELECT 1 FROM ticket_attachments a WHERE a.file_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.icon_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.avatar_url LIKE '%/' || o.name || '%' OR p.avatar_full_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.description LIKE '%' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM ticket_comments c WHERE c.content LIKE '%' || o.name || '%');
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_largest_files(p_limit INT DEFAULT 20) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('name', o.name, 'size', (o.metadata->>'size')::bigint, 'created_at', o.created_at) x
    FROM storage.objects o WHERE o.bucket_id = 'ticket-attachments' ORDER BY (o.metadata->>'size')::bigint DESC NULLS LAST LIMIT p_limit
  ) q;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_auth_log(p_limit INT DEFAULT 200) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('at', a.created_at, 'action', a.payload->>'action', 'actor', coalesce(a.payload->>'actor_username', a.payload->>'actor_id'), 'ip', a.ip_address, 'traits', a.payload->'traits') x
    FROM auth.audit_log_entries a ORDER BY a.created_at DESC LIMIT p_limit
  ) q;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_audit_log(p_limit INT DEFAULT 200) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('at', l.at, 'actor', p.email, 'action', l.action, 'target', l.target, 'details', l.details) x
    FROM admin_audit l LEFT JOIN profiles p ON p.id = l.actor ORDER BY l.at DESC LIMIT p_limit
  ) q;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_setting(p_key TEXT, p_value JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_guard();
  INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES (p_key, coalesce(p_value, '{}'::jsonb), now(), auth.uid())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
  PERFORM public.admin_log('set_setting', p_key, p_value);
END $$;

CREATE OR REPLACE FUNCTION public.admin_status_history(p_hours INT DEFAULT 24) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object('collected_at', collected_at, 'payload', payload) ORDER BY collected_at), '[]'::jsonb)
  INTO r FROM system_status WHERE collected_at > now() - (greatest(p_hours, 1) || ' hours')::interval;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_deploys(p_limit INT DEFAULT 30) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('deployed_at', deployed_at, 'version', version, 'bundle', bundle, 'note', note) x FROM deploy_log ORDER BY deployed_at DESC LIMIT p_limit
  ) q;
  RETURN r;
END $$;

DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY['admin_overview()', 'admin_metrics(int)', 'admin_users()', 'admin_teams()', 'admin_set_admin(uuid,boolean)', 'admin_ban_user(uuid,timestamptz)',
    'admin_revoke_sessions(uuid)', 'admin_purge_archived(int)', 'admin_orphan_files()', 'admin_largest_files(int)', 'admin_auth_log(int)', 'admin_audit_log(int)',
    'admin_set_setting(text,jsonb)', 'admin_status_history(int)', 'admin_deploys(int)', 'admin_log(text,text,jsonb)', 'admin_guard()']
  LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f); END LOOP;
END $$;
