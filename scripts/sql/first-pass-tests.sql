-- İlk seferde onay (115, #fb2c5a3a) — sayım ve görünürlük testleri.
-- Çalıştırma: docker exec -i supabase-db psql -U postgres -d postgres -At < first-pass-tests.sql
-- Her şey ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur. Demo takım "Fira Tanıtım"ın bir listesi,
-- yalnız bu işlemde yaşayan hesaplar, bir ajan ve altı görev kullanılır.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

\set team    '''e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7'''
\set ticket  '''c5938b5e-70fd-4604-98dc-dfea31c98d4f'''
\set uye     '''a9e17300-0000-4000-8000-000000000011'''
\set yabanci '''a9e17300-0000-4000-8000-000000000013'''
\set ajan    '''a9e17300-0000-4000-8000-0000000000b1'''
\set ajanrow '''a9e17300-0000-4000-8000-0000000000a1'''

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
  FROM (VALUES (:uye::uuid, 'qa-fp-uye@fira.test'), (:yabanci::uuid, 'qa-fp-yab@fira.test'), (:ajan::uuid, 'qa-fp-ajan@fira.test')) v(id, mail);
INSERT INTO profiles (id, email, full_name) VALUES (:uye, 'qa-fp-uye@fira.test', 'QA Üye'), (:yabanci, 'qa-fp-yab@fira.test', 'QA Yabancı'), (:ajan, 'qa-fp-ajan@fira.test', 'QA Ajan') ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET is_ai = true WHERE id = :ajan;
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :uye, 'member'), (:team, :ajan, 'member');
INSERT INTO agents (id, profile_id, owner_id) VALUES (:ajanrow, :ajan, :uye);

-- Listenin durumları: tamamlanmış bir durum, açık bir durum ve iptal sayılan bir durum.
CREATE TEMP TABLE _s AS
SELECT (SELECT s.id FROM ticket_statuses s WHERE s.project_id = t.project_id AND s.category IN ('done', 'closed') AND NOT coalesce(s.is_cancelled, false) ORDER BY s.order_index LIMIT 1) AS done_id,
       (SELECT s.id FROM ticket_statuses s WHERE s.project_id = t.project_id AND s.category = 'active' ORDER BY s.order_index LIMIT 1) AS open_id,
       t.project_id
  FROM tickets t WHERE t.id = :ticket;
INSERT INTO ticket_statuses (id, project_id, name, color, category, is_cancelled, order_index)
SELECT 'a9e17300-0000-4000-8000-0000000000e1', project_id, 'QA İptal', '#888888', 'closed', true, 99 FROM _s;
GRANT ALL ON _s TO PUBLIC;

-- Altı görev: (1) bir kez teslim, tamamlandı · (2) iki kez teslim, tamamlandı · (3) bir kez teslim, açık ·
-- (4) bir kez teslim, iptal · (5) ilk iş başarısız, ikincisi teslim, tamamlandı · (6) yalnız iptal edilen iş
INSERT INTO tickets (id, project_id, title, status_id, created_by)
SELECT v.id::uuid, s.project_id, v.title, CASE v.st WHEN 'done' THEN s.done_id WHEN 'open' THEN s.open_id ELSE 'a9e17300-0000-4000-8000-0000000000e1' END, :uye
  FROM _s s, (VALUES
    ('a9e17300-0000-4000-8000-0000000000c1', 'QA fp 1', 'done'), ('a9e17300-0000-4000-8000-0000000000c2', 'QA fp 2', 'done'),
    ('a9e17300-0000-4000-8000-0000000000c3', 'QA fp 3', 'open'), ('a9e17300-0000-4000-8000-0000000000c4', 'QA fp 4', 'cancel'),
    ('a9e17300-0000-4000-8000-0000000000c5', 'QA fp 5', 'done'), ('a9e17300-0000-4000-8000-0000000000c6', 'QA fp 6', 'done')) v(id, title, st);
INSERT INTO ai_runs (agent_id, ticket_id, team_id, ticket_title, source, outcome, started_at, finished_at) VALUES
  (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c1', :team, 'QA fp 1', 'runner', 'done', now() - interval '2 days', now() - interval '2 days'),
  (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c2', :team, 'QA fp 2', 'runner', 'done', now() - interval '20 days', now() - interval '20 days'),
  (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c2', :team, 'QA fp 2', 'runner', 'done', now() - interval '3 days', now() - interval '3 days'),
  (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c3', :team, 'QA fp 3', 'runner', 'done', now() - interval '1 day', now() - interval '1 day'),
  (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c4', :team, 'QA fp 4', 'runner', 'done', now() - interval '1 day', now() - interval '1 day'),
  (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c5', :team, 'QA fp 5', 'runner', 'failed', now() - interval '5 days', now() - interval '5 days'),
  (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c5', :team, 'QA fp 5', 'runner', 'done', now() - interval '4 days', now() - interval '4 days'),
  (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c6', :team, 'QA fp 6', 'runner', 'cancelled', now() - interval '1 day', now() - interval '1 day'),
  (:ajanrow, NULL, :team, 'QA silinmiş görev', 'runner', 'done', now() - interval '1 day', now() - interval '1 day');

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, coalesce(actual, '(null)'), expected IS NOT DISTINCT FROM actual) $$;
-- Sonucun kısa yazımı: teslim/ilk seferde/geri dönen/incelemede/diğer
CREATE OR REPLACE FUNCTION pg_temp.fp(j jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('/', j->>'delivered', j->>'first_pass', j->>'returned', j->>'waiting', j->>'other') $$;

SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('1a ajanın bütün teslimleri: 5 görev; 2 ilk seferde (1 ve 5), 1 geri dönen (2), 1 incelemede (3), 1 iptal (4)', '5/2/1/1/1', pg_temp.fp(public.agent_first_pass(NULL, NULL, :ajanrow)));
SELECT pg_temp.chk('1b başarısız ilk deneme teslim sayılmaz: 5 numara ilk seferde onaydır', 'true', (SELECT ((public.agent_first_pass(now() - interval '6 days', now() - interval '3 days 12 hours', :ajanrow))->>'first_pass' = '1')::text));
SELECT pg_temp.chk('1c son iki günde teslim edilenler: 1, 3 ve 4', '3/1/0/1/1', pg_temp.fp(public.agent_first_pass(now() - interval '2 days 1 hour', NULL, :ajanrow)));
SELECT pg_temp.chk('1d dönemde tek teslimi olan görev, dönem dışındaki önceki teslimi yüzünden geri dönmüş sayılır', '1/0/1/0/0', pg_temp.fp(public.agent_first_pass(now() - interval '3 days 1 hour', now() - interval '2 days 12 hours', :ajanrow)));
SELECT pg_temp.chk('1e bitiş sınırı dışarıda', '0/0/0/0/0', pg_temp.fp(public.agent_first_pass(now() - interval '30 days', now() - interval '21 days', :ajanrow)));
SELECT pg_temp.chk('1f takımla süzünce aynı sayılar (bu ajanın işleri bu takımda)', 'true', (SELECT ((public.agent_first_pass(NULL, NULL, :ajanrow, :team)) = (public.agent_first_pass(NULL, NULL, :ajanrow)))::text));
SELECT pg_temp.chk('1g başka takımla süzünce boş', '0/0/0/0/0', pg_temp.fp(public.agent_first_pass(NULL, NULL, :ajanrow, 'a9e17300-0000-4000-8000-00000000ffff')));
SELECT pg_temp.chk('1h iptal edilen iş ve silinmiş görevin işi teslim sayılmaz', '5', (public.agent_first_pass(NULL, NULL, :ajanrow))->>'delivered');

-- Görev tamamlanınca incelemedeki iş ilk seferde onaya geçer; yeniden verilince geri dönmüş olur.
SELECT pg_temp.as_admin();
UPDATE tickets SET status_id = (SELECT done_id FROM _s) WHERE id = 'a9e17300-0000-4000-8000-0000000000c3';
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('2a incelemedeki görev kapanınca ilk seferde onay olur', '5/3/1/0/1', pg_temp.fp(public.agent_first_pass(NULL, NULL, :ajanrow)));
SELECT pg_temp.as_admin();
INSERT INTO ai_runs (agent_id, ticket_id, team_id, ticket_title, source, outcome, started_at, finished_at)
VALUES (:ajanrow, 'a9e17300-0000-4000-8000-0000000000c1', :team, 'QA fp 1', 'runner', 'done', now(), now());
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('2b onaylanmış görev ajana yeniden verilince geri dönmüş sayılır', '5/2/2/0/1', pg_temp.fp(public.agent_first_pass(NULL, NULL, :ajanrow)));

-- Görünürlük: takım dışındaki kişi bu işleri saymaz; anon çağıramaz.
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('3a takım dışındaki kişi için sayı sıfır', '0/0/0/0/0', pg_temp.fp(public.agent_first_pass(NULL, NULL, :ajanrow)));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('3b anon çağıramaz, giriş yapmış hesap çağırır', 'f/t', (SELECT concat_ws('/',
  has_function_privilege('anon', 'public.agent_first_pass(timestamptz, timestamptz, uuid, uuid)', 'EXECUTE'),
  has_function_privilege('authenticated', 'public.agent_first_pass(timestamptz, timestamptz, uuid, uuid)', 'EXECUTE'))));
SELECT pg_temp.chk('3c fonksiyon çağıranın yetkisiyle çalışır (SECURITY DEFINER değil)', 'false', (SELECT prosecdef::text FROM pg_proc WHERE proname = 'agent_first_pass'));

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SELECT step || ' | bekl: ' || expected || ' | gerçek: ' || actual || ' | ' || CASE WHEN ok THEN 'GEÇTİ' ELSE '*** KALDI ***' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' kontrol geçti' FROM _r;

ROLLBACK;
