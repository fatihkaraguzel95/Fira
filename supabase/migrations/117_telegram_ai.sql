-- 117: Telegram'da yapay zekâ ile görev açma
--
-- Kullanıcı bota serbest yazıyor ("uygulama açılışta donuyor, dün de olmuştu…"),
-- birkaç mesaj gidip geliyor, sonunda model konuşmayı düzgün bir görev kartına
-- çeviriyor; kullanıcı onaylayınca görev açılıyor.
--
-- Konuşma burada duruyor çünkü Messages API durumsuz: her çağrıda geçmişin tamamı
-- gönderilir. Bellekte tutulsaydı servis yeniden başladığında konuşma kaybolurdu.
-- Satırlara yalnızca bot servisi (service role) erişir, o yüzden politika yok.

CREATE TABLE IF NOT EXISTS public.telegram_ai (
  chat_id     bigint PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Anthropic Messages API biçiminde tam geçmiş: [{role, content}, …]
  messages    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Modelin son önerisi: {title, description, priority}. Onay düğmesi bunu yazar.
  proposal    jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_ai_stale_idx ON public.telegram_ai(updated_at);

ALTER TABLE public.telegram_ai ENABLE ROW LEVEL SECURITY;

-- Hedef: görevler hangi projenin hangi sütununa açılacak (ör. "Beklemede").
-- Proje 116'da eklendi; sütun bilgisi burada.
ALTER TABLE public.telegram_accounts
  ADD COLUMN IF NOT EXISTS default_status_id uuid REFERENCES public.ticket_statuses(id) ON DELETE SET NULL;
