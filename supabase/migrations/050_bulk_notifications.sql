-- 050: Toplu işlemlerde (içe aktarma) bildirim seli olmasın
--
-- Bir içe aktarma iki yüz görev, yüzlerce atama ve yorum yazar; her biri aktivite
-- günlüğüne düşer ve bildirim üretirdi — kişiye aynı dakikada onlarca mesaj.
--
-- Çözüm üç parça:
--   1) İstemci toplu yazımları `x-fira-bulk: 1` başlığıyla gönderir (supabaseBulk).
--      PostgREST bu başlığı `request.headers` olarak görünür kılar; aşağıdaki trigger
--      o sırada yazılan her aktivite satırını `meta.bulk = true` ile işaretler.
--      (psql/script için aynı işi `fira.bulk` GUC'u görür.)
--   2) `activity_recipients` bulk satırları hiç kimseye dağıtmaz; istemci de
--      (notify.ts) aynı bayrağı görünce susar.
--   3) İçe aktarma bitince tek bir özet mesajı: `notify_import_summary`.

-- ── 1) Bayrak ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_mark_bulk()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_headers jsonb;
  v_flag text;
BEGIN
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_flag := coalesce(v_headers ->> 'x-fira-bulk', current_setting('fira.bulk', true));
  IF v_flag = '1' THEN
    NEW.meta := coalesce(NEW.meta, '{}'::jsonb) || '{"bulk": true}'::jsonb;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ticket_activity_mark_bulk ON public.ticket_activity;
CREATE TRIGGER ticket_activity_mark_bulk
  BEFORE INSERT ON public.ticket_activity
  FOR EACH ROW EXECUTE FUNCTION public.activity_mark_bulk();

-- ── 2) Alıcılar: bulk satırlar dağıtılmaz ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_recipients(p_activity uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (
    SELECT id, ticket_id, actor_id, kind, meta FROM public.ticket_activity WHERE id = p_activity
  )
  SELECT DISTINCT c.user_id
  FROM a
  JOIN LATERAL (
    SELECT ta.user_id FROM public.ticket_assignees ta WHERE ta.ticket_id = a.ticket_id
    UNION
    SELECT t.created_by FROM public.tickets t WHERE t.id = a.ticket_id
  ) c ON true
  WHERE c.user_id IS NOT NULL
    AND c.user_id IS DISTINCT FROM a.actor_id
    AND coalesce(a.meta ->> 'bulk', '') <> 'true'
    AND (a.kind <> 'assignee_added' OR c.user_id::text = a.meta->>'user_id')
$$;

REVOKE ALL ON FUNCTION public.activity_recipients(uuid) FROM public, anon, authenticated;

-- ── 3) İçe aktarma özeti ────────────────────────────────────────────────────
-- İçe aktarmayı yapan kişi çağırır (takım yöneticisi). p_since: aktarmanın
-- başladığı an. Aktarmada görev alan her kişiye (aktaran hariç), Telegram'ı
-- bağlıysa ve kanalı açıksa, tek bir özet mesajı kuyruğa yazılır.
CREATE OR REPLACE FUNCTION public.notify_import_summary(p_project uuid, p_since timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_team uuid;
  v_list text;
  v_total int;
  v_count int := 0;
  r record;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  SELECT team_id, name INTO v_team, v_list FROM public.projects WHERE id = p_project;
  IF v_team IS NULL THEN RAISE EXCEPTION 'liste bulunamadı'; END IF;
  IF NOT public.is_team_admin(v_team) THEN RAISE EXCEPTION 'yetki yok'; END IF;

  SELECT count(*) INTO v_total
    FROM public.tickets t
   WHERE t.project_id = p_project AND t.created_at >= p_since - interval '1 minute';

  FOR r IN
    SELECT ta.user_id, count(*) AS n
      FROM public.ticket_assignees ta
      JOIN public.tickets t ON t.id = ta.ticket_id
      JOIN public.telegram_accounts acc ON acc.user_id = ta.user_id AND acc.blocked_at IS NULL
      LEFT JOIN public.user_preferences up ON up.user_id = ta.user_id AND up.scope = 'global'
     WHERE t.project_id = p_project
       AND t.created_at >= p_since - interval '1 minute'
       AND ta.user_id <> v_me
       AND coalesce((up.prefs -> 'notifications' ->> 'telegram')::boolean, false)
     GROUP BY ta.user_id
  LOOP
    INSERT INTO public.telegram_outbox (user_id, body)
    VALUES (
      r.user_id,
      format(E'📥 <b>İçe aktarma tamamlandı</b>\n<b>%s</b> listesine %s görev eklendi; <b>%s</b> tanesi sana atandı.\n\n/bana ile listeleyebilirsin.',
             replace(replace(replace(v_list, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), v_total, r.n)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.notify_import_summary(uuid, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notify_import_summary(uuid, timestamptz) TO authenticated;
