-- 031: a subtask row may point at an existing ticket ("linked subtask").
-- Cycles (A → B → … → A), self-links and cross-team links are rejected in a trigger.

ALTER TABLE ticket_subtasks
  ADD COLUMN IF NOT EXISTS linked_ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ticket_subtasks_linked_ticket_id_idx ON ticket_subtasks(linked_ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_subtasks_unique_link ON ticket_subtasks(ticket_id, linked_ticket_id)
  WHERE linked_ticket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_subtask_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.linked_ticket_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.linked_ticket_id = NEW.ticket_id THEN
    RAISE EXCEPTION 'Bir ticket kendisine bağlanamaz' USING ERRCODE = 'check_violation';
  END IF;

  IF public.ticket_team(NEW.linked_ticket_id) IS DISTINCT FROM public.ticket_team(NEW.ticket_id) THEN
    RAISE EXCEPTION 'Yalnızca aynı takımdaki ticketlar bağlanabilir' USING ERRCODE = 'check_violation';
  END IF;

  -- Cycle check: walking DOWN from the target ticket through linked subtasks must never reach the parent.
  IF EXISTS (
    WITH RECURSIVE down AS (
      SELECT s.linked_ticket_id AS id, 1 AS depth
      FROM ticket_subtasks s
      WHERE s.ticket_id = NEW.linked_ticket_id AND s.linked_ticket_id IS NOT NULL
      UNION
      SELECT s.linked_ticket_id, d.depth + 1
      FROM ticket_subtasks s JOIN down d ON s.ticket_id = d.id
      WHERE s.linked_ticket_id IS NOT NULL AND d.depth < 50
    )
    SELECT 1 FROM down WHERE id = NEW.ticket_id
  ) THEN
    RAISE EXCEPTION 'Döngü oluşur: hedef ticket zaten bu ticketı (dolaylı olarak) alt görev olarak içeriyor' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ticket_subtasks_check_link ON ticket_subtasks;
CREATE TRIGGER ticket_subtasks_check_link
  BEFORE INSERT OR UPDATE OF linked_ticket_id, ticket_id ON ticket_subtasks
  FOR EACH ROW EXECUTE FUNCTION public.check_subtask_link();
