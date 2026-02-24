-- 003: Create tickets table
CREATE TABLE tickets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  description  TEXT,
  status       ticket_status NOT NULL DEFAULT 'todo',
  priority     ticket_priority NOT NULL DEFAULT 'medium',
  assignee_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date     DATE,
  created_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  order_index  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX tickets_status_idx ON tickets(status);
CREATE INDEX tickets_assignee_idx ON tickets(assignee_id);
CREATE INDEX tickets_created_by_idx ON tickets(created_by);
