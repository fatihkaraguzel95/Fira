-- 015: Alter tickets table for project + custom status + multi-assignee

-- Add project_id (nullable: existing tickets have no project)
ALTER TABLE tickets ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Add status_id (nullable: existing tickets use status text)
ALTER TABLE tickets ADD COLUMN status_id UUID REFERENCES ticket_statuses(id) ON DELETE SET NULL;

-- Change status from enum to text (keep existing values like 'todo', 'in_progress'…)
-- First drop the default (it references the enum), then alter, then restore default, then drop enum
ALTER TABLE tickets ALTER COLUMN status DROP DEFAULT;
ALTER TABLE tickets ALTER COLUMN status TYPE TEXT;
ALTER TABLE tickets ALTER COLUMN status SET DEFAULT 'todo';
DROP TYPE IF EXISTS ticket_status;

-- priority stays as-is (still uses ticket_priority enum for now)
-- assignee_id stays for backward compat (already migrated to ticket_assignees)

CREATE INDEX tickets_project_idx ON tickets(project_id);
CREATE INDEX tickets_status_id_idx ON tickets(status_id);
