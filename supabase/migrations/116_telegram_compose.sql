-- 116: Telegram'dan görev açma
--
-- Bot sohbeti adım adım ilerliyor (proje → başlık → açıklama → öncelik → onay), ama
-- servis durumsuz bir döngü: "hangi adımdaydık" bilgisi burada duruyor. Bellekte
-- tutulsaydı servis her yeniden başlatmada kullanıcının yarım kalan görevini yutardı.
--
-- Satırlara yalnızca bot servisi (service role) erişir, o yüzden politika yok. Taslak
-- kişisel veri sayılır; tarayıcıya hiç açılmıyor.

-- Her görevde proje sormamak için: kullanıcının varsayılan projesi.
ALTER TABLE public.telegram_accounts
  ADD COLUMN IF NOT EXISTS default_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.telegram_compose (
  chat_id     bigint PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  step        text NOT NULL,          -- offer | project | title | description | priority | confirm
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  title       text,
  description text,
  priority    text,                   -- ticket_priority değeri ya da NULL ("öncelik yok")
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Yarım kalmış taslakları süpürmek için (servis 2 saatten eskisini yok sayar).
CREATE INDEX IF NOT EXISTS telegram_compose_stale_idx ON public.telegram_compose(updated_at);

ALTER TABLE public.telegram_compose ENABLE ROW LEVEL SECURITY;
