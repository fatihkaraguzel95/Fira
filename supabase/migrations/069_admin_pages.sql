-- Yönetim paneli sayfaları da görsün (#87BB78EE).
--
-- 064–068 sayfaları, sürümleri, çöp kutusunu, iç içe klasörleri ve OneNote
-- aktarımını getirdi; Yönetim ekranı bunların hiçbirini göstermiyordu:
-- "kaç sayfa var, kaç sürüm birikti, çöpte ne bekliyor, aktarım ne zaman oldu"
-- sorularının cevabı yalnızca SQL ile alınabiliyordu.
--
-- admin_overview() JSONB döndürüyor; yeni anahtarlar eklemek eski istemciyi
-- bozmaz (bilmediği anahtarı okumaz). Sayım yapılan her şey admin_guard()
-- arkasında kalır.

CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
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
    -- Sayfalar (064) ve sürümleri (067)
    'pages', (SELECT count(*) FROM pages WHERE archived_at IS NULL),
    'pages_trashed', (SELECT count(*) FROM pages WHERE archived_at IS NOT NULL),
    -- 60 günü dolmuş, ilk çöp listesi açılışında purge_expired_pages ile gidecek olanlar
    'pages_purge_due', (SELECT count(*) FROM pages WHERE archived_at IS NOT NULL AND archived_at < now() - interval '60 days'),
    'page_versions', (SELECT count(*) FROM page_versions),
    -- Sayfa nereden geldi: elle yazılan, OneNote'tan aktarılan, tablodan gelen
    'pages_by_source', (
      SELECT coalesce(jsonb_object_agg(src, n), '{}'::jsonb)
      FROM (SELECT coalesce(source, 'manual') src, count(*) n FROM pages WHERE archived_at IS NULL GROUP BY 1) s
    ),
    'last_page_import', (SELECT max(created_at) FROM pages WHERE source = 'onenote'),
    'last_page_edit', (SELECT max(updated_at) FROM pages WHERE archived_at IS NULL),
    -- Sayfaların/sürümlerin gösterdiği depolama nesneleri (admin_orphan_files'ın saydığı küme değil,
    -- yalnızca kaç dosyaya bağlı olduğumuzu gösterir)
    'page_files', (
      SELECT count(DISTINCT m[1]) FROM (
        SELECT regexp_matches(content, '/object/public/ticket-attachments/([^)"''[:space:]]+)', 'g') m FROM pages WHERE content IS NOT NULL
        UNION ALL
        SELECT regexp_matches(content, '/object/public/ticket-attachments/([^)"''[:space:]]+)', 'g') m FROM page_versions WHERE content IS NOT NULL
      ) x
    ),
    -- "Claude'a yaptır" kuyruğu (059)
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

-- En çok sayfa tutan takımlar + çöp kutusunda bekleyenler: "ne nerede duruyor"
-- sorusunun panelden cevabı.
CREATE OR REPLACE FUNCTION public.admin_pages() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'by_team', (
      SELECT coalesce(jsonb_agg(x ORDER BY (x->>'pages')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'team', t.name,
          'pages', count(*) FILTER (WHERE p.archived_at IS NULL),
          'trashed', count(*) FILTER (WHERE p.archived_at IS NOT NULL),
          'imported', count(*) FILTER (WHERE p.archived_at IS NULL AND p.source = 'onenote'),
          'versions', (SELECT count(*) FROM page_versions v JOIN pages q ON q.id = v.page_id WHERE q.team_id = t.id),
          'last_edit', max(p.updated_at)
        ) x
        FROM teams t JOIN pages p ON p.team_id = t.id
        GROUP BY t.id, t.name
      ) s
    ),
    'trash_soon', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'team', t.name, 'archived_at', p.archived_at) ORDER BY p.archived_at), '[]'::jsonb)
      FROM pages p JOIN teams t ON t.id = p.team_id
      WHERE p.archived_at IS NOT NULL AND p.archived_at < now() - interval '53 days'
    )
  ) INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.admin_pages() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_pages() TO authenticated;
