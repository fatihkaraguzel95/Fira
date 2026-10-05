-- 092: yorum düzenleme (#5d077b0e)
--
-- Yorum yazıldıktan sonra düzeltilemiyordu; RLS zaten yazarına UPDATE izni
-- veriyordu (028 `comments_update`), eksik olan iki şey vardı:
--   1) düzenlendiğini gösterecek bir damga,
--   2) düzenlemeyle EKLENEN @bahsetmelerin bildirilmesi — tetikleyici yalnız
--      INSERT ve DELETE'te çalışıyordu, yani sonradan anılan kişi haberdar
--      olmuyordu (CLAUDE.md: bahsetme üreten her metin yolu log_mentions'ı
--      çağırmalı).
-- Düzenlemenin kendisi aktiviteye yazılmaz: gelen kutusu aynı yorum için
-- ikinci bir satır görmesin; okunan metin zaten yorumun kendisi.

ALTER TABLE public.ticket_comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.comments_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'comment_added', NULL, left(NEW.content, 120), '{}'::jsonb, NEW.author_id);
    PERFORM public.log_mentions(NEW.ticket_id, NEW.content, NULL, jsonb_build_object('comment_id', NEW.id), NEW.author_id);
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Yalnız yeni eklenen bahsetmeler: log_mentions eski metni de alıp farkı buluyor.
    IF NEW.content IS DISTINCT FROM OLD.content THEN
      PERFORM public.log_mentions(NEW.ticket_id, NEW.content, OLD.content, jsonb_build_object('comment_id', NEW.id), NEW.author_id);
    END IF;
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'comment_removed', left(OLD.content, 120), NULL, '{}'::jsonb);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS comments_activity ON public.ticket_comments;
CREATE TRIGGER comments_activity AFTER INSERT OR UPDATE OF content OR DELETE ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_activity();
