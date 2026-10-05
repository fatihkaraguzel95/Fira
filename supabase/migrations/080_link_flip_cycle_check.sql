-- 080: Bağ yönü değiştirilebilsin (#9a68d017, v0.36.4)
-- check_ticket_link döngü kontrolü UPDATE'te güncellenen satırın ESKİ hâlini de
-- geziyordu: "A engelliyor B" satırını "B engelliyor A" yapmak, A→B hâlâ tabloda
-- göründüğü için "Döngü oluşur" ile reddediliyordu. Kontrol artık güncellenen
-- satırı (NEW.id) dışarıda bırakır. Yalnız fonksiyon gövdesi değişir; şema aynı.
CREATE OR REPLACE FUNCTION public.check_ticket_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.ticket_team(NEW.linked_ticket_id) IS DISTINCT FROM public.ticket_team(NEW.ticket_id) THEN
    RAISE EXCEPTION 'Yalnızca aynı takımdaki görevler bağlanabilir' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.ticket_id = NEW.linked_ticket_id THEN
    RAISE EXCEPTION 'Görev kendisine bağlanamaz' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    WITH RECURSIVE down AS (
      SELECT l.linked_ticket_id AS id, 1 AS depth FROM ticket_links l
       WHERE l.ticket_id = NEW.linked_ticket_id AND (TG_OP <> 'UPDATE' OR l.id <> NEW.id)
      UNION
      SELECT l.linked_ticket_id, d.depth + 1 FROM ticket_links l JOIN down d ON l.ticket_id = d.id
       WHERE d.depth < 50 AND (TG_OP <> 'UPDATE' OR l.id <> NEW.id)
    ) SELECT 1 FROM down WHERE id = NEW.ticket_id
  ) THEN
    RAISE EXCEPTION 'Döngü oluşur: hedef görev zaten bu görevi (dolaylı olarak) bağlıyor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
