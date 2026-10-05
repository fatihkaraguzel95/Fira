-- 065: Takım oluşturma yeniden çalışıyor (#37CDA00D)
--
-- Belirti: "Yeni Takım Oluştur" → "new row violates row-level security policy
-- for table teams".
--
-- Kök neden: 028, team_members'taki doğrudan INSERT politikalarını kaldırdı
-- ("katılım SECURITY DEFINER RPC'lerden geçer"). Ama takımı açanı sahip yapan
-- add_team_owner bir RPC değil, 010'dan kalma, SECURITY DEFINER olmayan bir
-- tetikleyici: çağıranın yetkisiyle çalışıyor ve artık team_members'a yazamıyor.
-- Mevcut takımlar 028'den önce açılmıştı; o günden beri yeni takım açılamıyordu.
--
-- Düzeltme: tetikleyici tanımlayanın yetkisiyle çalışır. Güvenli, çünkü yalnız
-- eklenen takımın created_by'ını sahip yapıyor ve teams_insert zaten
-- created_by = auth.uid() şartını koşuyor — kimse başkası adına sahip olamaz.
--
-- İstemci tarafı (useCreateTeam) ayrıca düzeltildi: INSERT … RETURNING, SELECT
-- politikasını (team_role(id) IS NOT NULL) satır eklenirken kontrol eder; o an
-- AFTER tetikleyicisi henüz üyeliği yazmamıştır. İstemci id'yi kendisi üretip
-- RETURNING'siz ekliyor, sonra satırı ayrıca okuyor.

CREATE OR REPLACE FUNCTION public.add_team_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO team_members (team_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.add_team_owner() FROM public, anon, authenticated;
