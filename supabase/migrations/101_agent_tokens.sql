-- 101: Agent keys (#f8016a5f; phase 1 of the Claude–Fira integration, #a5b096a1).
--
-- Until now the agent's listener reached Fira over SSH and psql as the database
-- superuser: outside RLS, and tied to one person's machine. An agent key
-- replaces that. The owner creates a key in Ayarlar › Claude'um, the key is
-- shown once, and the listener trades it for a short-lived session as the
-- agent's own account — so everything it does goes through PostgREST and RLS
-- like any other member, and a key can be revoked without touching the account.
--
-- Additive only: new table and functions.

CREATE TABLE IF NOT EXISTS public.agent_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,          -- sha256 of the key; the key itself is never stored
  prefix       TEXT NOT NULL,                 -- its first characters, to tell keys apart in the list
  label        TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_tokens_agent_idx ON public.agent_tokens(agent_id);

-- Nobody reads or writes the table directly: RLS on, no policy, no grant.
-- The functions below are the only way in.
ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_tokens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_key_hash(p_key text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
$$;
REVOKE ALL ON FUNCTION public.agent_key_hash(text) FROM public, anon, authenticated;

-- Whether the caller may manage this agent's keys: its owner or a system admin.
CREATE OR REPLACE FUNCTION public.agent_can_manage(p_agent uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_system_admin()
      OR EXISTS (SELECT 1 FROM public.agents a WHERE a.id = p_agent AND a.owner_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.agent_can_manage(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_can_manage(uuid) TO authenticated;

-- A new key. Returned once, in the clear; only its hash is kept.
CREATE OR REPLACE FUNCTION public.agent_create_token(p_agent uuid, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_id  uuid;
BEGIN
  IF NOT public.agent_can_manage(p_agent) THEN
    RAISE EXCEPTION 'Ajanın anahtarlarını yalnız sahibi yönetebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT count(*) FROM public.agent_tokens WHERE agent_id = p_agent AND revoked_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'En fazla beş etkin anahtar olabilir; önce kullanılmayanı iptal et' USING ERRCODE = 'check_violation';
  END IF;
  v_key := 'fira_agt_' || encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.agent_tokens (agent_id, token_hash, prefix, label, created_by)
  VALUES (p_agent, public.agent_key_hash(v_key), left(v_key, 13), nullif(btrim(coalesce(p_label, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'key', v_key, 'prefix', left(v_key, 13));
END $$;
REVOKE ALL ON FUNCTION public.agent_create_token(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_create_token(uuid, text) TO authenticated;

-- The keys of an agent, without anything that could be used to sign in.
CREATE OR REPLACE FUNCTION public.agent_list_tokens(p_agent uuid)
RETURNS TABLE (id uuid, prefix text, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.agent_can_manage(p_agent) THEN
    RAISE EXCEPTION 'Ajanın anahtarlarını yalnız sahibi yönetebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT t.id, t.prefix, t.label, t.created_at, t.last_used_at, t.revoked_at
      FROM public.agent_tokens t
     WHERE t.agent_id = p_agent
     ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.agent_list_tokens(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_list_tokens(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.agent_revoke_token(p_token uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agent uuid;
BEGIN
  SELECT agent_id INTO v_agent FROM public.agent_tokens WHERE id = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anahtar bulunamadı' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT public.agent_can_manage(v_agent) THEN
    RAISE EXCEPTION 'Ajanın anahtarlarını yalnız sahibi yönetebilir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.agent_tokens SET revoked_at = now() WHERE id = p_token AND revoked_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.agent_revoke_token(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agent_revoke_token(uuid) TO authenticated;

-- Key → session. The one function here that an anonymous caller may run: the
-- listener has nothing but its key. It answers with a short session signed for
-- the AGENT'S OWN account and nothing else — the subject comes from the key's
-- agent row, never from the caller, and only an account marked is_ai can be
-- signed for. A wrong, revoked or orphaned key gets the same refusal.
--
-- The session lasts 15 minutes and cannot be renewed without the key, so
-- revoking a key shuts out a running listener within that time.
CREATE OR REPLACE FUNCTION public.agent_session(p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token  public.agent_tokens;
  v_agent  public.agents;
  v_secret text := current_setting('app.settings.jwt_secret', true);
  v_now    bigint := extract(epoch FROM now())::bigint;
  v_ttl    constant int := 900;
BEGIN
  IF p_key IS NULL OR p_key !~ '^fira_agt_[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Anahtar geçersiz' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  SELECT * INTO v_token FROM public.agent_tokens WHERE token_hash = public.agent_key_hash(p_key) AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anahtar geçersiz' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  SELECT a.* INTO v_agent
    FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.id = v_token.agent_id AND p.is_ai;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anahtar geçersiz' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Sunucuda oturum imzası ayarlı değil' USING ERRCODE = 'config_file_error';
  END IF;

  -- "Last used" is for the owner's eyes; once a minute is plenty.
  UPDATE public.agent_tokens SET last_used_at = now()
   WHERE id = v_token.id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

  RETURN jsonb_build_object(
    'access_token', extensions.sign(
      json_build_object(
        'role', 'authenticated', 'aud', 'authenticated', 'iss', 'fira-agent',
        'sub', v_agent.profile_id, 'agent_id', v_agent.id, 'key_id', v_token.id,
        'iat', v_now, 'exp', v_now + v_ttl),
      v_secret),
    'token_type', 'bearer',
    'expires_in', v_ttl,
    'expires_at', v_now + v_ttl,
    'user_id', v_agent.profile_id,
    'agent_id', v_agent.id,
    'assign_trigger', v_agent.assign_trigger,
    'poll_seconds', v_agent.poll_seconds);
END $$;
REVOKE ALL ON FUNCTION public.agent_session(text) FROM public;
GRANT EXECUTE ON FUNCTION public.agent_session(text) TO anon, authenticated;
