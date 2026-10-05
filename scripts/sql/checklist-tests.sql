-- Yapılacaklar listesi (097, #7c54fb70) — RLS, tetikleyici ve copy_ticket testleri.
-- Çalıştırma: docker exec -i supabase-db psql -U postgres -d postgres -At < checklist-tests.sql
-- Her şey ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur. Demo takım "Fira Tanıtım" ve onun bir görevi kullanılır.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('c1c1c1c1-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-cl-uye@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
       ('c1c1c1c1-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-cl-izleyici@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
       ('c1c1c1c1-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-cl-yabanci@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}');
INSERT INTO profiles (id, email, full_name) VALUES
  ('c1c1c1c1-0000-4000-8000-000000000001','qa-cl-uye@fira.test','QA Üye'),
  ('c1c1c1c1-0000-4000-8000-000000000002','qa-cl-izleyici@fira.test','QA İzleyici'),
  ('c1c1c1c1-0000-4000-8000-000000000003','qa-cl-yabanci@fira.test','QA Yabancı')
ON CONFLICT (id) DO NOTHING;
-- demo takım: üye ve izleyici (yabancı takımda değil)
INSERT INTO team_members (team_id, user_id, role) VALUES
  ('e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7','c1c1c1c1-0000-4000-8000-000000000001','member'),
  ('e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7','c1c1c1c1-0000-4000-8000-000000000002','viewer');

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN 'hata'; END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected = actual) $$;

-- demo görev "Ana sayfa tasarımı"
-- ── üye ──
SELECT pg_temp.as_user('c1c1c1c1-0000-4000-8000-000000000001');
SELECT pg_temp.chk('1a üye madde ekler', 'ok', pg_temp.try($$INSERT INTO ticket_checklist_items (id, ticket_id, title, order_index, created_by) VALUES ('c1c1c1c1-1111-4000-8000-000000000001','c5938b5e-70fd-4604-98dc-dfea31c98d4f','  Taslak  ',0,auth.uid())$$));
SELECT pg_temp.chk('1b başlık kırpılır', 'Taslak', (SELECT title FROM ticket_checklist_items WHERE id='c1c1c1c1-1111-4000-8000-000000000001'));
SELECT pg_temp.chk('1c başkası adına eklenemez', 'hata', pg_temp.try($$INSERT INTO ticket_checklist_items (ticket_id, title, created_by) VALUES ('c5938b5e-70fd-4604-98dc-dfea31c98d4f','x','c1c1c1c1-0000-4000-8000-000000000002')$$));
SELECT pg_temp.try($$UPDATE ticket_checklist_items SET done = true WHERE id='c1c1c1c1-1111-4000-8000-000000000001'$$);
SELECT pg_temp.chk('1d işaretleyen ve zaman yazılır', 'true/c1c1c1c1-0000-4000-8000-000000000001/true', (SELECT done::text || '/' || coalesce(done_by::text,'-') || '/' || (done_at IS NOT NULL)::text FROM ticket_checklist_items WHERE id='c1c1c1c1-1111-4000-8000-000000000001'));
SELECT pg_temp.try($$UPDATE ticket_checklist_items SET ticket_id='a0fbbf4d-8ab0-4610-9d88-8667656138d6' WHERE id='c1c1c1c1-1111-4000-8000-000000000001'$$);
SELECT pg_temp.chk('1e madde başka göreve taşınamaz', 'c5938b5e-70fd-4604-98dc-dfea31c98d4f', (SELECT ticket_id::text FROM ticket_checklist_items WHERE id='c1c1c1c1-1111-4000-8000-000000000001'));
SELECT pg_temp.chk('1f boş başlık olmaz', 'hata', pg_temp.try($$INSERT INTO ticket_checklist_items (ticket_id, title, created_by) VALUES ('c5938b5e-70fd-4604-98dc-dfea31c98d4f','   ',auth.uid())$$));

-- ── izleyici ──
SELECT pg_temp.as_user('c1c1c1c1-0000-4000-8000-000000000002');
SELECT pg_temp.chk('2a izleyici maddeyi görür', '1', (SELECT count(*)::text FROM ticket_checklist_items WHERE id='c1c1c1c1-1111-4000-8000-000000000001'));
SELECT pg_temp.chk('2b izleyici ekleyemez', 'hata', pg_temp.try($$INSERT INTO ticket_checklist_items (ticket_id, title, created_by) VALUES ('c5938b5e-70fd-4604-98dc-dfea31c98d4f','izleyici',auth.uid())$$));
SELECT pg_temp.try($$UPDATE ticket_checklist_items SET done = false WHERE id='c1c1c1c1-1111-4000-8000-000000000001'$$);
SELECT pg_temp.try($$DELETE FROM ticket_checklist_items WHERE id='c1c1c1c1-1111-4000-8000-000000000001'$$);
SELECT pg_temp.as_user('c1c1c1c1-0000-4000-8000-000000000001');
SELECT pg_temp.chk('2c izleyici değiştiremez ve silemez', '1/true', (SELECT count(*)::text || '/' || bool_and(done)::text FROM ticket_checklist_items WHERE id='c1c1c1c1-1111-4000-8000-000000000001'));

-- ── yabancı ──
SELECT pg_temp.as_user('c1c1c1c1-0000-4000-8000-000000000003');
SELECT pg_temp.chk('3a yabancı görmez', '0', (SELECT count(*)::text FROM ticket_checklist_items WHERE ticket_id='c5938b5e-70fd-4604-98dc-dfea31c98d4f'));
SELECT pg_temp.chk('3b yabancı ekleyemez', 'hata', pg_temp.try($$INSERT INTO ticket_checklist_items (ticket_id, title, created_by) VALUES ('c5938b5e-70fd-4604-98dc-dfea31c98d4f','yabancı',auth.uid())$$));

-- ── kopya ──
SELECT pg_temp.as_user('c1c1c1c1-0000-4000-8000-000000000001');
CREATE TEMP TABLE _copy (id uuid);
GRANT ALL ON _copy TO PUBLIC;
INSERT INTO _copy SELECT copy_ticket('c5938b5e-70fd-4604-98dc-dfea31c98d4f');
SELECT pg_temp.chk('4a kopyada madde var, işaretsiz', '1/false', (SELECT count(*)::text || '/' || bool_or(done)::text FROM ticket_checklist_items WHERE ticket_id = (SELECT id FROM _copy)));

-- ── üye siler ──
SELECT pg_temp.chk('5a üye siler', 'ok', pg_temp.try($$DELETE FROM ticket_checklist_items WHERE id='c1c1c1c1-1111-4000-8000-000000000001'$$));
SELECT pg_temp.chk('5b silindi', '0', (SELECT count(*)::text FROM ticket_checklist_items WHERE id='c1c1c1c1-1111-4000-8000-000000000001'));

SELECT pg_temp.as_user('c1c1c1c1-0000-4000-8000-000000000001');
SELECT step || ' | bekl: ' || expected || ' | gerçek: ' || coalesce(actual, 'null') || ' | ' || CASE WHEN ok THEN 'GEÇTİ' ELSE 'KALDI' END FROM _r;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' geçti' FROM _r;
ROLLBACK;
