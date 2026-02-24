-- 014: Multiple assignees per ticket

CREATE TABLE ticket_assignees (
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, user_id)
);

CREATE INDEX ticket_assignees_ticket_idx ON ticket_assignees(ticket_id);

-- Migrate existing single assignee_id → ticket_assignees
INSERT INTO ticket_assignees (ticket_id, user_id)
SELECT id, assignee_id FROM tickets WHERE assignee_id IS NOT NULL
ON CONFLICT DO NOTHING;
