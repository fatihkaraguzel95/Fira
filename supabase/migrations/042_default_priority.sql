-- 042 — Öncelik varsayılanı "Orta"
--
-- Önceliksiz görev, panoda "bilgi yok" anlamına geliyordu ve bayrağı hiç
-- çizilmiyordu. Artık varsayılan orta: yeni görevler (uygulamadan, içe
-- aktarmadan ya da doğrudan SQL'den) orta önceliklidir, geçmiş kayıtlar da
-- orta'ya çekildi. Arayüzde orta bayrağı panoda gösterilmez — varsayılan
-- olduğu için gürültü yapar; düşük/yüksek/kritik göze çarpsın diye.
ALTER TABLE public.tickets ALTER COLUMN priority SET DEFAULT 'medium';
UPDATE public.tickets SET priority = 'medium' WHERE priority IS NULL;
