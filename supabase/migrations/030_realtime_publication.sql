-- 030: publish ticket-related tables over Supabase Realtime so open boards/modals
-- refresh when another tab, user or an external tool (psql) changes data.
-- RLS still applies: clients only receive rows they are allowed to SELECT.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tickets','ticket_subtasks','ticket_comments','ticket_attachments','ticket_assignees','ticket_deadlines']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Deletes must carry the ticket_id so clients know which ticket to refresh.
ALTER TABLE ticket_subtasks    REPLICA IDENTITY FULL;
ALTER TABLE ticket_comments    REPLICA IDENTITY FULL;
ALTER TABLE ticket_attachments REPLICA IDENTITY FULL;
ALTER TABLE ticket_assignees   REPLICA IDENTITY FULL;
ALTER TABLE ticket_deadlines   REPLICA IDENTITY FULL;
