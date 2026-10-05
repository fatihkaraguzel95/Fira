-- 091: Yönetici paneli — kullanıcı silme, "bugün" metrikleri, özellik ısı haritası (#7AB2D9F6)
--
-- İstek (üç veritabanı parçası):
--   • "kullanıcı silme. Hans Bilal'i sehven yarattık, silemiyoruz."
--   • "Metriklere bugün eklensin"
--   • "bir heat map eklemek ne kadar zor? Hiç kullanılmayan özellikler ve çok
--      kullanılan özellikler gibi"

-- ── 1) Kullanıcının izi ──────────────────────────────────────────────────────
-- Silmeden önce ne bıraktığını göstermek şart: `profiles`e bakan yabancı
-- anahtarların çoğu CASCADE — kullanıcıyı öylece silmek onun açtığı görevleri,
-- yorumları, listeleri ve takımları da götürürdü. Panel önce bu sayıları
-- gösteriyor, içerik varsa silme devretmeden çalışmıyor.
CREATE OR REPLACE FUNCTION public.admin_user_footprint(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'is_admin', coalesce(p.is_admin, false),
    'source', p.source,
    'tickets',     (SELECT count(*) FROM tickets t WHERE t.created_by = p_user),
    'comments',    (SELECT count(*) FROM ticket_comments c WHERE c.author_id = p_user),
    'projects',    (SELECT count(*) FROM projects x WHERE x.created_by = p_user),
    'pages',       (SELECT count(*) FROM pages g WHERE g.created_by = p_user),
    'teams',       (SELECT count(*) FROM teams tm WHERE tm.created_by = p_user),
    'attachments', (SELECT count(*) FROM ticket_attachments a WHERE a.uploaded_by = p_user),
    'assigned',    (SELECT count(*) FROM ticket_assignees a WHERE a.user_id = p_user),
    'memberships', (SELECT count(*) FROM team_members m WHERE m.user_id = p_user),
    'owner_of',    (SELECT coalesce(jsonb_agg(tm.name ORDER BY tm.name), '[]'::jsonb)
                      FROM team_members m JOIN teams tm ON tm.id = m.team_id
                     WHERE m.user_id = p_user AND m.role = 'owner')
  ) INTO r
  FROM profiles p WHERE p.id = p_user;
  IF r IS NULL THEN RAISE EXCEPTION 'Kullanıcı bulunamadı'; END IF;
  -- Devretmeden silinebilir mi: yalnız kişisel satırları kalmışsa evet.
  r := r || jsonb_build_object('content',
    (r->>'tickets')::int + (r->>'comments')::int + (r->>'projects')::int +
    (r->>'pages')::int + (r->>'teams')::int + (r->>'attachments')::int);
  RETURN r;
END $$;

-- ── 2) Kullanıcıyı sil ───────────────────────────────────────────────────────
-- `p_reassign_to` verilirse kullanıcının **yarattığı** her şey o kişiye geçer
-- (görev, yorum, liste, sayfa, takım, ek…); kişisel satırlar (üyelik, atama,
-- favori, tercih, bildirim, Telegram bağı) silinir. Sonra `auth.users` satırı
-- silinir; `profiles` oradan CASCADE ile düşer.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user uuid, p_reassign_to uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f jsonb;
  v_name text;
BEGIN
  PERFORM public.admin_guard();
  IF p_user IS NULL THEN RAISE EXCEPTION 'Kullanıcı seçilmedi'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'Kendi hesabını silemezsin'; END IF;
  IF p_reassign_to = p_user THEN RAISE EXCEPTION 'İçerik silinen kişiye devredilemez'; END IF;

  f := public.admin_user_footprint(p_user);
  v_name := coalesce(f->>'full_name', f->>'email', p_user::text);
  IF (f->>'is_admin')::boolean THEN
    RAISE EXCEPTION 'Sistem yöneticisi silinemez; önce yönetici yetkisini kaldır';
  END IF;
  IF (f->>'content')::int > 0 AND p_reassign_to IS NULL THEN
    RAISE EXCEPTION 'Bu kullanıcının içeriği var (% görev, % yorum, % liste, % sayfa, % takım); silmeden önce devredilecek kişiyi seç',
      f->>'tickets', f->>'comments', f->>'projects', f->>'pages', f->>'teams';
  END IF;
  IF p_reassign_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_reassign_to) THEN
    RAISE EXCEPTION 'Devredilecek kullanıcı bulunamadı';
  END IF;

  IF p_reassign_to IS NOT NULL THEN
    -- Yarattıkları yeni sahibine geçer.
    UPDATE tickets            SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE tickets            SET updated_by = p_reassign_to WHERE updated_by = p_user;
    UPDATE ticket_comments    SET author_id  = p_reassign_to WHERE author_id  = p_user;
    UPDATE ticket_attachments SET uploaded_by = p_reassign_to WHERE uploaded_by = p_user;
    UPDATE ticket_links       SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE ticket_recurrences SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE projects           SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE team_folders       SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE teams              SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE pages              SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE pages              SET updated_by = p_reassign_to WHERE updated_by = p_user;
    UPDATE pages              SET archived_by = p_reassign_to WHERE archived_by = p_user;
    UPDATE page_versions      SET author_id  = p_reassign_to WHERE author_id  = p_user;
    UPDATE list_views         SET owner_id   = p_reassign_to WHERE owner_id   = p_user;
    UPDATE team_invitations   SET invited_by = p_reassign_to WHERE invited_by = p_user;
    -- Silinen kişi bir takımın sahibiyse, devralan o takımın sahibi olur.
    INSERT INTO team_members (team_id, user_id, role)
    SELECT m.team_id, p_reassign_to, 'owner' FROM team_members m
     WHERE m.user_id = p_user AND m.role = 'owner'
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'owner';
  END IF;

  -- Kişisel satırlar: devredilmez, silinir. (Çoğu zaten CASCADE ama sayıyı
  -- denetim kaydına yazabilmek için burada açıkça siliniyor.)
  DELETE FROM ticket_assignees  WHERE user_id = p_user;
  DELETE FROM team_members      WHERE user_id = p_user;
  DELETE FROM user_favorites    WHERE user_id = p_user;
  DELETE FROM user_preferences  WHERE user_id = p_user;
  DELETE FROM user_notifications WHERE user_id = p_user;
  DELETE FROM ticket_mutes      WHERE user_id = p_user;

  PERFORM public.admin_log('delete_user', v_name, f || jsonb_build_object('reassigned_to', p_reassign_to));

  -- Hesabı olan kullanıcı auth tarafından, içe aktarmayla açılmış profil
  -- doğrudan silinir (onun auth.users satırı yok).
  IF f->>'source' = 'account' THEN
    DELETE FROM auth.users WHERE id = p_user;
  END IF;
  DELETE FROM profiles WHERE id = p_user;

  RETURN jsonb_build_object('deleted', v_name, 'reassigned_to', p_reassign_to, 'footprint', f);
END $$;

-- ── 3) Metrikler: "bugün" ve yerel gün sınırı ────────────────────────────────
-- `p_days = 0` bugünü verir (yerel gece yarısından beri). Gün kovaları da artık
-- yerel saat diliminde — sunucu UTC olduğu için günler 03:00'te bölünüyordu.
-- Eski tek argümanlı sürüm kalırsa PostgREST adlandırılmış çağrıda iki aday
-- arasında kalıyor ("function admin_metrics(integer) is not unique").
DROP FUNCTION IF EXISTS public.admin_metrics(INT);
CREATE OR REPLACE FUNCTION public.admin_metrics(p_days INT DEFAULT 30, p_tz TEXT DEFAULT 'Europe/Istanbul') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r JSONB;
  tz TEXT := coalesce(nullif(p_tz, ''), 'Europe/Istanbul');
  since TIMESTAMPTZ;
BEGIN
  PERFORM public.admin_guard();
  BEGIN
    PERFORM now() AT TIME ZONE tz;
  EXCEPTION WHEN OTHERS THEN tz := 'Europe/Istanbul';
  END;
  since := CASE WHEN coalesce(p_days, 30) <= 0
    THEN date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz
    ELSE now() - (p_days || ' days')::interval END;

  SELECT jsonb_build_object(
    'days', p_days,
    'tz', tz,
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'created', c.n, 'closed', cl.n, 'comments', cm.n, 'logins', lg.n) ORDER BY d), '[]'::jsonb)
      FROM generate_series(date_trunc('day', since AT TIME ZONE tz)::date, date_trunc('day', now() AT TIME ZONE tz)::date, interval '1 day') d
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t WHERE (t.created_at AT TIME ZONE tz)::date = d::date) c ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id WHERE s.category IN ('closed','done') AND (t.updated_at AT TIME ZONE tz)::date = d::date) cl ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM ticket_comments x WHERE (x.created_at AT TIME ZONE tz)::date = d::date) cm ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM auth.audit_log_entries a WHERE a.payload->>'action' = 'login' AND (a.created_at AT TIME ZONE tz)::date = d::date) lg ON true
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

-- ── 4) Özellik ısı haritası ──────────────────────────────────────────────────
-- Fira'da ayrı bir kullanım telemetrisi yok; ama her özelliğin kendi tablosu
-- ve zaman damgası var. Burada her özellik için gün gün sayım, toplam ve son
-- kullanım çıkarılıyor: ısı haritası bunu çiziyor, "hiç kullanılmayan" da
-- toplamı sıfır olan satır oluyor. Uyarı: bu **yazma** izi; yalnız okunan
-- özellikler (pano açma, arama) burada görünmez.
CREATE OR REPLACE FUNCTION public.admin_feature_usage(p_days INT DEFAULT 30, p_tz TEXT DEFAULT 'Europe/Istanbul') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r JSONB;
  tz TEXT := coalesce(nullif(p_tz, ''), 'Europe/Istanbul');
  days INT := greatest(1, least(coalesce(p_days, 30), 180));
  since TIMESTAMPTZ;
BEGIN
  PERFORM public.admin_guard();
  BEGIN
    PERFORM now() AT TIME ZONE tz;
  EXCEPTION WHEN OTHERS THEN tz := 'Europe/Istanbul';
  END;
  since := (date_trunc('day', now() AT TIME ZONE tz) - ((days - 1) || ' days')::interval) AT TIME ZONE tz;

  WITH f(key, grp, at) AS (
    SELECT 'ticket',      'gorev',   created_at FROM tickets
    UNION ALL SELECT 'subtask',    'gorev',   created_at FROM tickets WHERE parent_id IS NOT NULL
    UNION ALL SELECT 'comment',    'gorev',   created_at FROM ticket_comments
    UNION ALL SELECT 'attachment', 'gorev',   created_at FROM ticket_attachments
    UNION ALL SELECT 'tag',        'gorev',   created_at FROM tags   -- atama satirinda zaman damgasi yok, etiket tanimi sayiliyor
    UNION ALL SELECT 'link',       'gorev',   created_at FROM ticket_links
    UNION ALL SELECT 'recurrence', 'gorev',   created_at FROM ticket_recurrences
    UNION ALL SELECT 'reminder',   'bildirim', created_at FROM ticket_activity WHERE kind = 'reminder'
    UNION ALL SELECT 'mention',    'bildirim', created_at FROM ticket_activity WHERE kind = 'mentioned'
    UNION ALL SELECT 'mute',       'bildirim', created_at FROM ticket_mutes
    UNION ALL SELECT 'page',       'sayfa',   created_at FROM pages
    UNION ALL SELECT 'page_version', 'sayfa', created_at FROM page_versions
    UNION ALL SELECT 'list',       'yapi',    created_at FROM projects
    UNION ALL SELECT 'folder',     'yapi',    created_at FROM team_folders
    UNION ALL SELECT 'saved_view', 'yapi',    created_at FROM list_views
    UNION ALL SELECT 'favorite',   'yapi',    created_at FROM user_favorites
    UNION ALL SELECT 'invite',     'takim',   created_at FROM team_invitations
    UNION ALL SELECT 'team',       'takim',   created_at FROM teams
    UNION ALL SELECT 'ai_request', 'yapayzeka', created_at FROM ai_work_requests
  ), days AS (
    SELECT generate_series(date_trunc('day', since AT TIME ZONE tz)::date,
                           date_trunc('day', now() AT TIME ZONE tz)::date, interval '1 day')::date AS d
  ), keys(key, grp) AS (
    -- Sabit liste: hiç satırı olmayan özellik de ısı haritasında görünsün
    -- ("hiç kullanılmayan" sorusunun cevabı tam olarak bu satırlar).
    VALUES ('ticket','gorev'), ('subtask','gorev'), ('comment','gorev'), ('attachment','gorev'),
           ('tag','gorev'), ('link','gorev'), ('recurrence','gorev'),
           ('reminder','bildirim'), ('mention','bildirim'), ('mute','bildirim'),
           ('page','sayfa'), ('page_version','sayfa'),
           ('list','yapi'), ('folder','yapi'), ('saved_view','yapi'), ('favorite','yapi'),
           ('invite','takim'), ('team','takim'), ('ai_request','yapayzeka')
  ), cells AS (
    SELECT k.key, k.grp, d.d,
           (SELECT count(*) FROM f WHERE f.key = k.key AND (f.at AT TIME ZONE tz)::date = d.d) AS n
      FROM keys k CROSS JOIN days d
  )
  SELECT jsonb_build_object(
    'days', days, 'tz', tz,
    'dates', (SELECT coalesce(jsonb_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d), '[]'::jsonb) FROM days),
    'features', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'key'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'key', c.key,
          'group', min(c.grp),
          'counts', jsonb_agg(c.n ORDER BY c.d),
          'window_total', sum(c.n),
          'total', (SELECT count(*) FROM f WHERE f.key = c.key),
          'last_at', (SELECT max(at) FROM f WHERE f.key = c.key)
        ) AS x
        FROM cells c GROUP BY c.key
      ) y
    )
  ) INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.admin_user_footprint(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_feature_usage(int, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_metrics(int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_footprint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_feature_usage(int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metrics(int, text) TO authenticated;
