-- Çalıştırma: docker exec -i supabase-db psql -U postgres -d postgres -At < move-tests.sql
-- Tümü ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur.
-- 14 kontrol: 093 `move_ticket` — aynı takım içi taşıma, başka takıma taşımada
-- "iki tarafta da yönetici" kuralı, durum/etiket eşlemesi, üye olmayan
-- atamaların düşmesi, alt görevin birlikte taşınması, aktivite kaydı.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

-- ── Kullanıcılar ─────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('aa000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-move-admin@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
       ('aa000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-move-uye@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
       ('aa000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-move-yabanci@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}');
INSERT INTO profiles (id, email, full_name) VALUES
  ('aa000000-0000-4000-8000-000000000001','qa-move-admin@fira.test','QA Taşıma Yöneticisi'),
  ('aa000000-0000-4000-8000-000000000002','qa-move-uye@fira.test','QA Taşıma Üyesi'),
  ('aa000000-0000-4000-8000-000000000003','qa-move-yabanci@fira.test','QA Yabancı')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_email text;
BEGIN
  PERFORM set_config('role', 'postgres', true);
  SELECT email INTO v_email FROM public.profiles WHERE id = u;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', v_email)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN 'hata: ' || left(SQLERRM, 60); END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected = actual) $$;

-- ── Kurgu: iki takım, üç liste ───────────────────────────────────────────────
-- A takımı: yönetici + üye + yabancı değil; B takımı: yönetici (ve üye yok).
INSERT INTO teams (id, name, code, created_by) VALUES
  ('bb000000-0000-4000-8000-00000000000a','QA Takım A','QAMOVEA','aa000000-0000-4000-8000-000000000001'),
  ('bb000000-0000-4000-8000-00000000000b','QA Takım B','QAMOVEB','aa000000-0000-4000-8000-000000000001');
INSERT INTO team_members (team_id, user_id, role) VALUES
  ('bb000000-0000-4000-8000-00000000000a','aa000000-0000-4000-8000-000000000001','owner'),
  ('bb000000-0000-4000-8000-00000000000a','aa000000-0000-4000-8000-000000000002','member'),
  ('bb000000-0000-4000-8000-00000000000a','aa000000-0000-4000-8000-000000000003','member'),
  ('bb000000-0000-4000-8000-00000000000b','aa000000-0000-4000-8000-000000000001','admin'),
  ('bb000000-0000-4000-8000-00000000000b','aa000000-0000-4000-8000-000000000002','member')
ON CONFLICT DO NOTHING;

INSERT INTO projects (id, team_id, name, created_by) VALUES
  ('cc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-00000000000a','A-1','aa000000-0000-4000-8000-000000000001'),
  ('cc000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-00000000000a','A-2','aa000000-0000-4000-8000-000000000001'),
  ('cc000000-0000-4000-8000-000000000003','bb000000-0000-4000-8000-00000000000b','B-1','aa000000-0000-4000-8000-000000000001');
-- Yeni liste kendi varsayılan durumlarıyla doğuyor (086); testin sütunları
-- bilinsin diye önce onlar siliniyor.
DELETE FROM ticket_statuses WHERE project_id IN ('cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003');
INSERT INTO ticket_statuses (id, project_id, name, order_index, category) VALUES
  ('dd000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000001','Yapılacak',0,'backlog'),
  ('dd000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000001','Devam Ediyor',1,'active'),
  ('dd000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000002','Yapılacak',0,'backlog'),
  ('dd000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000003','Bekliyor',0,'backlog'),
  ('dd000000-0000-4000-8000-000000000005','cc000000-0000-4000-8000-000000000003','Devam Ediyor',1,'active');
INSERT INTO tags (id, project_id, name, color) VALUES
  ('ee000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000001','acil','#ef4444'),
  ('ee000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000001','yalniz-burada','#64748b'),
  ('ee000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000003','acil','#ef4444');

INSERT INTO tickets (id, project_id, status_id, status, title, created_by, updated_by) VALUES
  ('ff000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','Devam Ediyor','QA taşınacak görev','aa000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001');
INSERT INTO tickets (id, project_id, status_id, status, title, parent_id, created_by, updated_by) VALUES
  ('ff000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000001','Yapılacak','QA alt görev','ff000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001');
INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES
  ('ff000000-0000-4000-8000-000000000001','ee000000-0000-4000-8000-000000000001'),
  ('ff000000-0000-4000-8000-000000000001','ee000000-0000-4000-8000-000000000002');
INSERT INTO ticket_assignees (ticket_id, user_id) VALUES
  ('ff000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000002'),   -- iki takımda da üye
  ('ff000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000003');   -- yalnız A takımında

-- ── 1. Aynı takım: üye taşıyabilir ───────────────────────────────────────────
SELECT pg_temp.as_user('aa000000-0000-4000-8000-000000000002');
SELECT pg_temp.chk('1a üye aynı takımda taşır', 'ok',
  pg_temp.try($$SELECT move_ticket('ff000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000002')$$));
SELECT pg_temp.chk('1b görev A-2 listesinde', 'cc000000-0000-4000-8000-000000000002',
  (SELECT project_id::text FROM tickets WHERE id = 'ff000000-0000-4000-8000-000000000001'));
SELECT pg_temp.chk('1c alt görev de taşındı', 'cc000000-0000-4000-8000-000000000002',
  (SELECT project_id::text FROM tickets WHERE id = 'ff000000-0000-4000-8000-000000000002'));
SELECT pg_temp.chk('1d durum hedefin ilk sütunu (aynı ad yok)', 'Yapılacak',
  (SELECT status FROM tickets WHERE id = 'ff000000-0000-4000-8000-000000000001'));
SELECT pg_temp.chk('1e etiketler düştü (A-2 de etiket yok)', '0',
  (SELECT count(*)::text FROM ticket_tag_assignments WHERE ticket_id = 'ff000000-0000-4000-8000-000000000001'));
SELECT pg_temp.chk('1f atamalar duruyor', '2',
  (SELECT count(*)::text FROM ticket_assignees WHERE ticket_id = 'ff000000-0000-4000-8000-000000000001'));

-- Etiketleri geri koy: sıradaki testler için (A-1'e geri taşı)
SELECT pg_temp.as_user('aa000000-0000-4000-8000-000000000001');
SELECT pg_temp.try($$SELECT move_ticket('ff000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000001')$$);
SELECT set_config('role','postgres',true);
INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES
  ('ff000000-0000-4000-8000-000000000001','ee000000-0000-4000-8000-000000000001'),
  ('ff000000-0000-4000-8000-000000000001','ee000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;
UPDATE tickets SET status_id = 'dd000000-0000-4000-8000-000000000002', status = 'Devam Ediyor' WHERE id = 'ff000000-0000-4000-8000-000000000001';

-- ── 2. Başka takım: yalnız kaynakta üye olan taşıyamaz ───────────────────────
SELECT pg_temp.as_user('aa000000-0000-4000-8000-000000000002');
SELECT pg_temp.chk('2a üye başka takıma taşıyamaz', 'hata',
  left(pg_temp.try($$SELECT move_ticket('ff000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000003')$$), 4));
SELECT pg_temp.chk('2b görev yerinde kaldı', 'cc000000-0000-4000-8000-000000000001',
  (SELECT project_id::text FROM tickets WHERE id = 'ff000000-0000-4000-8000-000000000001'));

-- ── 3. Başka takım: iki tarafta da yönetici taşır ────────────────────────────
SELECT pg_temp.as_user('aa000000-0000-4000-8000-000000000001');
SELECT pg_temp.chk('3a yönetici başka takıma taşır', 'ok',
  pg_temp.try($$SELECT move_ticket('ff000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000003')$$));
SELECT pg_temp.chk('3b görev B-1 listesinde', 'cc000000-0000-4000-8000-000000000003',
  (SELECT project_id::text FROM tickets WHERE id = 'ff000000-0000-4000-8000-000000000001'));
SELECT pg_temp.chk('3c durum aynı adlı sütuna oturdu', 'Devam Ediyor',
  (SELECT status FROM tickets WHERE id = 'ff000000-0000-4000-8000-000000000001'));
SELECT pg_temp.chk('3d ada göre eşleşen etiket kaldı', 'acil',
  (SELECT string_agg(t.name, ',' ORDER BY t.name) FROM ticket_tag_assignments ta JOIN tags t ON t.id = ta.tag_id WHERE ta.ticket_id = 'ff000000-0000-4000-8000-000000000001'));
SELECT pg_temp.chk('3e hedef takımın üyesi olmayan atama düştü', 'aa000000-0000-4000-8000-000000000002',
  (SELECT string_agg(user_id::text, ',') FROM ticket_assignees WHERE ticket_id = 'ff000000-0000-4000-8000-000000000001'));
SELECT pg_temp.chk('3f alt görev de yeni takımda', 'cc000000-0000-4000-8000-000000000003',
  (SELECT project_id::text FROM tickets WHERE id = 'ff000000-0000-4000-8000-000000000002'));
SELECT pg_temp.chk('3g aktivite takım bilgisini taşıyor', '1',
  (SELECT count(*)::text FROM ticket_activity WHERE ticket_id = 'ff000000-0000-4000-8000-000000000001' AND kind = 'project' AND meta ? 'to_team'));
SELECT pg_temp.chk('3h düşen atama sayısı kaydedildi', '1',
  (SELECT (meta->>'dropped_assignees') FROM ticket_activity WHERE ticket_id = 'ff000000-0000-4000-8000-000000000001' AND kind = 'project' AND meta ? 'dropped_assignees' ORDER BY created_at DESC LIMIT 1));

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SET LOCAL role postgres;
SELECT step, expected, actual, CASE WHEN ok THEN 'OK' ELSE 'HATA' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS sonuc FROM _r;
ROLLBACK;
