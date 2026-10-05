-- 033: one task model (ClickUp-like)
--  * ticket_statuses.category (backlog | active | blocked | done | closed) + is_cancelled
--  * tickets.parent_id — a "subtask" is simply a ticket with a parent (depth ≤ 3, same list, no cycles)
--  * ticket_links — "linked ticket" rows (formerly ticket_subtasks.linked_ticket_id)
--  * data migration: ticket_subtasks → tickets (same ids), then the old table is kept as *_legacy

-- ─── 1. status categories ──────────────────────────────────────────────────
ALTER TABLE ticket_statuses
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'active'
    CHECK (category IN ('backlog', 'active', 'blocked', 'done', 'closed')),
  ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT false;

-- best-effort classification of existing statuses by name
UPDATE ticket_statuses SET category = 'closed'  WHERE lower(name) ~ '(kapat|closed|iptal|cancel)';
UPDATE ticket_statuses SET is_cancelled = true  WHERE lower(name) ~ '(iptal|cancel)';
UPDATE ticket_statuses SET category = 'done'    WHERE category = 'active' AND lower(name) ~ '(tamamlan|done|bitti|complete)';
UPDATE ticket_statuses SET category = 'backlog' WHERE category = 'active' AND lower(name) ~ '(backlog|yapılacak|yapilacak|to ?do|başlanmadı|baslanmadi)';
UPDATE ticket_statuses SET category = 'blocked' WHERE category = 'active' AND lower(name) ~ '(bloke|blocked|beklemede|engel)';
-- every list needs a closed status: promote the last "done" one, else append "Kapatıldı"
UPDATE ticket_statuses s SET category = 'closed'
WHERE s.category = 'done'
  AND NOT EXISTS (SELECT 1 FROM ticket_statuses c WHERE c.project_id = s.project_id AND c.category = 'closed')
  AND s.order_index = (SELECT max(order_index) FROM ticket_statuses d WHERE d.project_id = s.project_id AND d.category = 'done');
INSERT INTO ticket_statuses (project_id, name, color, order_index, category)
SELECT p.id, 'Kapatıldı', '#6b7280', coalesce((SELECT max(order_index) FROM ticket_statuses x WHERE x.project_id = p.id), -1) + 1, 'closed'
FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM ticket_statuses c WHERE c.project_id = p.id AND c.category = 'closed');

-- ─── 2. parent_id ───────────────────────────────────────────────────────────
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tickets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS tickets_parent_id_idx ON tickets(parent_id);

CREATE OR REPLACE FUNCTION public.check_ticket_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur UUID := NEW.parent_id;
  depth INT := 0;
  parent_project UUID;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Bir görev kendi alt görevi olamaz' USING ERRCODE = 'check_violation';
  END IF;
  SELECT project_id INTO parent_project FROM tickets WHERE id = NEW.parent_id;
  IF parent_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'Alt görev üst göreviyle aynı listede olmalı' USING ERRCODE = 'check_violation';
  END IF;
  -- walk up: no cycle, and total depth (ancestors) must stay ≤ 2 (3 levels)
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Döngü oluşur: hedef görev zaten bu görevin altında' USING ERRCODE = 'check_violation';
    END IF;
    depth := depth + 1;
    IF depth > 2 THEN
      RAISE EXCEPTION 'En fazla 3 seviye alt görev olabilir' USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_id INTO cur FROM tickets WHERE id = cur;
  END LOOP;
  -- moving a ticket that already has descendants under a deeper parent could exceed 3 levels
  IF depth = 2 AND EXISTS (SELECT 1 FROM tickets c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'Bu görevin kendi alt görevleri var; 3 seviye sınırı aşılır' USING ERRCODE = 'check_violation';
  END IF;
  IF depth = 1 AND EXISTS (SELECT 1 FROM tickets c JOIN tickets g ON g.parent_id = c.id WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'Bu görevin altında iki seviye var; 3 seviye sınırı aşılır' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tickets_check_parent ON tickets;
CREATE TRIGGER tickets_check_parent
  BEFORE INSERT OR UPDATE OF parent_id, project_id ON tickets
  FOR EACH ROW EXECUTE FUNCTION public.check_ticket_parent();

-- ─── 3. ticket_links ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  linked_ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  order_index INT NOT NULL DEFAULT 0,
  UNIQUE (ticket_id, linked_ticket_id),
  CHECK (ticket_id <> linked_ticket_id)
);
CREATE INDEX IF NOT EXISTS ticket_links_linked_idx ON ticket_links(linked_ticket_id);
ALTER TABLE ticket_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS links_select ON ticket_links;
DROP POLICY IF EXISTS links_insert ON ticket_links;
DROP POLICY IF EXISTS links_delete ON ticket_links;
CREATE POLICY links_select ON ticket_links FOR SELECT TO authenticated USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY links_insert ON ticket_links FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY links_delete ON ticket_links FOR DELETE TO authenticated USING (public.can_write_team(public.ticket_team(ticket_id)));

CREATE OR REPLACE FUNCTION public.check_ticket_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.ticket_team(NEW.linked_ticket_id) IS DISTINCT FROM public.ticket_team(NEW.ticket_id) THEN
    RAISE EXCEPTION 'Yalnızca aynı takımdaki görevler bağlanabilir' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    WITH RECURSIVE down AS (
      SELECT l.linked_ticket_id AS id, 1 AS depth FROM ticket_links l WHERE l.ticket_id = NEW.linked_ticket_id
      UNION
      SELECT l.linked_ticket_id, d.depth + 1 FROM ticket_links l JOIN down d ON l.ticket_id = d.id WHERE d.depth < 50
    ) SELECT 1 FROM down WHERE id = NEW.ticket_id
  ) THEN
    RAISE EXCEPTION 'Döngü oluşur: hedef görev zaten bu görevi (dolaylı olarak) bağlıyor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ticket_links_check ON ticket_links;
CREATE TRIGGER ticket_links_check BEFORE INSERT OR UPDATE ON ticket_links FOR EACH ROW EXECUTE FUNCTION public.check_ticket_link();

-- ─── 4. data migration: ticket_subtasks → tickets ──────────────────────────
DO $$
BEGIN
  IF to_regclass('public.ticket_subtasks') IS NOT NULL THEN
    -- plain subtasks become child tickets with the SAME id (links, image paths keep working)
    INSERT INTO tickets (id, title, description, status, status_id, project_id, parent_id, priority, due_date,
                         created_by, updated_by, created_at, updated_at, order_index)
    SELECT s.id, s.title, s.description, st.name, st.id, p.project_id, s.ticket_id,
           CASE WHEN s.priority IN ('low','medium','high','critical') THEN s.priority::ticket_priority ELSE NULL END,
           s.due_date, s.created_by, s.created_by, s.created_at, s.created_at, s.order_index
    FROM ticket_subtasks s
    JOIN tickets p ON p.id = s.ticket_id
    CROSS JOIN LATERAL (
      SELECT x.id, x.name FROM ticket_statuses x
      WHERE x.project_id = p.project_id
      ORDER BY
        CASE
          WHEN s.is_done AND x.category = 'closed' AND NOT x.is_cancelled THEN 0
          WHEN s.is_done AND x.category = 'done' THEN 1
          WHEN NOT s.is_done AND x.category = 'backlog' THEN 0
          WHEN NOT s.is_done AND x.category = 'active' THEN 1
          ELSE 9
        END,
        x.order_index
      LIMIT 1
    ) st
    WHERE s.linked_ticket_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id = s.id);

    -- linked rows become ticket_links
    INSERT INTO ticket_links (ticket_id, linked_ticket_id, created_by, created_at, order_index)
    SELECT s.ticket_id, s.linked_ticket_id, s.created_by, s.created_at, s.order_index
    FROM ticket_subtasks s WHERE s.linked_ticket_id IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- keep the old table around (read-only backup) for one release
    ALTER TABLE ticket_subtasks RENAME TO ticket_subtasks_legacy;
    BEGIN
      ALTER PUBLICATION supabase_realtime DROP TABLE ticket_subtasks_legacy;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

-- realtime for links
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'ticket_links') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_links;
  END IF;
END $$;
ALTER TABLE ticket_links REPLICA IDENTITY FULL;
