-- 027: Priority is optional. New tickets/subtasks start with no priority; the
-- user can also clear a previously chosen one. Existing rows keep their value.
ALTER TABLE tickets ALTER COLUMN priority DROP NOT NULL;
ALTER TABLE tickets ALTER COLUMN priority DROP DEFAULT;

ALTER TABLE ticket_subtasks ALTER COLUMN priority DROP NOT NULL;
ALTER TABLE ticket_subtasks ALTER COLUMN priority DROP DEFAULT;
