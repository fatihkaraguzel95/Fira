-- 032: avatars are stored twice — a small WebP (avatar_url, ~256px, used everywhere)
-- and a bounded "full" copy (avatar_full_url, ≤1024px) for the detail view.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_full_url TEXT;
