-- 043 — Listeye özel arkaplan
--
-- Takım sahibi/yöneticisi bir listeye arkaplan resmi atayabilir (ticket #E20D94).
-- Resim dosyası storage'a yüklenir, burada yalnızca adresi ve (yüklenen bir
-- dosyaysa) kaynak notu tutulur. Yazma yetkisi zaten projects_update ile
-- is_team_admin'e bağlı; ayrı bir politika gerekmiyor.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS background_url text,
  ADD COLUMN IF NOT EXISTS background_credit text;
