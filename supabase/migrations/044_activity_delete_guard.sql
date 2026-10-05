-- 044 — Görev silinirken günlüğe yazma denemesini engelle
--
-- 038'den beri her bağlı tablo (atama, etiket, ek, son tarih, yorum, bağlantı)
-- silinince aktivite günlüğüne satır yazıyordu. Görev silindiğinde bu satırlar
-- da CASCADE ile siliniyor, ama tetikleyiciler yine de "atama kaldırıldı" gibi
-- kayıtlar yazmaya çalışıyordu — üstelik görev satırı çoktan gitmiş olduğu için
-- yabancı anahtar hatası veriyordu:
--   insert or update on table "ticket_activity" violates foreign key constraint
--   "ticket_activity_ticket_id_fkey"  (SQLSTATE 23503)
-- Sonuç: atanan/yorumu/eki olan hiçbir görev silinemiyordu.
--
-- Çözüm tek yerde: log_activity, görev artık yoksa hiçbir şey yazmaz. Böylece
-- her çağıran (mevcut ve gelecek tetikleyiciler) korunmuş olur.
CREATE OR REPLACE FUNCTION public.log_activity(
  p_ticket uuid, p_kind text, p_from text, p_to text,
  p_meta jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT NULL, p_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ticket IS NULL THEN RETURN; END IF;
  -- Silinmekte olan bir görevin günlüğü tutulmaz: satır zaten yok olacak.
  IF NOT EXISTS (SELECT 1 FROM public.tickets WHERE id = p_ticket) THEN RETURN; END IF;
  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta, created_at)
  VALUES (p_ticket, COALESCE(p_actor, public.activity_actor()), p_kind, p_from, p_to,
          COALESCE(p_meta, '{}'::jsonb), COALESCE(p_at, now()));
END $$;
