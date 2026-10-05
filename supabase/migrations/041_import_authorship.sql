-- 041 — İçe aktarılan görevin gerçek sahibi
--
-- İçe aktarma, görevleri aktarmayı yapan kişinin adına oluşturuyordu: görev
-- penceresinde "Oluşturan" olarak Planner'daki kişi değil, aktarmayı yapan
-- görünüyordu (ticket #BEE700 devamı). Görevi asıl oluşturan kişi artık
-- `tickets.created_by` alanında; "bu kaydı kim aktardı" bilgisi ise aktivite
-- günlüğüne `imported` satırı olarak yazılıyor, yani ikisi de kayboluyor değil.
--
-- Not: tickets_insert politikası `created_by = auth.uid()` şartını koşuyor (ve
-- koşmaya devam etmeli), bu yüzden sahiplik ekleme sırasında değil, bu RPC ile
-- sonradan atanıyor.

CREATE OR REPLACE FUNCTION public.set_import_author(
  p_ticket uuid, p_creator uuid, p_source text DEFAULT NULL, p_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  importer uuid := public.activity_actor();
BEGIN
  IF p_ticket IS NULL THEN RETURN; END IF;
  IF NOT public.can_write_team(public.ticket_team(p_ticket)) THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;

  -- "Bu görev buraya bir aktarmayla geldi" — aktaran kişi kayıtta kalsın.
  IF NOT EXISTS (SELECT 1 FROM public.ticket_activity WHERE ticket_id = p_ticket AND kind = 'imported') THEN
    INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, to_value, meta, created_at)
    VALUES (p_ticket, importer, 'imported', p_source, jsonb_build_object('imported', true), COALESCE(p_at, now()));
  END IF;

  IF p_creator IS NOT NULL THEN
    UPDATE public.tickets SET created_by = p_creator WHERE id = p_ticket;
    UPDATE public.ticket_activity SET actor_id = p_creator
    WHERE ticket_id = p_ticket AND kind = 'created';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_import_author(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_import_author(uuid, uuid, text, timestamptz) TO authenticated;
