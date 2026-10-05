-- 035: per-user preferences stored server-side (view mode, filters, last list …), forward compatible.
--  scope: 'global' | 'list:<project_id>' | (future) 'team:<team_id>'
--  merge_user_prefs(scope, patch): prefs = prefs || patch, nested objects (e.g. "filters") are merged key by key,
--  null values delete keys. A client running an OLDER app version therefore never wipes keys it does not know.

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prefs_select ON user_preferences;
DROP POLICY IF EXISTS prefs_insert ON user_preferences;
DROP POLICY IF EXISTS prefs_update ON user_preferences;
DROP POLICY IF EXISTS prefs_delete ON user_preferences;
CREATE POLICY prefs_select ON user_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY prefs_insert ON user_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY prefs_update ON user_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY prefs_delete ON user_preferences FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Deep-ish merge: one level of nested objects is merged key by key; nulls remove keys at both levels.
CREATE OR REPLACE FUNCTION public.merge_user_prefs(p_scope TEXT, p_patch JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  cur JSONB;
  merged JSONB;
  k TEXT;
  v JSONB;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Oturum yok'; END IF;
  IF p_scope IS NULL OR length(p_scope) > 120 THEN RAISE EXCEPTION 'Geçersiz scope'; END IF;
  SELECT prefs INTO cur FROM user_preferences WHERE user_id = me AND scope = p_scope;
  merged := coalesce(cur, '{}'::jsonb);
  FOR k, v IN SELECT * FROM jsonb_each(coalesce(p_patch, '{}'::jsonb)) LOOP
    IF jsonb_typeof(v) = 'object' AND jsonb_typeof(merged->k) = 'object' THEN
      merged := jsonb_set(merged, ARRAY[k], jsonb_strip_nulls((merged->k) || v));
    ELSIF jsonb_typeof(v) = 'null' THEN
      merged := merged - k;
    ELSE
      merged := jsonb_set(merged, ARRAY[k], CASE WHEN jsonb_typeof(v) = 'object' THEN jsonb_strip_nulls(v) ELSE v END);
    END IF;
  END LOOP;
  INSERT INTO user_preferences (user_id, scope, prefs, updated_at) VALUES (me, p_scope, merged, now())
  ON CONFLICT (user_id, scope) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now();
  RETURN merged;
END $$;
GRANT EXECUTE ON FUNCTION public.merge_user_prefs(TEXT, JSONB) TO authenticated;
