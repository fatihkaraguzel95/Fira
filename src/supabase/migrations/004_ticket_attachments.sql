-- 004: Create ticket_attachments table
CREATE TABLE ticket_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_url     TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  uploaded_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ticket_attachments_ticket_idx ON ticket_attachments(ticket_id);
