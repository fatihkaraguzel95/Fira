-- 055: Ağ trafiği ve istek günlüğü (Yönetim → Ağ & İstekler)
--
-- Kaynak: nginx'in Fira sanal sunucusuna özel JSON access log'u (deploy/nginx/conf.d/fira-log.conf),
-- dakikada bir çalışan toplayıcı (deploy/fira-net.sh) yeni satırları okuyup buraya yazar.
-- Disk %99 olduğu için tam istek arşivi tutulmaz:
--   • net_samples     — dakika başına özet (istek, bayt, durum dağılımı, süre) + NIC sayaçları; 30 gün
--   • request_errors  — yalnızca 429 / 5xx satırları, ayrıntılı; 7 gün
--   • request_recent  — son isteklerin halka tamponu (en çok 1000 satır) — "gelen sorgular" incelemesi
-- Tümü yalnızca sistem yöneticisi tarafından, admin_* RPC'leri üzerinden okunur; yazan cron (postgres).

CREATE TABLE IF NOT EXISTS public.net_samples (
  minute        timestamptz PRIMARY KEY,
  requests      int NOT NULL DEFAULT 0,
  bytes_in      bigint NOT NULL DEFAULT 0,
  bytes_out     bigint NOT NULL DEFAULT 0,
  s2xx          int NOT NULL DEFAULT 0,
  s3xx          int NOT NULL DEFAULT 0,
  s4xx          int NOT NULL DEFAULT 0,
  s429          int NOT NULL DEFAULT 0,
  s5xx          int NOT NULL DEFAULT 0,
  avg_ms        int,
  p95_ms        int,
  nic_rx        bigint,          -- ens33 toplam (açılıştan beri), bayt
  nic_tx        bigint,
  nic_rx_rate   bigint,          -- 2 sn örnekten bayt/sn
  nic_tx_rate   bigint,
  top_paths     jsonb            -- [{path, n}] en çok istenen 5 yol
);
ALTER TABLE public.net_samples ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.request_errors (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,
  ip          text,
  method      text,
  path        text,
  status      int NOT NULL,
  bytes_out   bigint,
  ms          int,
  ua          text,
  referer     text
);
CREATE INDEX IF NOT EXISTS request_errors_at_idx ON public.request_errors(at DESC);
ALTER TABLE public.request_errors ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.request_recent (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,
  ip          text,
  method      text,
  path        text,
  status      int NOT NULL,
  bytes_in    bigint,
  bytes_out   bigint,
  ms          int,
  ua          text
);
CREATE INDEX IF NOT EXISTS request_recent_at_idx ON public.request_recent(at DESC);
ALTER TABLE public.request_recent ENABLE ROW LEVEL SECURITY;

-- Toplayıcı her turdan sonra çağırır.
CREATE OR REPLACE FUNCTION public.net_prune() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.net_samples WHERE minute < now() - interval '30 days';
  DELETE FROM public.request_errors WHERE at < now() - interval '7 days';
  DELETE FROM public.request_recent WHERE id < (SELECT coalesce(max(id), 0) - 1000 FROM public.request_recent);
$$;
REVOKE ALL ON FUNCTION public.net_prune() FROM public, anon, authenticated;

-- ── Yönetim RPC'leri ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_net_summary() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; last_s net_samples;
BEGIN
  PERFORM public.admin_guard();
  SELECT * INTO last_s FROM net_samples ORDER BY minute DESC LIMIT 1;
  SELECT jsonb_build_object(
    'last_minute', CASE WHEN last_s.minute IS NULL THEN NULL ELSE jsonb_build_object(
        'minute', last_s.minute, 'requests', last_s.requests, 'bytes_in', last_s.bytes_in, 'bytes_out', last_s.bytes_out,
        's429', last_s.s429, 's5xx', last_s.s5xx, 'avg_ms', last_s.avg_ms, 'p95_ms', last_s.p95_ms,
        'nic_rx', last_s.nic_rx, 'nic_tx', last_s.nic_tx, 'nic_rx_rate', last_s.nic_rx_rate, 'nic_tx_rate', last_s.nic_tx_rate) END,
    'hour',  (SELECT jsonb_build_object('requests', coalesce(sum(requests),0), 'bytes_in', coalesce(sum(bytes_in),0), 'bytes_out', coalesce(sum(bytes_out),0), 's429', coalesce(sum(s429),0), 's5xx', coalesce(sum(s5xx),0))
              FROM net_samples WHERE minute >= now() - interval '1 hour'),
    'today', (SELECT jsonb_build_object('requests', coalesce(sum(requests),0), 'bytes_in', coalesce(sum(bytes_in),0), 'bytes_out', coalesce(sum(bytes_out),0), 's429', coalesce(sum(s429),0), 's5xx', coalesce(sum(s5xx),0))
              FROM net_samples WHERE minute >= date_trunc('day', now())),
    'month', (SELECT jsonb_build_object('requests', coalesce(sum(requests),0), 'bytes_in', coalesce(sum(bytes_in),0), 'bytes_out', coalesce(sum(bytes_out),0), 's429', coalesce(sum(s429),0), 's5xx', coalesce(sum(s5xx),0))
              FROM net_samples WHERE minute >= date_trunc('month', now())),
    'errors_24h', (SELECT count(*) FROM request_errors WHERE at >= now() - interval '24 hours'),
    'top_paths_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('path', path, 'n', n) ORDER BY n DESC), '[]'::jsonb) FROM (
        SELECT (e->>'path') AS path, sum((e->>'n')::int) AS n
        FROM net_samples s, jsonb_array_elements(coalesce(s.top_paths, '[]'::jsonb)) e
        WHERE s.minute >= now() - interval '1 hour' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t)
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_net_series(p_minutes int DEFAULT 60) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object('minute', minute, 'requests', requests, 'bytes_in', bytes_in, 'bytes_out', bytes_out,
                              's2xx', s2xx, 's4xx', s4xx, 's429', s429, 's5xx', s5xx, 'avg_ms', avg_ms, 'p95_ms', p95_ms,
                              'nic_rx_rate', nic_rx_rate, 'nic_tx_rate', nic_tx_rate) ORDER BY minute), '[]'::jsonb)
    INTO r FROM net_samples WHERE minute >= now() - make_interval(mins => greatest(1, least(p_minutes, 1440)));
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_request_errors(p_hours int DEFAULT 24, p_status int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('at', at, 'ip', ip, 'method', method, 'path', path, 'status', status, 'bytes_out', bytes_out, 'ms', ms, 'ua', ua) x
    FROM request_errors
    WHERE at >= now() - make_interval(hours => greatest(1, least(p_hours, 168)))
      AND (p_status IS NULL OR status = p_status)
    ORDER BY at DESC LIMIT 500) q;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_request_recent(p_limit int DEFAULT 200, p_status int DEFAULT NULL, p_q text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('at', at, 'ip', ip, 'method', method, 'path', path, 'status', status, 'bytes_in', bytes_in, 'bytes_out', bytes_out, 'ms', ms, 'ua', ua) x
    FROM request_recent
    WHERE (p_status IS NULL OR status = p_status)
      AND (p_q IS NULL OR p_q = '' OR path ILIKE '%' || p_q || '%' OR ip ILIKE '%' || p_q || '%' OR method ILIKE p_q)
    ORDER BY at DESC LIMIT greatest(1, least(p_limit, 1000))) q;
  RETURN r;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_net_summary()', 'admin_net_series(int)', 'admin_request_errors(int, int)', 'admin_request_recent(int, int, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
