-- 056: Görevler arası bağlantı türleri
--
-- `ticket_links` bugüne kadar tek anlamlıydı ("ilişkili"). Artık türü var:
--   relates    — ilişkili (yönsüz; varsayılan, eski kayıtlar bu)
--   blocks     — A, B'yi ENGELLİYOR (yönlü; B tarafında "engelleyen: A" olarak okunur; kapatırken uyarı)
--   waits_for  — A, B'yi BEKLİYOR (yönlü, yumuşak: bilgi amaçlı, kapatmayı engellemez)
--   duplicates — kopya (yönsüz)
-- Her bağ tek kayıt; ters yön okunurken türetilir (Jira modeli). Bir çift için tek bağ (031 unique index);
-- tür değiştirmek = güncellemek. Döngü/takım dışı kuralları 031'deki trigger'da duruyor.

ALTER TABLE public.ticket_links
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'relates'
  CHECK (kind IN ('relates', 'blocks', 'waits_for', 'duplicates'));

CREATE INDEX IF NOT EXISTS ticket_links_linked_kind_idx ON public.ticket_links(linked_ticket_id, kind);

-- Aktivite günlüğü türü de yazsın (link_added / link_removed / link_kind)
CREATE OR REPLACE FUNCTION public.links_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'link_added', NULL,
      (SELECT title FROM public.tickets WHERE id = NEW.linked_ticket_id),
      jsonb_build_object('kind', NEW.kind, 'linked_id', NEW.linked_ticket_id));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      PERFORM public.log_activity(NEW.ticket_id, 'link_kind', OLD.kind, NEW.kind,
        jsonb_build_object('linked_id', NEW.linked_ticket_id, 'title', (SELECT title FROM public.tickets WHERE id = NEW.linked_ticket_id)));
    END IF;
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'link_removed',
    (SELECT title FROM public.tickets WHERE id = OLD.linked_ticket_id), NULL,
    jsonb_build_object('kind', OLD.kind, 'linked_id', OLD.linked_ticket_id));
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS links_activity ON public.ticket_links;
CREATE TRIGGER links_activity AFTER INSERT OR UPDATE OR DELETE ON public.ticket_links
  FOR EACH ROW EXECUTE FUNCTION public.links_activity();
