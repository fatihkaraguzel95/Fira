-- 026: Ticket archiving (the app already filters/updates tickets.archived_at;
-- this column was never added by a migration, which breaks the list view with
-- "column tickets.archived_at does not exist").
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS tickets_archived_at_idx ON tickets(archived_at) WHERE archived_at IS NULL;
