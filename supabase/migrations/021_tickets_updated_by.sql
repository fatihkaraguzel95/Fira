-- Add updated_by column to track who last modified a ticket
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD CONSTRAINT tickets_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
