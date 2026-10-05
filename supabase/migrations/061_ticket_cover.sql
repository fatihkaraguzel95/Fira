-- 061: Optional card cover image (#f76cb1df)
--
-- A task can nominate ONE of its own image attachments as a cover, which the
-- kanban card then shows as a header. Opt-in per task ("istenirse"): no cover
-- unless somebody picks one, so boards don't suddenly grow pictures.
--
-- The url is denormalised on purpose: the board renders hundreds of cards and
-- should not join ticket_attachments for each one. A trigger keeps it honest —
-- deleting the attachment clears the cover that pointed at it.

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS cover_url text;

CREATE OR REPLACE FUNCTION public.clear_ticket_cover()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tickets
     SET cover_url = NULL
   WHERE id = OLD.ticket_id AND cover_url = OLD.file_url;
  RETURN OLD;
END $$;

REVOKE ALL ON FUNCTION public.clear_ticket_cover() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS ticket_attachments_clear_cover ON public.ticket_attachments;
CREATE TRIGGER ticket_attachments_clear_cover
  AFTER DELETE ON public.ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION public.clear_ticket_cover();
