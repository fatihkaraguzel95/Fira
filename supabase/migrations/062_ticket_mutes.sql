-- 062: Görev takibini bırakma (mute) + bildirimi okunmamış yapma (#93EE1E5F)
--
-- Bugüne kadar bildirim alıcıları yalnızca "atanan + oluşturan" kümesiydi
-- (activity_recipients, 047) ve bundan çıkmanın tek yolu görevden ayrılmaktı.
-- Bu tablo kişisel bir sessize alma listesi tutar: görevle ilişkin kalırsın ama
-- o görevin bildirimleri sana gelmez.
--
-- Sessize alma tek yerde uygulanır — activity_recipients — çünkü kutu (058),
-- Telegram (047) ve birleştirme (060) hepsi alıcı kümesini oradan alır. Böylece
-- üç kanal da aynı anda susar; her kanalda ayrı bir kontrol yok.
-- İstemcinin anlık toast'ı ayrı yoldan (realtime akış) geldiği için orada da
-- aynı liste okunur (src/lib/notify.ts).

CREATE TABLE IF NOT EXISTS public.ticket_mutes (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ticket_id  uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS ticket_mutes_user_idx ON public.ticket_mutes(user_id, created_at DESC);

ALTER TABLE public.ticket_mutes ENABLE ROW LEVEL SECURITY;

-- Sessize alma tamamen kişisel: herkes yalnız kendi satırını görür ve yönetir.
-- Görev de görebildiği bir görev olmalı (takım üyeliği), yoksa yabancı görev
-- id'leriyle satır biriktirilebilir.
DROP POLICY IF EXISTS ticket_mutes_select ON public.ticket_mutes;
CREATE POLICY ticket_mutes_select ON public.ticket_mutes FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS ticket_mutes_insert ON public.ticket_mutes;
CREATE POLICY ticket_mutes_insert ON public.ticket_mutes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);

DROP POLICY IF EXISTS ticket_mutes_delete ON public.ticket_mutes;
CREATE POLICY ticket_mutes_delete ON public.ticket_mutes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.ticket_mutes TO authenticated;
REVOKE UPDATE ON public.ticket_mutes FROM authenticated, anon;

-- ── Alıcı kümesinden sessize alınanları çıkar ────────────────────────────────
-- 047'deki gövdenin aynısı; tek fark en sondaki NOT EXISTS.
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
    AND (a.kind <> 'assignee_added' OR c.user_id::text = a.meta->>'user_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.ticket_mutes m
       WHERE m.user_id = c.user_id AND m.ticket_id = a.ticket_id
    )
$$;

REVOKE ALL ON FUNCTION public.activity_recipients(uuid) FROM public, anon, authenticated;

-- ── Okunmamış yapma ─────────────────────────────────────────────────────────
-- mark_notifications_read'in tersi. Grup satırı (060) tek bildirim olduğu için
-- geri alma da tek satırı ilgilendirir; group_count'a dokunulmaz.
CREATE OR REPLACE FUNCTION public.mark_notifications_unread(p_ids uuid[] DEFAULT NULL, p_ticket uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_n int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  IF p_ids IS NULL AND p_ticket IS NULL THEN RAISE EXCEPTION 'ne yapılacağı belirtilmedi'; END IF;
  UPDATE public.user_notifications
     SET read_at = NULL
   WHERE user_id = v_me
     AND read_at IS NOT NULL
     AND (p_ids IS NULL OR id = ANY (p_ids))
     AND (p_ticket IS NULL OR ticket_id = p_ticket);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.mark_notifications_unread(uuid[], uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_unread(uuid[], uuid) TO authenticated;
