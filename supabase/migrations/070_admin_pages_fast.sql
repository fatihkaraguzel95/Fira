-- 069'daki "sayfaların gösterdiği dosya sayısı" alanı, bütün sayfa ve sürüm
-- içeriklerinde regex araması yapıyordu: admin_overview() 7,5 saniye sürmeye
-- başladı (ölçüldü; aramanın kendisi 7,4 sn). Yönetim ekranı her açılışta bunu
-- çağırıyor.
--
-- Aynı bilgi depolama yolundan çok daha ucuza çıkıyor: sayfa dosyaları
-- `<kullanıcı>/<sayfa id>/…` altına yükleniyor (064), yani ikinci yol parçası
-- bir sayfa id'si ise o nesne bir sayfaya ait. Üstelik boyutu da verir.

CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB; pf JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object('n', count(*), 'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0))
    INTO pf
    FROM storage.objects o
   WHERE split_part(o.name, '/', 2) IN (SELECT id::text FROM pages);
  SELECT jsonb_build_object(
    'teams', (SELECT count(*) FROM teams),
    'lists', (SELECT count(*) FROM projects),
    'folders', (SELECT count(*) FROM team_folders),
    'users', (SELECT count(*) FROM profiles),
    'tickets', (SELECT count(*) FROM tickets WHERE parent_id IS NULL),
    'subtasks', (SELECT count(*) FROM tickets WHERE parent_id IS NOT NULL),
    'open_tickets', (SELECT count(*) FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.archived_at IS NULL AND coalesce(s.category, 'active') NOT IN ('closed', 'done')),
    'comments', (SELECT count(*) FROM ticket_comments),
    'attachments', (SELECT count(*) FROM ticket_attachments),
    'pages', (SELECT count(*) FROM pages WHERE archived_at IS NULL),
    'pages_trashed', (SELECT count(*) FROM pages WHERE archived_at IS NOT NULL),
    'pages_purge_due', (SELECT count(*) FROM pages WHERE archived_at IS NOT NULL AND archived_at < now() - interval '60 days'),
    'page_versions', (SELECT count(*) FROM page_versions),
    'pages_by_source', (
      SELECT coalesce(jsonb_object_agg(src, n), '{}'::jsonb)
      FROM (SELECT coalesce(source, 'manual') src, count(*) n FROM pages WHERE archived_at IS NULL GROUP BY 1) s
    ),
    'last_page_import', (SELECT max(created_at) FROM pages WHERE source = 'onenote'),
    'last_page_edit', (SELECT max(updated_at) FROM pages WHERE archived_at IS NULL),
    'page_files', pf->'n',
    'page_bytes', pf->'bytes',
    'ai_requests', (
      SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      FROM (SELECT status, count(*) n FROM ai_work_requests GROUP BY 1) a
    ),
    'last_ai_request', (SELECT max(created_at) FROM ai_work_requests),
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
