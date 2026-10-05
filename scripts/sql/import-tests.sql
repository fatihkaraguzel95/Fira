-- Çalıştırma: base64 ile sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -At < import-tests.sql
-- Tüm işlem ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur.
-- Excel/Planner içe aktarmasının yazdığı her satırı simüle eder (runCsvImport ile aynı sıra ve aynı sütunlar),
-- böylece RLS ve kolon kısıtları oturum açmadan doğrulanabilir. 26 kontrol.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', (SELECT email FROM public.profiles WHERE id = u))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN 'hata: ' || left(SQLERRM, 70); END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected = actual) $$;

-- Sabit kimlikler (işlem sonunda geri alınır)
-- team: PARS · user: Claude hesabı (takım yöneticisi)
\set team '''dfe5563c-cb92-43f2-b030-d8f1e132bc10'''
\set claude '''b7b4c570-4b45-492e-9e02-5970c88ee48c'''
\set list '''cc000000-0000-4000-8000-000000000001'''

SELECT pg_temp.as_user(:claude);

-- ── 1. Hedef liste ───────────────────────────────────────────────────────────
SELECT pg_temp.try(format($$INSERT INTO projects (id, team_id, name, created_by) VALUES (%L, %L, 'QA Import Testi', auth.uid())$$, :list, :team));
SELECT pg_temp.chk('1 liste oluşturuldu', '1', (SELECT count(*)::text FROM projects WHERE id = :list));

-- ── 2. Sütunlar (kategori + renk, importer ile aynı) ─────────────────────────
SELECT pg_temp.try(format($$INSERT INTO ticket_statuses (id, project_id, name, color, order_index, category) VALUES
  ('cc000000-0000-4000-8000-000000000011', %L, 'ToDo', '#6366f1', 0, 'backlog'),
  ('cc000000-0000-4000-8000-000000000012', %L, 'In Progress', '#0ea5e9', 1, 'active'),
  ('cc000000-0000-4000-8000-000000000013', %L, 'Completed', '#14b8a6', 2, 'done')$$, :list, :list, :list));
-- (yeni liste varsayılan sütunlarla gelir; burada yalnızca içe aktarmanın eklediklerine bakılır)
SELECT pg_temp.chk('2a üç sütun eklendi', '3', (SELECT count(*)::text FROM ticket_statuses WHERE project_id = :list AND name IN ('ToDo','In Progress','Completed')));
SELECT pg_temp.chk('2b kategoriler', 'active,backlog,done', (SELECT string_agg(DISTINCT category::text, ',' ORDER BY category::text) FROM ticket_statuses WHERE project_id = :list));

-- ── 3. Etiketler ─────────────────────────────────────────────────────────────
SELECT pg_temp.try(format($$INSERT INTO tags (id, project_id, name, color) VALUES
  ('cc000000-0000-4000-8000-000000000021', %L, 'FLP My Time', '#f59e0b'),
  ('cc000000-0000-4000-8000-000000000022', %L, 'Nice2have', '#ec4899')$$, :list, :list));
SELECT pg_temp.chk('3 boşluklu etiket adı korunur', 'FLP My Time', (SELECT name FROM tags WHERE id = 'cc000000-0000-4000-8000-000000000021'));

-- ── 4. Üst görev: Planner alanlarıyla ────────────────────────────────────────
SELECT pg_temp.try(format($$INSERT INTO tickets (id, title, description, status, status_id, project_id, priority, due_date, created_by, updated_by, order_index, created_at)
  VALUES ('cc000000-0000-4000-8000-000000000031', 'App tour',
          'nice2have açıklaması' || chr(10) || chr(10) || '---' || chr(10) || chr(10) || '**Planner alanları**' || chr(10) || chr(10) || '- Plan: FLP Tasks',
          'ToDo', 'cc000000-0000-4000-8000-000000000011', %L, 'medium', '2025-07-25', auth.uid(), auth.uid(), 0, '2025-07-09T00:00:00.000Z')$$, :list));
SELECT pg_temp.chk('4a üst görev', '1', (SELECT count(*)::text FROM tickets WHERE id = 'cc000000-0000-4000-8000-000000000031'));
SELECT pg_temp.chk('4b geçmiş tarihli created_at yazılabildi', '2025-07-09', (SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM tickets WHERE id = 'cc000000-0000-4000-8000-000000000031'));
SELECT pg_temp.chk('4c açıklama korunur (Planner bloğu)', 'true', (SELECT (description LIKE '%Planner alanları%')::text FROM tickets WHERE id = 'cc000000-0000-4000-8000-000000000031'));

-- ── 5. Denetim listesi → alt görevler (tamamlananlar done sütununda) ─────────
SELECT pg_temp.try(format($$INSERT INTO tickets (id, title, status, status_id, project_id, parent_id, created_by, updated_by, order_index)
  VALUES ('cc000000-0000-4000-8000-000000000041', 'Ingilizce tercümesi', 'Completed', 'cc000000-0000-4000-8000-000000000013', %L, 'cc000000-0000-4000-8000-000000000031', auth.uid(), auth.uid(), 1),
         ('cc000000-0000-4000-8000-000000000042', 'Scroll düzeltmesi', 'ToDo', 'cc000000-0000-4000-8000-000000000011', %L, 'cc000000-0000-4000-8000-000000000031', auth.uid(), auth.uid(), 2)$$, :list, :list));
SELECT pg_temp.chk('5a iki alt görev', '2', (SELECT count(*)::text FROM tickets WHERE parent_id = 'cc000000-0000-4000-8000-000000000031'));
SELECT pg_temp.chk('5b tamamlanan alt görev done kategorisinde', 'done', (SELECT s.category::text FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id WHERE t.id = 'cc000000-0000-4000-8000-000000000041'));

-- ── 6. Atama ve etiket bağlantıları ──────────────────────────────────────────
SELECT pg_temp.try($$INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ('cc000000-0000-4000-8000-000000000031', auth.uid())$$);
SELECT pg_temp.try($$INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES
  ('cc000000-0000-4000-8000-000000000031','cc000000-0000-4000-8000-000000000021'),
  ('cc000000-0000-4000-8000-000000000031','cc000000-0000-4000-8000-000000000022')$$);
SELECT pg_temp.chk('6a atama', '1', (SELECT count(*)::text FROM ticket_assignees WHERE ticket_id = 'cc000000-0000-4000-8000-000000000031'));
SELECT pg_temp.chk('6b iki etiket', '2', (SELECT count(*)::text FROM ticket_tag_assignments WHERE ticket_id = 'cc000000-0000-4000-8000-000000000031'));

-- ── 7. Yetkisiz kullanıcı aynı listeye yazamaz ───────────────────────────────
SELECT pg_temp.as_user('22222222-2222-4222-8222-222222222222');
SELECT pg_temp.chk('7 takım dışı kullanıcı görev ekleyemez', 'engellendi',
  CASE WHEN pg_temp.try(format($$INSERT INTO tickets (title, status, project_id, created_by, updated_by) VALUES ('sızma', 'ToDo', %L, auth.uid(), auth.uid())$$, :list)) = 'ok'
       THEN 'YAZDI' ELSE 'engellendi' END);

-- ── 8. Aktivite günlüğü: içe aktarılan görevin kaydı geçmiş tarihli ─────────
SELECT pg_temp.as_user(:claude);
SELECT pg_temp.chk('8a oluşturma kaydı görevin tarihiyle', '2025-07-09',
  (SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM ticket_activity
   WHERE ticket_id = 'cc000000-0000-4000-8000-000000000031' AND kind = 'created'));

-- ── 9. Planner'ın tamamlanma bilgisi günlüğe yazılır ────────────────────────
SELECT pg_temp.try(format($$SELECT log_import_completion('cc000000-0000-4000-8000-000000000031'::uuid, '2025-07-10T12:00:00Z'::timestamptz, %L::uuid, 'ToDo', 'Halil Ibrahim Aydin')$$, :claude));
SELECT pg_temp.chk('9a tamamlanma kaydı geçmiş tarihli', '2025-07-10',
  (SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM ticket_activity
   WHERE ticket_id = 'cc000000-0000-4000-8000-000000000031' AND (meta ->> 'imported') = 'true'));
SELECT pg_temp.chk('9b geçiş hedefi görevin sütunu', 'ToDo → ToDo',
  (SELECT from_value || ' → ' || to_value FROM ticket_activity
   WHERE ticket_id = 'cc000000-0000-4000-8000-000000000031' AND (meta ->> 'imported') = 'true'));
SELECT pg_temp.chk('9c eşleşmeyen kişinin adı saklanır', 'Halil Ibrahim Aydin',
  (SELECT meta ->> 'by_name' FROM ticket_activity
   WHERE ticket_id = 'cc000000-0000-4000-8000-000000000031' AND (meta ->> 'imported') = 'true'));
-- ikinci kez çağrılınca kayıt ikilenmemeli
SELECT pg_temp.try(format($$SELECT log_import_completion('cc000000-0000-4000-8000-000000000031'::uuid, '2025-07-10T12:00:00Z'::timestamptz, %L::uuid, 'ToDo', 'Halil Ibrahim Aydin')$$, :claude));
SELECT pg_temp.chk('9d tekrar çağrı kaydı ikilemez', '1',
  (SELECT count(*)::text FROM ticket_activity
   WHERE ticket_id = 'cc000000-0000-4000-8000-000000000031' AND (meta ->> 'imported') = 'true'));

-- ── 10. Takım dışı kullanıcı tamamlanma kaydı yazamaz ───────────────────────
SELECT pg_temp.as_user('22222222-2222-4222-8222-222222222222');
SELECT pg_temp.chk('10 takım dışı kullanıcı günlüğe yazamaz', 'engellendi',
  CASE WHEN pg_temp.try($$SELECT log_import_completion('cc000000-0000-4000-8000-000000000031'::uuid, '2025-01-01T00:00:00Z'::timestamptz, NULL, NULL, 'sızma')$$) = 'ok'
       THEN 'YAZDI' ELSE 'engellendi' END);

-- ── 11. İçe aktarmadan gelen kişi ve sonradan devralma ──────────────────────
SELECT pg_temp.as_user(:claude);
SELECT pg_temp.try(format($$SELECT upsert_imported_profile(%L::uuid, 'qa-hayalet@fira.test', 'QA Hayalet', 'planner-guid-qa', 'Microsoft Planner · QA')$$, :team));
SELECT pg_temp.chk('11a içe aktarma profili açıldı', 'import|QA Hayalet',
  (SELECT source || '|' || full_name FROM profiles WHERE lower(email) = 'qa-hayalet@fira.test'));
SELECT pg_temp.try($$INSERT INTO ticket_assignees (ticket_id, user_id)
  SELECT 'cc000000-0000-4000-8000-000000000031', id FROM profiles WHERE lower(email)='qa-hayalet@fira.test'$$);
SELECT pg_temp.chk('11b hayalet göreve atanabiliyor', '1',
  (SELECT count(*)::text FROM ticket_assignees a JOIN profiles p ON p.id=a.user_id
   WHERE a.ticket_id='cc000000-0000-4000-8000-000000000031' AND p.source='import'));

-- kişi kendi hesabını açıyor → geçmiş devrolmalı
SET LOCAL role = postgres;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-hayalet@fira.test','x',now(),now(),now(),'{"provider":"email"}','{}');
SELECT pg_temp.chk('11c hayalet kayıt silindi', '0', (SELECT count(*)::text FROM profiles WHERE source='import' AND lower(email)='qa-hayalet@fira.test'));
SELECT pg_temp.chk('11d yeni hesap adı devraldı', 'QA Hayalet|account',
  (SELECT full_name || '|' || source FROM profiles WHERE id='44444444-4444-4444-8444-444444444444'));
SELECT pg_temp.chk('11e atama yeni hesaba geçti', '1',
  (SELECT count(*)::text FROM ticket_assignees WHERE ticket_id='cc000000-0000-4000-8000-000000000031' AND user_id='44444444-4444-4444-8444-444444444444'));

-- ── 12. Yetkisiz kullanıcı içe aktarma kaydı açamaz ─────────────────────────
SELECT pg_temp.as_user('22222222-2222-4222-8222-222222222222');
SELECT pg_temp.chk('12 takım dışı kullanıcı kişi kaydı açamaz', 'engellendi',
  CASE WHEN pg_temp.try(format($$SELECT upsert_imported_profile(%L::uuid, 'sizma@fira.test', 'Sızma', NULL, NULL)$$, :team)) = 'ok'
       THEN 'YAZDI' ELSE 'engellendi' END);

-- ── 13. Görevin sahibi dış sistemdeki oluşturana geçer ─────────────────────
SELECT pg_temp.as_user(:claude);
SELECT pg_temp.try($$SELECT set_import_author('cc000000-0000-4000-8000-000000000031'::uuid,
  (SELECT id FROM profiles WHERE lower(email)='qa-hayalet@fira.test'), 'Microsoft Planner · QA', NULL)$$);
SELECT pg_temp.chk('13a görevin sahibi değişti', 'QA Hayalet',
  (SELECT p.full_name FROM tickets t JOIN profiles p ON p.id = t.created_by WHERE t.id='cc000000-0000-4000-8000-000000000031'));
SELECT pg_temp.chk('13b aktaran kişi günlükte', '1',
  (SELECT count(*)::text FROM ticket_activity WHERE ticket_id='cc000000-0000-4000-8000-000000000031' AND kind='imported'));

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SET LOCAL role = postgres;
SELECT step, expected, actual, CASE WHEN ok THEN 'GEÇTİ' ELSE 'KALDI' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' kontrol geçti' FROM _r;
ROLLBACK;
