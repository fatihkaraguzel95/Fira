-- 063: Panonun taşıdığı yükü küçült (#B98717D4)
--
-- Kart, açıklamanın *içeriğini* değil yalnızca var olup olmadığını gösteriyor
-- (küçük bir simge). Buna rağmen liste sorgusu bütün açıklamaları indiriyordu:
-- 200 görevlik bir listede 78 kB, yani yükün altıda biri, hiç render edilmeyen
-- metin. Üretilmiş sütun bunu tek bir boolean'a indiriyor ve her zaman satırla
-- birlikte tutarlı kalıyor — istemcinin ayrıca hesaplaması gereken bir şey yok.
--
-- STORED çünkü PostgREST yalnızca gerçek sütunları seçebilir; maliyeti satır
-- başına bir bit ve yazma anında bir karşılaştırma.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS has_description boolean
  GENERATED ALWAYS AS (description IS NOT NULL AND btrim(description) <> '') STORED;

COMMENT ON COLUMN public.tickets.has_description IS
  'Kart göstergesi için: açıklama dolu mu? Liste sorgusu description yerine bunu çeker (063).';
