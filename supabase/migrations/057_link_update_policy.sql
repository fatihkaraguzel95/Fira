-- 057: Bağlantı türü değiştirilebilsin
-- ticket_links için UPDATE politikası yoktu (yalnızca ekle/sil). Tür (kind) satırdan
-- değiştirildiği için yazma yetkili üye güncelleyebilmeli; ekleme kuralıyla aynı kapsam.
DROP POLICY IF EXISTS links_update ON public.ticket_links;
CREATE POLICY links_update ON public.ticket_links
  FOR UPDATE TO authenticated
  USING (public.can_write_team(public.ticket_team(ticket_id)))
  WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
