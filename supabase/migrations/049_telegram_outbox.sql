-- 049: Telegram giden kutusu
--
-- Tarayıcı Telegram'a doğrudan mesaj gönderemez (bot token'ı yalnızca sunucuda). Ayar
-- ekranındaki "Test mesajı gönder" gibi kullanıcı tetikli mesajlar için küçük bir kuyruk:
-- istemci RPC ile satır yazar, bot servisi kuyruğu boşaltır.

CREATE TABLE IF NOT EXISTS public.telegram_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  error      text
);
CREATE INDEX IF NOT EXISTS telegram_outbox_pending_idx ON public.telegram_outbox(created_at) WHERE sent_at IS NULL;

ALTER TABLE public.telegram_outbox ENABLE ROW LEVEL SECURITY;
-- Politika yok: yalnızca RPC (SECURITY DEFINER) ve servis (service role) erişir.

CREATE OR REPLACE FUNCTION public.telegram_send_test()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'oturum yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.telegram_accounts WHERE user_id = v_user AND blocked_at IS NULL) THEN
    RAISE EXCEPTION 'telegram bağlı değil';
  END IF;

  -- Aynı anda kuyruğu doldurmasın: dakikada bir test yeter.
  IF EXISTS (
    SELECT 1 FROM public.telegram_outbox
     WHERE user_id = v_user AND created_at > now() - interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'çok sık deneme';
  END IF;

  INSERT INTO public.telegram_outbox (user_id, body)
  VALUES (v_user, E'✅ <b>Test mesajı</b>\nFira bildirimlerin bu sohbete geliyor.');
END $$;

REVOKE ALL ON FUNCTION public.telegram_send_test() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.telegram_send_test() TO authenticated;
