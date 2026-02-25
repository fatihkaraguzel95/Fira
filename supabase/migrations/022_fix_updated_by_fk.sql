-- Fix: updated_by must reference profiles(id) not auth.users(id)
-- so that PostgREST can resolve the join to the profiles table
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_updated_by_fkey;

ALTER TABLE tickets
  ADD CONSTRAINT tickets_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
