-- "Claude'a yaptır" kuyruğu: bitmiş göreve iş yapılmasın (#10BE8F38, 15 Eyl).
--
-- İki olay: (1) Kullanıcı istek kuyruktayken görevi "Tamamlandı" yaptı, istek
-- pending kaldı ve AI yine işledi. (2) Kullanıcı "İptal"e bastı, istek
-- cancelled oldu, ama AI işe başlarken durumu koşulsuz "processing" yazıp
-- iptali ezdi.
--
-- Veritabanı tarafı: görev tamamlanan/kapatılan bir duruma geçince o görevin
-- bekleyen istekleri iptal olur. İşe başlama koşulu (yalnız pending → processing)
-- köprü betiğinde (`~/.fira_ai_claim.sh`); burada ayrıca bir "cancelled'ı
-- processing'e çevirme" koruması var ki köprü unutsa bile iptal ezilemesin.

CREATE OR REPLACE FUNCTION public.ai_work_cancel_on_done()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cat text;
BEGIN
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT category INTO v_cat FROM ticket_statuses WHERE id = NEW.status_id;
    IF v_cat IN ('done', 'closed') THEN
      UPDATE ai_work_requests
         SET status = 'cancelled',
             detail = coalesce(detail, '') || CASE WHEN coalesce(detail, '') = '' THEN '' ELSE ' · ' END || 'görev tamamlandı, istek iptal edildi',
             updated_at = now()
       WHERE ticket_id = NEW.id AND status = 'pending';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tickets_ai_work_cancel_on_done ON public.tickets;
CREATE TRIGGER tickets_ai_work_cancel_on_done
  AFTER UPDATE OF status_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_cancel_on_done();

-- İptal edilmiş ya da bitmiş bir istek yeniden "processing" olamaz.
CREATE OR REPLACE FUNCTION public.ai_work_guard_transitions()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'processing' AND OLD.status IN ('cancelled', 'done', 'failed') THEN
    RAISE EXCEPTION 'İstek % durumunda, yeniden başlatılamaz', OLD.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_work_guard_transitions ON public.ai_work_requests;
CREATE TRIGGER ai_work_guard_transitions
  BEFORE UPDATE OF status ON public.ai_work_requests
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_guard_transitions();
