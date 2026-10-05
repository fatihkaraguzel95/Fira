-- Ajan kimliği ve atama tetikleyicisi (100, #cb43ae36) — RLS, tetikleyici ve ayar testleri.
-- Çalıştırma: docker exec -i supabase-db psql -U postgres -d postgres -At < agent-tests.sql
-- Her şey ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur. Demo takım "Fira Tanıtım",
-- onun bir görevi ve yalnız bu işlemde yaşayan bir deneme ajanı kullanılır.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

\set team   '''e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7'''
\set ticket '''c5938b5e-70fd-4604-98dc-dfea31c98d4f'''
\set uye    '''a9e17000-0000-4000-8000-000000000001'''
\set yabanci '''a9e17000-0000-4000-8000-000000000003'''
\set ajan   '''a9e17000-0000-4000-8000-0000000000a1'''
\set agent  '''a9e17000-0000-4000-8000-0000000000aa'''

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES (:uye,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-ag-uye@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
       (:yabanci,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-ag-yabanci@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
       (:ajan,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-ag-ajan@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}');
INSERT INTO profiles (id, email, full_name) VALUES
  (:uye,'qa-ag-uye@fira.test','QA Üye'),
  (:yabanci,'qa-ag-yabanci@fira.test','QA Yabancı'),
  (:ajan,'qa-ag-ajan@fira.test','QA Ajan')
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET is_ai = true WHERE id = :ajan;
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :uye, 'member'), (:team, :ajan, 'member');
INSERT INTO agents (id, profile_id, owner_id) VALUES (:agent, :ajan, :uye);
-- Görevde açık istek kalmasın (deneme temiz başlasın).
UPDATE ai_work_requests SET status = 'cancelled' WHERE ticket_id = :ticket AND status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid, path text DEFAULT '/ticket_assignees') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.path', path, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.path', '', true); END $$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN 'hata'; END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, coalesce(actual, '(null)'), expected IS NOT DISTINCT FROM actual) $$;
-- Görevin açık isteği: "durum/kaynak" ya da "-"
CREATE OR REPLACE FUNCTION pg_temp.open_req(tk uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce((SELECT string_agg(status || '/' || source, ',' ORDER BY created_at) FROM public.ai_work_requests WHERE ticket_id = tk AND status IN ('pending', 'processing')), '-') $$;
CREATE OR REPLACE FUNCTION pg_temp.assign(tk uuid, u uuid) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.try(format('INSERT INTO public.ticket_assignees (ticket_id, user_id) VALUES (%L, %L)', tk, u)) $$;
CREATE OR REPLACE FUNCTION pg_temp.unassign(tk uuid, u uuid) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.try(format('DELETE FROM public.ticket_assignees WHERE ticket_id = %L AND user_id = %L', tk, u)) $$;

-- 1) Kurulum: mevcut yapay zekâ hesabı ajan oldu
SELECT pg_temp.chk('1a her is_ai hesabın ajan satırı var', '0',
  (SELECT count(*)::text FROM profiles p WHERE p.is_ai AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.profile_id = p.id)));

-- 2) Atama işi başlatır
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('2a üye ajanı atar', 'ok', pg_temp.assign(:ticket, :ajan));
SELECT pg_temp.chk('2b kuyruğa istek düşer', 'pending/assign', pg_temp.open_req(:ticket));
SELECT pg_temp.chk('2c isteyen atayan kişi', (:uye)::text,
  (SELECT requested_by::text FROM ai_work_requests WHERE ticket_id = :ticket AND status = 'pending'));

-- 3) Ajanın kendi atamasını bırakması iptal değildir; başkasının kaldırması iptaldir
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.unassign(:ticket, :ajan);
SELECT pg_temp.chk('3a ajan kendini çıkarınca istek sürer', 'pending/assign', pg_temp.open_req(:ticket));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.assign(:ticket, :ajan);
SELECT pg_temp.chk('3b açık istek varken ikinci istek açılmaz', 'pending/assign', pg_temp.open_req(:ticket));
SELECT pg_temp.unassign(:ticket, :ajan);
SELECT pg_temp.chk('3c atama kalkınca bekleyen istek iptal', '-', pg_temp.open_req(:ticket));
SELECT pg_temp.chk('3d iptal nedeni ve bitiş zamanı yazılır', 'true/true',
  (SELECT (detail LIKE '%atama kaldırıldı%')::text || '/' || (finished_at IS NOT NULL)::text
     FROM ai_work_requests WHERE ticket_id = :ticket AND source = 'assign' ORDER BY created_at DESC LIMIT 1));

-- 4) Süren iş de kapanır
SELECT pg_temp.assign(:ticket, :ajan);
SELECT pg_temp.as_user(:ajan);
UPDATE ai_work_requests SET status = 'processing' WHERE ticket_id = :ticket AND status = 'pending';
SELECT pg_temp.chk('4a üstlenme zamanı yazılır', 'processing/assign/true',
  (SELECT pg_temp.open_req(:ticket) || '/' || (claimed_at IS NOT NULL)::text FROM ai_work_requests WHERE ticket_id = :ticket AND status = 'processing'));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.unassign(:ticket, :ajan);
SELECT pg_temp.chk('4b atama kalkınca süren iş iptal', '-', pg_temp.open_req(:ticket));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('4c iptal edilen iş yeniden başlatılamaz', 'hata',
  pg_temp.try(format('UPDATE public.ai_work_requests SET status = ''processing'' WHERE id = %L',
    (SELECT id FROM ai_work_requests WHERE ticket_id = :ticket ORDER BY created_at DESC LIMIT 1))));

-- 5) Ayarlar: yalnız sahibi, sınırlar içinde
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('5a yabancı ajanı görmez', '0', (SELECT count(*)::text FROM agents WHERE id = :agent));
SELECT pg_temp.chk('5b yabancı ayar değiştiremez', 'hata', pg_temp.try(format('SELECT public.agent_update_settings(%L, ''{"assign_trigger": false}'')', :agent)));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('5c takım üyesi ajanı görür', '1', (SELECT count(*)::text FROM agents WHERE id = :agent));
SELECT pg_temp.try(format('UPDATE public.agents SET poll_seconds = 31 WHERE id = %L', :agent));
SELECT pg_temp.chk('5d tabloya doğrudan yazılamaz', '300', (SELECT poll_seconds::text FROM agents WHERE id = :agent));
SELECT public.agent_update_settings(:agent, '{"assign_trigger": false, "poll_seconds": 5, "settings": {"lang": "tr"}}');
SELECT pg_temp.chk('5e sahibi değiştirir, aralık sınırlanır', 'false/30/tr',
  (SELECT assign_trigger::text || '/' || poll_seconds || '/' || (settings ->> 'lang') FROM agents WHERE id = :agent));
SELECT pg_temp.assign(:ticket, :ajan);
SELECT pg_temp.chk('5f anahtar kapalıyken atama iş başlatmaz', '-', pg_temp.open_req(:ticket));
SELECT pg_temp.unassign(:ticket, :ajan);
SELECT public.agent_update_settings(:agent, '{"poll_seconds": 120}');
SELECT public.agent_update_settings(:agent, '{"assign_trigger": true}');
SELECT pg_temp.chk('5h tek alan değişince ötekiler yerinde kalır', 'true/120/tr',
  (SELECT assign_trigger::text || '/' || poll_seconds || '/' || (settings ->> 'lang') FROM agents WHERE id = :agent));
SELECT public.agent_update_settings(:agent, '{"poll_seconds": 30}');
SELECT pg_temp.chk('5g sahip atayamaz (yalnız sistem yöneticisi)', 'hata', pg_temp.try(format('SELECT public.agent_set_owner(%L, %L)', :agent, :yabanci)));

-- 6) İş başlatmayan atamalar
SELECT pg_temp.as_user(:uye, '/rpc/copy_ticket');
SELECT pg_temp.assign(:ticket, :ajan);
SELECT pg_temp.chk('6a fonksiyon içinden atama (kopya, taşıma) iş başlatmaz', '-', pg_temp.open_req(:ticket));
SELECT pg_temp.unassign(:ticket, :ajan);
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.assign(:ticket, :ajan);
SELECT pg_temp.chk('6b ajan kendini atayınca iş başlamaz', '-', pg_temp.open_req(:ticket));
SELECT pg_temp.unassign(:ticket, :ajan);
SELECT pg_temp.as_admin();
UPDATE tickets t SET status_id = (SELECT s.id FROM ticket_statuses s WHERE s.project_id = t.project_id AND s.category = 'done' ORDER BY s.order_index LIMIT 1)
 WHERE t.id = :ticket;
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.assign(:ticket, :ajan);
SELECT pg_temp.chk('6c tamamlanmış göreve atama iş başlatmaz', '-', pg_temp.open_req(:ticket));
SELECT pg_temp.unassign(:ticket, :ajan);
SELECT pg_temp.as_admin();
UPDATE tickets t SET status_id = (SELECT s.id FROM ticket_statuses s WHERE s.project_id = t.project_id AND s.category IN ('backlog', 'active') ORDER BY s.order_index LIMIT 1)
 WHERE t.id = :ticket;

-- 7) Düğme önce istek yazar, sonra atar: tek istek, kaynağı düğme
SELECT pg_temp.as_user(:uye);
INSERT INTO ai_work_requests (ticket_id, requested_by, ai_user_id, status) VALUES (:ticket, :uye, :ajan, 'pending');
SELECT pg_temp.assign(:ticket, :ajan);
SELECT pg_temp.chk('7a düğme + atama tek istek', 'pending/button', pg_temp.open_req(:ticket));
SELECT pg_temp.chk('7b açık isteği olan görev silinebilir', 'ok', pg_temp.try(format('DELETE FROM public.tickets WHERE id = %L', :ticket)));

-- 8) Ajan "buradayım" der ve ayarlarını okur
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('8a ajan ayarlarını okur', '30', public.agent_seen('{"host": "qa"}'::jsonb) ->> 'poll_seconds');
SELECT pg_temp.chk('8c görülme zamanı ve çalıştığı yer yazılır', 'true/qa',
  (SELECT (last_seen_at IS NOT NULL)::text || '/' || (runner ->> 'host') FROM agents WHERE id = :agent));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('8b ajan olmayan hesap görüldü diyemez', 'hata', pg_temp.try('SELECT public.agent_seen()'));

-- 9) Ajan anahtarı (101): yalnız sahibi üretir, anahtar yalnız ajanın kendi hesabı için oturum açar
CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('role', 'anon', true); END $$;
CREATE TEMP TABLE _k (name text PRIMARY KEY, val text);
GRANT ALL ON _k TO PUBLIC;

SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('9a yabancı anahtar üretemez', 'hata', pg_temp.try(format('SELECT public.agent_create_token(%L, ''x'')', :agent)));
SELECT pg_temp.chk('9b yabancı anahtarları listeleyemez', 'hata', pg_temp.try(format('SELECT * FROM public.agent_list_tokens(%L)', :agent)));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('9c ajan kendine anahtar üretemez', 'hata', pg_temp.try(format('SELECT public.agent_create_token(%L, ''x'')', :agent)));
SELECT pg_temp.as_user(:uye);
INSERT INTO _k SELECT 'key', public.agent_create_token(:agent, '  dizüstü  ') ->> 'key';
SELECT pg_temp.chk('9d sahibi üretir, anahtar biçimi', 'true', ((SELECT val FROM _k WHERE name = 'key') ~ '^fira_agt_[0-9a-f]{64}$')::text);
SELECT pg_temp.chk('9e listede etiket ve ön ek var', 'dizüstü/true',
  (SELECT label || '/' || (prefix = left((SELECT val FROM _k WHERE name = 'key'), 13))::text FROM public.agent_list_tokens(:agent) LIMIT 1));
SELECT pg_temp.chk('9f tablo doğrudan okunamaz', 'hata', pg_temp.try('SELECT count(*) FROM public.agent_tokens'));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('9g anahtarın kendisi saklanmaz', '0',
  (SELECT count(*)::text FROM agent_tokens t WHERE t.agent_id = :agent AND (t.token_hash = (SELECT val FROM _k WHERE name = 'key') OR t.prefix = (SELECT val FROM _k WHERE name = 'key'))));

-- oturum: anonim çağıran, yalnız anahtarla
SELECT pg_temp.as_anon();
INSERT INTO _k SELECT 'jwt', public.agent_session((SELECT val FROM _k WHERE name = 'key')) ->> 'access_token';
SELECT pg_temp.chk('9h yanlış anahtar reddedilir', 'hata', pg_temp.try('SELECT public.agent_session(''fira_agt_'' || repeat(''0'', 64))'));
SELECT pg_temp.chk('9i bozuk biçim reddedilir', 'hata', pg_temp.try('SELECT public.agent_session(''merhaba'')'));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('9j oturum ajanın kendi hesabı için, 15 dakikalık, imzası geçerli', (:ajan)::text || '/authenticated/900/true',
  (SELECT (payload ->> 'sub') || '/' || (payload ->> 'role') || '/' || ((payload ->> 'exp')::bigint - (payload ->> 'iat')::bigint) || '/' || valid
     FROM extensions.verify((SELECT val FROM _k WHERE name = 'jwt'), current_setting('app.settings.jwt_secret'))));
SELECT pg_temp.chk('9k son kullanım yazılır', 'true', (SELECT (last_used_at IS NOT NULL)::text FROM agent_tokens WHERE agent_id = :agent));

-- beş etkin anahtar sınırı ve iptal
SELECT pg_temp.as_user(:uye);
SELECT public.agent_create_token(:agent, 'iki') ->> 'prefix' IS NOT NULL; SELECT public.agent_create_token(:agent, 'üç') ->> 'prefix' IS NOT NULL;
SELECT public.agent_create_token(:agent, 'dört') ->> 'prefix' IS NOT NULL; SELECT public.agent_create_token(:agent, 'beş') ->> 'prefix' IS NOT NULL;
SELECT pg_temp.chk('9l altıncı etkin anahtar olmaz', 'hata', pg_temp.try(format('SELECT public.agent_create_token(%L, ''altı'')', :agent)));
INSERT INTO _k SELECT 'kid', id::text FROM public.agent_list_tokens(:agent) WHERE label = 'dizüstü';
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('9m yabancı iptal edemez', 'hata',
  pg_temp.try(format('SELECT public.agent_revoke_token(%L)', (SELECT val FROM _k WHERE name = 'kid'))));
SELECT pg_temp.as_anon();
SELECT pg_temp.chk('9m2 iptal denemesinden sonra anahtar hâlâ çalışır', 'ok',
  pg_temp.try(format('SELECT public.agent_session(%L)', (SELECT val FROM _k WHERE name = 'key'))));
SELECT pg_temp.as_user(:uye);
SELECT public.agent_revoke_token((SELECT val FROM _k WHERE name = 'kid')::uuid);
SELECT pg_temp.as_anon();
SELECT pg_temp.chk('9n iptal edilen anahtar oturum açamaz', 'hata',
  pg_temp.try(format('SELECT public.agent_session(%L)', (SELECT val FROM _k WHERE name = 'key'))));
-- ajan hesabı yapay zekâ olmaktan çıkarsa anahtar da geçersiz
SELECT pg_temp.as_user(:uye);
INSERT INTO _k SELECT 'key2', public.agent_create_token(:agent, 'yedek') ->> 'key';
SELECT pg_temp.as_admin();
UPDATE profiles SET is_ai = false WHERE id = :ajan;
SELECT pg_temp.as_anon();
SELECT pg_temp.chk('9o yapay zekâ olmayan hesap için oturum açılmaz', 'hata',
  pg_temp.try(format('SELECT public.agent_session(%L)', (SELECT val FROM _k WHERE name = 'key2'))));

-- 10) Üstlenme ve kapatma (102): yalnız ajanın kendi isteği, yalnız bir kez
-- (7b görevi sildi; yeni bir deneme görevi açılır)
SELECT pg_temp.as_admin();
UPDATE profiles SET is_ai = true WHERE id = :ajan;
\set t2 '''a9e17000-0000-4000-8000-0000000000b2'''
\set r2 '''a9e17000-0000-4000-8000-0000000000c2'''
INSERT INTO tickets (id, title, project_id, status_id, status, created_by)
SELECT :t2, 'QA üstlenme', p.id, s.id, s.name, :uye
  FROM projects p JOIN ticket_statuses s ON s.project_id = p.id AND s.category IN ('backlog', 'active')
 WHERE p.team_id = :team ORDER BY s.order_index LIMIT 1;
INSERT INTO ai_work_requests (id, ticket_id, requested_by, ai_user_id, status) VALUES (:r2, :t2, :uye, :ajan, 'pending');

SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('10a başkası üstlenemez', 'false/not-found', (SELECT (r ->> 'claimed') || '/' || (r ->> 'reason') FROM public.agent_claim(:r2) r));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('10b ajan üstlenir', 'true', public.agent_claim(:r2) ->> 'claimed');
SELECT pg_temp.chk('10c ikinci üstlenme boş döner', 'false/request-processing', (SELECT (r ->> 'claimed') || '/' || (r ->> 'reason') FROM public.agent_claim(:r2) r));
SELECT pg_temp.chk('10d üstlenme ajanı görüldü yapar', 'true', (SELECT (last_seen_at > now() - interval '1 minute')::text FROM agents WHERE id = :agent));
SELECT pg_temp.chk('10e geçersiz bitiş durumu olmaz', 'hata', pg_temp.try(format('SELECT public.agent_finish(%L, ''cancelled'')', :r2)));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('10f başkası kapatamaz', 'false/not-found', (SELECT (r ->> 'finished') || '/' || (r ->> 'status') FROM public.agent_finish(:r2, 'done', 'x') r));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('10g ajan kapatır', 'true/done', (SELECT (r ->> 'finished') || '/' || (r ->> 'status') FROM public.agent_finish(:r2, 'done', '  bitti  ') r));
SELECT pg_temp.chk('10h ayrıntı kırpılır, bitiş zamanı yazılır', 'bitti/true', (SELECT detail || '/' || (finished_at IS NOT NULL)::text FROM ai_work_requests WHERE id = :r2));
-- iptal edilmiş iş "bitti" yazılamaz, gerçek durumu döner
\set r3 '''a9e17000-0000-4000-8000-0000000000c3'''
SELECT pg_temp.as_user(:uye);
INSERT INTO ai_work_requests (id, ticket_id, requested_by, ai_user_id, status) VALUES (:r3, :t2, :uye, :ajan, 'pending');
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_claim(:r3);
SELECT pg_temp.as_user(:uye);
UPDATE ai_work_requests SET status = 'cancelled' WHERE id = :r3;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('10i iptal edilen iş bitti yazılamaz', 'false/cancelled', (SELECT (r ->> 'finished') || '/' || (r ->> 'status') FROM public.agent_finish(:r3, 'done', 'x') r));
-- tamamlanmış görevin isteği üstlenilmez
\set r4 '''a9e17000-0000-4000-8000-0000000000c4'''
SELECT pg_temp.as_admin();
INSERT INTO ai_work_requests (id, ticket_id, requested_by, ai_user_id, status) VALUES (:r4, :t2, :uye, :ajan, 'pending');
ALTER TABLE tickets DISABLE TRIGGER tickets_ai_work_cancel_on_done;
UPDATE tickets t SET status_id = (SELECT s.id FROM ticket_statuses s WHERE s.project_id = t.project_id AND s.category IN ('done', 'closed') ORDER BY s.order_index LIMIT 1) WHERE t.id = :t2;
ALTER TABLE tickets ENABLE TRIGGER tickets_ai_work_cancel_on_done;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('10j tamamlanmış ya da kapatılmış görevin isteği üstlenilmez', 'false/ticket-', (SELECT (r ->> 'claimed') || '/' || left(r ->> 'reason', 7) FROM public.agent_claim(:r4) r));

-- 11) Çalıştırma kayıtları (103): kuyruk açar ve kapatır, sayıları yalnız ajan yazar
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('11a üstlenme kayıt açtı, kapatma sonucu yazdı', 'done/runner/true/QA üstlenme/true',
  (SELECT outcome || '/' || source || '/' || (finished_at IS NOT NULL)::text || '/' || ticket_title || '/' || (agent_id = :agent AND team_id = :team)::text FROM ai_runs WHERE request_id = :r2));
SELECT pg_temp.chk('11b iptal edilen işin kaydı iptal', 'cancelled', (SELECT outcome FROM ai_runs WHERE request_id = :r3));
SELECT pg_temp.chk('11c üstlenilmeyen isteğin kaydı yok', '0', (SELECT count(*)::text FROM ai_runs WHERE request_id = :r4));

SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('11d yabancı kayıtları görmez', '0', (SELECT count(*)::text FROM ai_runs WHERE request_id IN (:r2, :r3)));
SELECT pg_temp.chk('11e yabancı ölçüm yazamaz', 'hata', pg_temp.try(format('SELECT public.agent_report_run(%L, ''{"turns": 1}'')', :r2)));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('11f takım üyesi görür', '2', (SELECT count(*)::text FROM ai_runs WHERE request_id IN (:r2, :r3)));
SELECT pg_temp.try(format('UPDATE public.ai_runs SET turns = 999 WHERE request_id = %L', :r2));
SELECT pg_temp.chk('11g tabloya doğrudan yazılamaz', 'boş', (SELECT coalesce(turns::text, 'boş') FROM ai_runs WHERE request_id = :r2));
SELECT pg_temp.chk('11h üye ölçüm yazamaz (ajan değil)', 'hata', pg_temp.try(format('SELECT public.agent_report_run(%L, ''{"turns": 1}'')', :r2)));

SELECT pg_temp.as_user(:ajan);
SELECT public.agent_report_run(:r2, '{"active_seconds": 480, "turns": 22, "model": "claude-opus-5-5", "models": {"claude-opus-5-5": 20000}, "output_tokens": 20000, "cost_usd": 6.16, "version": "0.78.0", "started_at": "2020-01-01T00:00:00Z", "finished_at": "2020-01-01T01:00:00Z", "outcome": "failed", "team_id": "00000000-0000-0000-0000-000000000000"}') ->> 'source';
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('11i ajan sayıları yazar; sonuç, takım ve zamanlar değişmez', '480/22/claude-opus-5-5/20000/6.16/0.78.0/done/runner/true/true',
  (SELECT active_seconds || '/' || turns || '/' || model || '/' || output_tokens || '/' || cost_usd || '/' || version || '/' || outcome || '/' || source || '/' || (team_id = :team)::text || '/' || (started_at > now() - interval '1 hour')::text FROM ai_runs WHERE request_id = :r2));

-- kalp atışı: yalnız süren işte adım yazar, isteğin durumunu söyler
\set r5 '''a9e17000-0000-4000-8000-0000000000c5'''
\set t5 '''a9e17000-0000-4000-8000-0000000000b5'''
INSERT INTO tickets (id, title, project_id, status_id, status, created_by)
SELECT :t5, 'QA kalp atışı', p.id, s.id, s.name, :uye
  FROM projects p JOIN ticket_statuses s ON s.project_id = p.id AND s.category IN ('backlog', 'active')
 WHERE p.team_id = :team ORDER BY s.order_index LIMIT 1;
INSERT INTO ai_work_requests (id, ticket_id, requested_by, ai_user_id, status) VALUES (:r5, :t5, :uye, :ajan, 'pending');
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_claim(:r5) ->> 'claimed';
SELECT pg_temp.chk('11j kalp atışı isteğin durumunu döner', 'processing', public.agent_heartbeat(:r5, '  QA  '));
SELECT pg_temp.chk('11j2 kalp atışı adımı yazar', 'QA', (SELECT step FROM ai_runs WHERE request_id = :r5));
SELECT public.agent_heartbeat(:r5) IS NOT NULL;
SELECT pg_temp.chk('11k adımsız kalp atışı adımı silmez', 'QA', (SELECT step FROM ai_runs WHERE request_id = :r5));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('11l başkasının kalp atışı sayılmaz', 'not-found', public.agent_heartbeat(:r5, 'x'));
UPDATE ai_work_requests SET status = 'cancelled' WHERE id = :r5;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('11m iptalden sonra kalp atışı iptali söyler', 'cancelled', public.agent_heartbeat(:r5, 'geç kaldı'));
SELECT pg_temp.chk('11m2 biten işin adımı değişmez', 'QA/cancelled', (SELECT step || '/' || outcome FROM ai_runs WHERE request_id = :r5));

-- geçmiş: yalnız kuyruk zamanı olan kayda oturum kaydından gerçek zamanlar yazılabilir
SELECT pg_temp.as_admin();
UPDATE ai_runs SET source = 'queue' WHERE request_id = :r5;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('11n geçmiş kayıt oturum kaydıyla inceltilir', 'transcript',
  public.agent_report_run(:r5, '{"started_at": "2026-09-20T10:00:00Z", "finished_at": "2026-09-20T10:08:00Z", "active_seconds": 400}') ->> 'source');
SELECT pg_temp.chk('11n2 gerçek başlangıç ve süre yazıldı', '2026-09-20/480/400',
  (SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '/' || extract(epoch FROM finished_at - started_at)::int || '/' || active_seconds FROM ai_runs WHERE request_id = :r5));

-- görev silinince ölçüm kalır
SELECT pg_temp.as_admin();
DELETE FROM tickets WHERE id = :t5;
SELECT pg_temp.chk('11o görev silinince kayıt başlığıyla kalır', 'QA kalp atışı/true/true',
  (SELECT ticket_title || '/' || (ticket_id IS NULL)::text || '/' || (request_id IS NULL)::text FROM ai_runs WHERE ticket_title = 'QA kalp atışı'));

-- 12) Anlık durum kanalı (104): kanala yalnız ajanın kendi hesabı girer, ajanı görebilen izler
\set topic '''agent:a9e17000-0000-4000-8000-0000000000aa'''
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('12a ajan kendi kanalına girer ve izler', 'true/true', public.agent_topic_access(:topic, true)::text || '/' || public.agent_topic_access(:topic, false)::text);
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('12b sahibi izler ama ajan gibi giremez', 'false/true', public.agent_topic_access(:topic, true)::text || '/' || public.agent_topic_access(:topic, false)::text);
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('12c yabancı ne girer ne izler', 'false/false', public.agent_topic_access(:topic, true)::text || '/' || public.agent_topic_access(:topic, false)::text);
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('12d bozuk ya da başka kanal adı reddedilir', 'false/false/false',
  public.agent_topic_access(:topic || 'x', false)::text || '/' || public.agent_topic_access('agent:00000000-0000-4000-8000-000000000000', true)::text || '/' || public.agent_topic_access('canvas:a9e17000-0000-4000-8000-0000000000aa', false)::text);
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('12e kanala yayın gönderme izni yok (yalnız durum)', '0',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname LIKE 'fira_agent%' AND cmd = 'INSERT' AND with_check LIKE '%broadcast%'));

-- 13) Kendi ajanını oluşturma (105): yalnız üyesi olduğun takımlara, sahibinin yetkisini aşmadan
\set izleyici '''a9e17000-0000-4000-8000-000000000004'''
SELECT pg_temp.as_admin();
INSERT INTO _k SELECT 'baska-takim', id::text FROM teams WHERE id <> :team ORDER BY created_at LIMIT 1;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES (:izleyici,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-ag-izleyici@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}');
INSERT INTO profiles (id, email, full_name) VALUES (:izleyici,'qa-ag-izleyici@fira.test','QA İzleyici') ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :izleyici, 'viewer');
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :yabanci, 'member');

SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('13a ajanı olan kişi ikinci ajan açamaz', 'hata', pg_temp.try(format('SELECT public.agent_create(''İkinci Claude'', ARRAY[%L]::uuid[])', :team)));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('13b ajan hesabı ajan açamaz', 'hata', pg_temp.try('SELECT public.agent_create(''Ajanın Ajanı'', NULL)'));
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('13c adsız ajan olmaz', 'hata', pg_temp.try('SELECT public.agent_create(''  '', NULL)'));
SELECT pg_temp.chk('13d üyesi olmadığı takıma ajan ekleyemez', 'hata', pg_temp.try(format('SELECT public.agent_create(''Yabancı Claude'', ARRAY[%L]::uuid[])', (SELECT val FROM _k WHERE name = 'baska-takim'))));
SELECT pg_temp.chk('13e başarısız denemeden hesap kalmaz', '0', (SELECT count(*)::text FROM profiles WHERE full_name = 'Yabancı Claude'));
SELECT pg_temp.chk('13f üye ajanını oluşturur', 'ok', pg_temp.try(format('SELECT public.agent_create(''  Yabancı   Claude '', ARRAY[%L]::uuid[])', :team)));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('13g ajan hesabı: adı toplanmış, yapay zekâ, girişi yok, sahibi oluşturan', 'Yabancı Claude/true/true/true',
  (SELECT p.full_name || '/' || p.is_ai::text || '/' || (p.email IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id))::text || '/' || (a.owner_id = :yabanci)::text
     FROM agents a JOIN profiles p ON p.id = a.profile_id WHERE a.owner_id = :yabanci));
SELECT pg_temp.chk('13h ajan seçilen takımda üye', 'member',
  (SELECT m.role FROM team_members m JOIN agents a ON a.profile_id = m.user_id WHERE a.owner_id = :yabanci AND m.team_id = :team));

SELECT pg_temp.as_user(:izleyici);
SELECT public.agent_create('İzleyici Claude', ARRAY[:team]::uuid[]) IS NOT NULL;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('13i izleyicinin ajanı da izleyici', 'viewer',
  (SELECT m.role FROM team_members m JOIN agents a ON a.profile_id = m.user_id WHERE a.owner_id = :izleyici AND m.team_id = :team));

-- sahibi düşünce ajan da düşer; sahibi çıkınca ajan da çıkar
UPDATE team_members SET role = 'viewer' WHERE team_id = :team AND user_id = :yabanci;
SELECT pg_temp.chk('13j sahibi izleyici olunca ajan da izleyici', 'viewer',
  (SELECT m.role FROM team_members m JOIN agents a ON a.profile_id = m.user_id WHERE a.owner_id = :yabanci AND m.team_id = :team));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('13k başkasının ajanının takımlarını değiştiremez', 'hata',
  pg_temp.try(format('SELECT public.agent_set_teams(%L, ''{}''::uuid[])', (SELECT id FROM agents WHERE owner_id = :yabanci))));
SELECT pg_temp.as_user(:yabanci);
SELECT public.agent_set_teams((SELECT id FROM agents WHERE owner_id = :yabanci), '{}'::uuid[]);
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('13l sahibi ajanı takımdan çıkarır', '0',
  (SELECT count(*)::text FROM team_members m JOIN agents a ON a.profile_id = m.user_id WHERE a.owner_id = :yabanci));
DELETE FROM team_members WHERE team_id = :team AND user_id = :izleyici;
SELECT pg_temp.chk('13m sahibi takımdan çıkınca ajan da çıkar', '0',
  (SELECT count(*)::text FROM team_members m JOIN agents a ON a.profile_id = m.user_id WHERE a.owner_id = :izleyici));
-- yeni ajan da anahtarla çalışır ve atanınca iş alır
SELECT pg_temp.as_user(:izleyici);
INSERT INTO _k SELECT 'yeni-anahtar', public.agent_create_token((SELECT id FROM agents WHERE owner_id = :izleyici), 'qa') ->> 'key';
SELECT pg_temp.chk('13n sahibi yeni ajanına anahtar üretir', 'true', ((SELECT val FROM _k WHERE name = 'yeni-anahtar') ~ '^fira_agt_')::text);
-- girişi olmayan ajan hesabı anahtarla oturum açar ve yalnız üyesi olduğu takımı görür
SELECT pg_temp.as_admin();
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :izleyici, 'member');
SELECT pg_temp.as_user(:izleyici);
SELECT public.agent_set_teams((SELECT id FROM agents WHERE owner_id = :izleyici), ARRAY[:team]::uuid[]);
SELECT pg_temp.as_anon();
INSERT INTO _k SELECT 'yeni-jwt', public.agent_session((SELECT val FROM _k WHERE name = 'yeni-anahtar')) ->> 'access_token';
SELECT pg_temp.as_admin();
INSERT INTO _k SELECT 'yeni-ajan', a.profile_id::text FROM agents a WHERE a.owner_id = :izleyici;
SELECT pg_temp.chk('13o oturum yeni ajanın kendi hesabı için', 'true',
  (SELECT ((payload ->> 'sub') = (SELECT val FROM _k WHERE name = 'yeni-ajan') AND valid)::text
     FROM extensions.verify((SELECT val FROM _k WHERE name = 'yeni-jwt'), current_setting('app.settings.jwt_secret'))));
SELECT pg_temp.as_user((SELECT val FROM _k WHERE name = 'yeni-ajan')::uuid);
SELECT pg_temp.chk('13p yeni ajan takımının listelerini görür, başka takımınkini görmez', 'true/0',
  (SELECT (count(*) FILTER (WHERE team_id = :team) > 0)::text || '/' || count(*) FILTER (WHERE team_id <> :team) FROM projects));
SELECT pg_temp.as_admin();
INSERT INTO tickets (id, title, project_id, status_id, status, created_by)
SELECT 'a9e17000-0000-4000-8000-0000000000b9', 'QA yeni ajan', p.id, s.id, s.name, :izleyici
  FROM projects p JOIN ticket_statuses s ON s.project_id = p.id AND s.category IN ('backlog', 'active')
 WHERE p.team_id = :team ORDER BY s.order_index LIMIT 1;
SELECT pg_temp.as_user(:izleyici);
SELECT pg_temp.assign('a9e17000-0000-4000-8000-0000000000b9', (SELECT val FROM _k WHERE name = 'yeni-ajan')::uuid);
SELECT pg_temp.chk('13q yeni ajana atama iş başlatır', 'pending/assign', pg_temp.open_req('a9e17000-0000-4000-8000-0000000000b9'));

-- 14) Çalıştırmanın adımları ve araç kullanımı (106)
\set t6 '''a9e17000-0000-4000-8000-0000000000b6'''
\set r6 '''a9e17000-0000-4000-8000-0000000000c6'''
SELECT pg_temp.as_admin();
INSERT INTO tickets (id, title, project_id, status_id, status, created_by)
SELECT :t6, 'QA adımlar', p.id, s.id, s.name, :uye
  FROM projects p JOIN ticket_statuses s ON s.project_id = p.id AND s.category IN ('backlog', 'active')
 WHERE p.team_id = :team ORDER BY s.order_index LIMIT 1;
INSERT INTO ai_work_requests (id, ticket_id, requested_by, ai_user_id, status) VALUES (:r6, :t6, :uye, :ajan, 'pending');
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_claim(:r6) ->> 'claimed';
SELECT public.agent_heartbeat(:r6, 'Devam Ediyor') IS NOT NULL;
SELECT public.agent_heartbeat(:r6, '  Devam   Ediyor ') IS NOT NULL;
SELECT public.agent_heartbeat(:r6) IS NOT NULL;
SELECT public.agent_heartbeat(:r6, 'test') IS NOT NULL;
SELECT public.agent_heartbeat(:r6, 'QA') IS NOT NULL;
SELECT pg_temp.chk('14a adımlar sırayla saklanır, tekrar eden adım tek satır', 'Devam Ediyor>test>QA',
  (SELECT string_agg(st.step, '>' ORDER BY st.at, st.id) FROM ai_run_steps st JOIN ai_runs r ON r.id = st.run_id WHERE r.request_id = :r6));
SELECT public.agent_report_run(:r6, '{"tools": {"Bash": 38, "Edit": 3, "Kötü": "x"}, "turns": 5}') IS NOT NULL;
SELECT pg_temp.chk('14b araç kullanımı ve toplamı yazılır', '41/38', (SELECT tool_calls || '/' || (tools ->> 'Bash') FROM ai_runs WHERE request_id = :r6));
SELECT public.agent_report_run(:r6, '{"turns": 6}') IS NOT NULL;
SELECT pg_temp.chk('14c araçsız bildirim araç kullanımını silmez', '41/6', (SELECT tool_calls || '/' || turns FROM ai_runs WHERE request_id = :r6));
SELECT pg_temp.chk('14d adımlar tabloya doğrudan yazılamaz', 'hata',
  pg_temp.try(format('INSERT INTO public.ai_run_steps (run_id, step) SELECT id, ''sahte'' FROM public.ai_runs WHERE request_id = %L', :r6)));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('14e takım üyesi adımları görür', '3', (SELECT count(*)::text FROM ai_run_steps st JOIN ai_runs r ON r.id = st.run_id WHERE r.request_id = :r6));
SELECT pg_temp.as_user('a9e17000-0000-4000-8000-00000000dead');
SELECT pg_temp.chk('14f yabancı adımları görmez', '0', (SELECT count(*)::text FROM ai_run_steps));
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_finish(:r6, 'done', 'bitti') IS NOT NULL;
SELECT public.agent_heartbeat(:r6, 'geç adım') IS NOT NULL;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('14g biten işe adım eklenmez', '3', (SELECT count(*)::text FROM ai_run_steps st JOIN ai_runs r ON r.id = st.run_id WHERE r.request_id = :r6));

-- 15) Ajan kuralları (107): kural sayfalarını takım yöneticisi belirler, takımdaki herkes okur
SELECT pg_temp.as_admin();
\set yonetici '''a9e17000-0000-4000-8000-000000000005'''
\set kural '''a9e17000-0000-4000-8000-0000000000c1'''
\set cizim '''a9e17000-0000-4000-8000-0000000000c2'''
\set oteki_takim '''a9e17000-0000-4000-8000-0000000000d1'''
\set oteki_sayfa '''a9e17000-0000-4000-8000-0000000000d2'''
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES (:yonetici,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-ag-yonetici@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}');
INSERT INTO profiles (id, email, full_name) VALUES (:yonetici,'qa-ag-yonetici@fira.test','QA Yönetici') ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :yonetici, 'admin');
INSERT INTO pages (id, team_id, title, content, created_by) VALUES (:kural, :team, 'QA kural', 'Kural metni', :uye);
INSERT INTO pages (id, team_id, title, kind, created_by) VALUES (:cizim, :team, 'QA çizim', 'drawing', :uye);
INSERT INTO teams (id, name, code, created_by) VALUES (:oteki_takim, 'QA öteki takım', 'QAOTEKI107', :yabanci);
INSERT INTO pages (id, team_id, title, created_by) VALUES (:oteki_sayfa, :oteki_takim, 'Öteki kural', :yabanci);
INSERT INTO _k SELECT 'liste', project_id::text FROM tickets WHERE id = :ticket;

SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('15a üye kural sayfası ekleyemez', 'hata', pg_temp.try(format('INSERT INTO public.ai_rule_pages (page_id) VALUES (%L)', :kural)));
SELECT pg_temp.as_user(:yonetici);
SELECT pg_temp.chk('15b takım yöneticisi takım kuralı ekler', 'ok', pg_temp.try(format('INSERT INTO public.ai_rule_pages (page_id) VALUES (%L)', :kural)));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('15c takım sayfadan türetilir, ekleyen yazılır', 'true',
  (SELECT (team_id = :team AND created_by = :yonetici AND project_id IS NULL AND NOT required)::text FROM ai_rule_pages WHERE page_id = :kural));
SELECT pg_temp.as_user(:yonetici);
SELECT pg_temp.chk('15d aynı sayfa ikinci kez takım kuralı olamaz', 'hata', pg_temp.try(format('INSERT INTO public.ai_rule_pages (page_id) VALUES (%L)', :kural)));
SELECT pg_temp.chk('15e aynı sayfa bir listenin kuralı da olabilir', 'ok',
  pg_temp.try(format('INSERT INTO public.ai_rule_pages (page_id, project_id) VALUES (%L, %L)', :kural, (SELECT val FROM _k WHERE name = 'liste'))));
SELECT pg_temp.chk('15f çizim kural sayfası olamaz', 'hata', pg_temp.try(format('INSERT INTO public.ai_rule_pages (page_id) VALUES (%L)', :cizim)));
SELECT pg_temp.chk('15g başka takımın sayfası listeye kural olamaz', 'hata',
  pg_temp.try(format('INSERT INTO public.ai_rule_pages (page_id, project_id) VALUES (%L, %L)', :oteki_sayfa, (SELECT val FROM _k WHERE name = 'liste'))));
SELECT pg_temp.chk('15h yöneticisi olmadığı takımın sayfasını kural yapamaz', 'hata',
  pg_temp.try(format('INSERT INTO public.ai_rule_pages (page_id, team_id) VALUES (%L, %L)', :oteki_sayfa, :team)));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('15i takım üyesi kuralları okur', '2', (SELECT count(*)::text FROM ai_rule_pages WHERE team_id = :team AND page_id = :kural));
UPDATE ai_rule_pages SET required = true WHERE page_id = :kural;
DELETE FROM ai_rule_pages WHERE page_id = :kural;
SELECT pg_temp.chk('15j üye zorunlu yapamaz, silemez', '2/false',
  (SELECT count(*) || '/' || bool_or(required)::text FROM ai_rule_pages WHERE page_id = :kural));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('15k ajan (takım üyesi) kuralları okur', '2', (SELECT count(*)::text FROM ai_rule_pages WHERE team_id = :team AND page_id = :kural));
-- (:yabanci önceki bölümlerde bu takıma üye oldu; hiçbir takımda olmayan bir kimlik kullanılır)
SELECT pg_temp.as_user('a9e17000-0000-4000-8000-00000000dead');
SELECT pg_temp.chk('15l takım dışındaki kişi görmez', '0', (SELECT count(*)::text FROM ai_rule_pages WHERE team_id = :team));
SELECT pg_temp.as_user(:yonetici);
UPDATE ai_rule_pages SET required = true, page_id = :cizim, team_id = :oteki_takim WHERE page_id = :kural AND project_id IS NULL;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('15m yönetici zorunlu yapar; satırın gösterdiği sayfa ve takım değişmez', 'true/1',
  (SELECT bool_and(required)::text || '/' || count(*) FROM ai_rule_pages WHERE page_id = :kural AND team_id = :team AND project_id IS NULL));
DELETE FROM pages WHERE id = :kural;
SELECT pg_temp.chk('15n sayfa silinince kural satırları da gider', '0', (SELECT count(*)::text FROM ai_rule_pages WHERE page_id = :kural));

-- 16) Çalıştırma hangi kurallarla çalıştı (108)
SELECT pg_temp.as_admin();
\set t7 '''a9e17000-0000-4000-8000-0000000000e7'''
\set r7 '''a9e17000-0000-4000-8000-0000000000b7'''
INSERT INTO tickets (id, title, project_id, status_id, status, created_by)
SELECT :t7, 'QA kural kaydı', p.id, s.id, s.name, :uye
  FROM projects p JOIN ticket_statuses s ON s.project_id = p.id AND s.category IN ('backlog', 'active')
 WHERE p.team_id = :team ORDER BY s.order_index LIMIT 1;
INSERT INTO ai_work_requests (id, ticket_id, requested_by, ai_user_id, status) VALUES (:r7, :t7, :uye, :ajan, 'pending');
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_claim(:r7) ->> 'claimed';
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('16a yeni çalıştırmada kural kaydı yok (boş değil, kayıtsız)', 'true', (SELECT (rules IS NULL AND rules_personal IS NULL)::text FROM ai_runs WHERE request_id = :r7));
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_report_run(:r7, '{"rules": [
  {"page_id": "a9e17000-0000-4000-8000-0000000000c9", "title": "Takım kuralı", "scope": "team", "required": true, "updated_at": "2026-10-02T10:00:00+00:00", "content": "saklanmamalı"},
  {"page_id": "a9e17000-0000-4000-8000-0000000000ca", "title": "Liste kuralı", "scope": "list", "required": "evet", "updated_at": "dün"},
  {"page_id": "kimlik değil", "title": "atlanır"},
  "metin"
], "rules_personal": true}') IS NOT NULL;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('16b yalnız biçimi doğru kurallar, sırasıyla ve bilinen alanlarla saklanır', '2/team:true/list:false/yok/yok',
  (SELECT jsonb_array_length(rules) || '/' || (rules -> 0 ->> 'scope') || ':' || (rules -> 0 ->> 'required') || '/' || (rules -> 1 ->> 'scope') || ':' || (rules -> 1 ->> 'required')
          || '/' || CASE WHEN rules -> 0 ? 'content' THEN 'var' ELSE 'yok' END || '/' || coalesce(rules -> 1 ->> 'updated_at', 'yok')
   FROM ai_runs WHERE request_id = :r7));
SELECT pg_temp.chk('16c kişisel tercihlerin okunduğu yazılır', 'true', (SELECT rules_personal::text FROM ai_runs WHERE request_id = :r7));
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_report_run(:r7, '{"turns": 3}') IS NOT NULL;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('16d kuralsız bildirim kural kaydını silmez', '2/true/3', (SELECT jsonb_array_length(rules) || '/' || rules_personal || '/' || turns FROM ai_runs WHERE request_id = :r7));
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_report_run(:r7, '{"rules": []}') IS NOT NULL;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('16e boş liste "kural tanımlı değildi" demektir, kişisel tercih de okunmadı', '0/false', (SELECT jsonb_array_length(rules) || '/' || rules_personal FROM ai_runs WHERE request_id = :r7));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('16f takım üyesi çalıştırmanın kural kaydını görür', '0', (SELECT jsonb_array_length(rules)::text FROM ai_runs WHERE request_id = :r7));

-- 17) Canlıya çıkış onayı (109)
SELECT pg_temp.as_admin();
\set t8 '''a9e17000-0000-4000-8000-0000000000e8'''
\set r8 '''a9e17000-0000-4000-8000-0000000000b8'''
\set uye2 '''a9e17000-0000-4000-8000-000000000006'''
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES (:uye2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-ag-uye2@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}');
INSERT INTO profiles (id, email, full_name) VALUES (:uye2,'qa-ag-uye2@fira.test','QA Üye İki') ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :uye2, 'member');
INSERT INTO tickets (id, title, project_id, status_id, status, created_by)
SELECT :t8, 'QA onay', p.id, s.id, s.name, :uye
  FROM projects p JOIN ticket_statuses s ON s.project_id = p.id AND s.category IN ('backlog', 'active')
 WHERE p.team_id = :team ORDER BY s.order_index LIMIT 1;
INSERT INTO _k SELECT 'liste8', project_id::text FROM tickets WHERE id = :t8;
DELETE FROM ai_list_policies WHERE project_id = (SELECT val FROM _k WHERE name = 'liste8')::uuid;
UPDATE agents SET settings = settings - 'deploy' WHERE id = :agent;

-- ayar: listeyi takım yöneticisi belirler
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('17a üye listenin canlıya çıkış ayarını yazamaz', 'hata',
  pg_temp.try(format('INSERT INTO public.ai_list_policies (project_id, deploy) VALUES (%L, ''ask'')', (SELECT val FROM _k WHERE name = 'liste8'))));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('17b ayar yokken ajan kendisi çıkar', 'auto/auto/auto',
  (SELECT (p ->> 'list') || '/' || (p ->> 'person') || '/' || (p ->> 'effective') FROM public.ai_deploy_policy(:t8) p));
SELECT pg_temp.as_user(:yonetici);
SELECT pg_temp.chk('17c takım yöneticisi "onay ister" yapar', 'ok',
  pg_temp.try(format('INSERT INTO public.ai_list_policies (project_id, deploy, team_id) VALUES (%L, ''ask'', %L)', (SELECT val FROM _k WHERE name = 'liste8'), :oteki_takim)));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('17d takım listeden türetilir', 'true', (SELECT (team_id = :team)::text FROM ai_list_policies WHERE project_id = (SELECT val FROM _k WHERE name = 'liste8')::uuid));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('17e liste "onay ister" → geçerli olan onay', 'ask/auto/ask',
  (SELECT (p ->> 'list') || '/' || (p ->> 'person') || '/' || (p ->> 'effective') FROM public.ai_deploy_policy(:t8) p));
SELECT pg_temp.as_admin();
UPDATE agents SET settings = settings || '{"deploy": "never"}' WHERE id = :agent;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('17f kişi "çıkış yok" derse sıkı olan geçerli', 'ask/never/never',
  (SELECT (p ->> 'list') || '/' || (p ->> 'person') || '/' || (p ->> 'effective') FROM public.ai_deploy_policy(:t8) p));

-- istek: ajan sorar
SELECT pg_temp.as_admin();
INSERT INTO ai_work_requests (id, ticket_id, requested_by, ai_user_id, status, approval) VALUES (:r8, :t8, :uye, :ajan, 'pending', '{"status": "approved"}');
SELECT pg_temp.chk('17g istek açılırken onay yazılamaz', 'true', (SELECT (approval IS NULL)::text FROM ai_work_requests WHERE id = :r8));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('17h üstlenmeden sorulamaz', 'request-pending', (SELECT public.agent_ask_approval(:r8, 'x') ->> 'reason'));
SELECT public.agent_claim(:r8) ->> 'claimed';
SELECT pg_temp.chk('17i "çıkış yok" iken sorulmaz', 'never', (SELECT public.agent_ask_approval(:r8, 'Sürüm 1') ->> 'reason'));
SELECT pg_temp.as_admin();
UPDATE agents SET settings = settings - 'deploy' WHERE id = :agent;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('17j özet boşsa sorulamaz', 'hata', pg_temp.try(format('SELECT public.agent_ask_approval(%L, ''   '')', :r8)));
SELECT pg_temp.chk('17k ajan sorar', 'true', (SELECT public.agent_ask_approval(:r8, '  Sürüm 1: giriş ekranı  ') ->> 'asked'));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('17l onay bekliyor, özet kırpılmış', 'pending/Sürüm 1: giriş ekranı', (SELECT (approval ->> 'status') || '/' || (approval ->> 'summary') FROM ai_work_requests WHERE id = :r8));
SELECT pg_temp.chk('17m soru görevin yorumlarına ajanın adıyla düşer', '1',
  (SELECT count(*)::text FROM ticket_comments WHERE ticket_id = :t8 AND author_id = :ajan AND content LIKE '%onay istiyorum%Sürüm 1%'));

-- cevap: ajan kendi sorusunu cevaplayamaz
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('17n ajan kendi isteğini onaylayamaz', 'hata', pg_temp.try(format('SELECT public.ai_decide_approval(%L, true)', :r8)));
UPDATE ai_work_requests SET approval = '{"status": "approved"}' WHERE id = :r8;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('17o ajan sütunu doğrudan yazarak da onaylayamaz', 'pending', (SELECT approval ->> 'status' FROM ai_work_requests WHERE id = :r8));
SELECT pg_temp.as_user(:uye2);
SELECT pg_temp.chk('17p işi istemeyen, sahibi ya da yönetici olmayan üye onaylayamaz', 'hata', pg_temp.try(format('SELECT public.ai_decide_approval(%L, true)', :r8)));
SELECT pg_temp.as_user('a9e17000-0000-4000-8000-00000000dead');
SELECT pg_temp.chk('17q takım dışı onaylayamaz', 'hata', pg_temp.try(format('SELECT public.ai_decide_approval(%L, true)', :r8)));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('17r işi isteyen onaylar', 'approved', (SELECT public.ai_decide_approval(:r8, true) ->> 'status'));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('17s kim, ne zaman yazılır; özet yerinde', 'true',
  (SELECT ((approval ->> 'decided_by')::uuid = :uye AND (approval ->> 'decided_at') IS NOT NULL AND approval ->> 'summary' = 'Sürüm 1: giriş ekranı')::text FROM ai_work_requests WHERE id = :r8));
SELECT pg_temp.chk('17t cevap görevin yorumlarına onaylayanın adıyla düşer', '1',
  (SELECT count(*)::text FROM ticket_comments WHERE ticket_id = :t8 AND author_id = :uye AND content LIKE '%onaylandı%'));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('17u cevaplanmış istek ikinci kez cevaplanamaz', 'hata', pg_temp.try(format('SELECT public.ai_decide_approval(%L, false)', :r8)));

-- yeniden sorma ve ret
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_ask_approval(:r8, 'Sürüm 2') ->> 'asked';
SELECT pg_temp.as_user(:yonetici);
SELECT pg_temp.chk('17v takım yöneticisi notuyla reddeder', 'rejected/Önce test', (SELECT (a ->> 'status') || '/' || (a ->> 'note') FROM public.ai_decide_approval(:r8, false, '  Önce test ') a));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('17w ret ve notu yorumlarda', '1', (SELECT count(*)::text FROM ticket_comments WHERE ticket_id = :t8 AND author_id = :yonetici AND content LIKE '%reddedildi%Önce test%'));

-- ayar "kendisi çıkar" ise sorulmaz; iş bitince cevap verilemez
UPDATE ai_list_policies SET deploy = 'auto' WHERE project_id = (SELECT val FROM _k WHERE name = 'liste8')::uuid;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('17x ayar "kendisi çıkar" iken sorulmaz', 'not-needed', (SELECT public.agent_ask_approval(:r8, 'Sürüm 3') ->> 'reason'));
SELECT pg_temp.as_admin();
UPDATE ai_list_policies SET deploy = 'ask' WHERE project_id = (SELECT val FROM _k WHERE name = 'liste8')::uuid;
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_ask_approval(:r8, 'Sürüm 4') ->> 'asked';
SELECT public.agent_finish(:r8, 'done', 'bitti') IS NOT NULL;
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('17y iş bittikten sonra onay verilemez', 'hata', pg_temp.try(format('SELECT public.ai_decide_approval(%L, true)', :r8)));

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SELECT pg_temp.as_admin();
SELECT step || ' | bekl: ' || expected || ' | gerçek: ' || actual || ' | ' || CASE WHEN ok THEN 'GEÇTİ' ELSE '*** KALDI ***' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' kontrol geçti' FROM _r;

ROLLBACK;
