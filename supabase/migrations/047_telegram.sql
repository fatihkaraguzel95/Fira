-- 047: Telegram kanalı
--
-- Fira kurum VPN'inin arkasında; telefona ne uygulama ne de VPN istemcisi kurulabiliyor.
-- Bildirimlerin dışarı çıkabildiği tek kanal Telegram. Sunucuda çalışan bot servisi
-- (services/telegram-bot) buradaki tabloları kullanır.
--
-- Chat kimliği bilerek `profiles` içine konmadı: profiles SELECT politikası şu an herkese
-- açık, chat kimliği ise kişisel veri. Ayrı tabloda, yalnızca sahibi görebiliyor.

-- ── Bağlı hesaplar ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_accounts (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id     bigint NOT NULL UNIQUE,
  username    text,
  first_name  text,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  blocked_at  timestamptz            -- kullanıcı botu engellerse doldurulur, mesaj gönderilmez
);

ALTER TABLE public.telegram_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telegram_accounts_select_own" ON public.telegram_accounts;
CREATE POLICY "telegram_accounts_select_own" ON public.telegram_accounts
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "telegram_accounts_delete_own" ON public.telegram_accounts;
CREATE POLICY "telegram_accounts_delete_own" ON public.telegram_accounts
  FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, DELETE ON public.telegram_accounts TO authenticated;

-- ── Tek kullanımlık bağlama kodları ──────────────────────────────────────────
-- Kullanıcı ayar ekranında kod üretir, bota /start <kod> yazar; servis kodu tüketip
-- chat kimliğini bağlar. Kod olmadan hiçbir chat bağlanamaz.
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  code        text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS telegram_link_codes_user_idx ON public.telegram_link_codes(user_id);

ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
-- Politika yok: kodlara yalnızca RPC'ler (SECURITY DEFINER) ve servis (service role) erişir.

-- ── Gönderim kaydı (aynı olay iki kez gitmesin) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_deliveries (
  activity_id uuid NOT NULL REFERENCES public.ticket_activity(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);
ALTER TABLE public.telegram_deliveries ENABLE ROW LEVEL SECURITY;

-- ── Servis durumu (nerede kaldım) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bot_state (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bot_state ENABLE ROW LEVEL SECURITY;

-- ── RPC: bağlama kodu üret ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.telegram_link_code()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_code text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'oturum yok';
  END IF;

  -- Kullanıcının kullanılmamış eski kodları geçersiz olsun (tek kod yeter).
  DELETE FROM public.telegram_link_codes WHERE user_id = v_user AND used_at IS NULL;

  -- Karıştırılması kolay harfler (0/O, 1/I) dışarıda.
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    INTO v_code
    FROM generate_series(1, 8);

  INSERT INTO public.telegram_link_codes (code, user_id, expires_at)
  VALUES (v_code, v_user, now() + interval '15 minutes');

  RETURN v_code;
END $$;

REVOKE ALL ON FUNCTION public.telegram_link_code() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.telegram_link_code() TO authenticated;

-- ── RPC: bağlantıyı kes ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.telegram_unlink()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'oturum yok';
  END IF;
  DELETE FROM public.telegram_accounts WHERE user_id = auth.uid();
  DELETE FROM public.telegram_link_codes WHERE user_id = auth.uid() AND used_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.telegram_unlink() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.telegram_unlink() TO authenticated;

-- ── Bildirim alıcıları (servis bunu çağırır) ─────────────────────────────────
-- Uygulama içi bildirimlerdeki kuralın aynısı, tek yerde:
--   • olayın aktörü hariç
--   • görevin atananı ya da açanı
--   • "atama" olayında yalnızca atanan kişi
-- Kanal/olay tercihi servis tarafında değerlendirilir (kullanıcı tercihleri JSON).
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
$$;

REVOKE ALL ON FUNCTION public.activity_recipients(uuid) FROM public, anon, authenticated;
