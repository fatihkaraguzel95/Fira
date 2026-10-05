-- Çalıştırma: base64 ile sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -At < role-tests.sql
-- Tüm işlem ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur. 24 kontrol: davetler, üye/izleyici yetkileri, rol değişimi, sahiplik devri.
-- Role / invitation end-to-end tests with simulated JWTs (RLS + RPCs). Everything is rolled back at the end.
-- Every mutation runs inside a DO block (implicit savepoint) so an RLS denial does not abort the transaction.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-uye@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
       ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-izleyici@fira.test','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}');
INSERT INTO profiles (id, email, full_name) VALUES ('11111111-1111-4111-8111-111111111111','qa-uye@fira.test','QA Üye'), ('22222222-2222-4222-8222-222222222222','qa-izleyici@fira.test','QA İzleyici')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_email text;
BEGIN
  -- E-postayı sahibin yetkisiyle oku: `authenticated` iken profil görünürlüğü
  -- (052 `can_see_profile`) henüz takıma girmemiş kullanıcıyı gizliyor ve
  -- jeton e-postasız kalıyordu; o zaman davet eşleşmiyor ve zincirin kalanı
  -- düşüyordu (7 kontrol). Test kurgusunun hatasıydı, ürünün değil.
  PERFORM set_config('role', 'postgres', true);
  SELECT email INTO v_email FROM public.profiles WHERE id = u;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', v_email)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
-- run one statement as the given user, swallowing RLS errors; records nothing itself
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN 'hata: ' || left(SQLERRM, 60); END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected = actual) $$;

-- ── 1. E-mail invitation ─────────────────────────────────────────────────────
SELECT pg_temp.as_user('9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63');
SELECT pg_temp.try($$INSERT INTO team_invitations (id, team_id, email, role, invited_by, token) VALUES ('aaaaaaaa-0000-4000-8000-000000000001','dfe5563c-cb92-43f2-b030-d8f1e132bc10','qa-uye@fira.test','member',auth.uid(),'qa-token-member-1')$$);
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111');
SELECT pg_temp.chk('1a üye bekleyen daveti görür', '1', (SELECT count(*)::text FROM my_pending_invitations()));
SELECT pg_temp.try($$SELECT accept_invitation_by_id('aaaaaaaa-0000-4000-8000-000000000001')$$);
SELECT pg_temp.chk('1b kabul sonrası rol', 'member', (SELECT coalesce(max(role),'yok') FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='11111111-1111-4111-8111-111111111111'));

-- ── 2. Link invitation (viewer) ──────────────────────────────────────────────
SELECT pg_temp.as_user('9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63');
SELECT pg_temp.try($$INSERT INTO team_invitations (id, team_id, email, role, invited_by, token) VALUES ('aaaaaaaa-0000-4000-8000-000000000002','dfe5563c-cb92-43f2-b030-d8f1e132bc10',NULL,'viewer',auth.uid(),'qa-token-link-2')$$);
SELECT pg_temp.as_user('22222222-2222-4222-8222-222222222222');
SELECT pg_temp.chk('2a link önizlemesi (takım/rol/geçerli)', 'PARS/viewer/true', (SELECT team_name || '/' || role || '/' || valid::text FROM invitation_preview('qa-token-link-2')));
SELECT pg_temp.try($$SELECT accept_invitation('qa-token-link-2')$$);
SELECT pg_temp.chk('2b link ile katılım rolü', 'viewer', (SELECT coalesce(max(role),'yok') FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='22222222-2222-4222-8222-222222222222'));

-- ── 3. Member permissions (against a ticket created by the OWNER in this tx) ──
SELECT pg_temp.as_user('9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63');
SELECT pg_temp.chk('3z sahip test ticketı oluşturur', 'ok', pg_temp.try($$INSERT INTO tickets (id, title, status, status_id, project_id, created_by) VALUES ('cccccccc-0000-4000-8000-000000000001','QA sahip ticket','Yapılacak','e56ecdd5-c2e8-4ef1-af64-8180d5e4ad37','69b17648-6b31-4dd9-874e-d11c85b0fb63',auth.uid())$$));
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111');
SELECT pg_temp.try($$INSERT INTO tickets (id, title, status, status_id, project_id, created_by) VALUES ('bbbbbbbb-0000-4000-8000-000000000001','QA üye ticket','Yapılacak','e56ecdd5-c2e8-4ef1-af64-8180d5e4ad37','69b17648-6b31-4dd9-874e-d11c85b0fb63',auth.uid())$$);
SELECT pg_temp.chk('3a üye kendi ticketını oluşturur', '1', (SELECT count(*)::text FROM tickets WHERE id='bbbbbbbb-0000-4000-8000-000000000001'));
SELECT pg_temp.try($$DELETE FROM tickets WHERE id = 'cccccccc-0000-4000-8000-000000000001'$$);
SELECT pg_temp.chk('3b üye BAŞKASININ ticketını silemez', '1', (SELECT count(*)::text FROM tickets WHERE id='cccccccc-0000-4000-8000-000000000001'));
SELECT pg_temp.try($$UPDATE tickets SET title = 'QA üye düzenledi' WHERE id = 'cccccccc-0000-4000-8000-000000000001'$$);
SELECT pg_temp.chk('3c üye başkasının ticketını düzenler', 'QA üye düzenledi', (SELECT coalesce(max(title),'yok') FROM tickets WHERE id='cccccccc-0000-4000-8000-000000000001'));
SELECT pg_temp.try($$DELETE FROM tickets WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$);
SELECT pg_temp.chk('3d üye kendi ticketını siler', '0', (SELECT count(*)::text FROM tickets WHERE id='bbbbbbbb-0000-4000-8000-000000000001'));

-- ── 4. Viewer permissions ────────────────────────────────────────────────────
SELECT pg_temp.as_user('22222222-2222-4222-8222-222222222222');
SELECT pg_temp.try($$INSERT INTO tickets (title, status, status_id, project_id, created_by) VALUES ('QA izleyici ticket','Yapılacak','e56ecdd5-c2e8-4ef1-af64-8180d5e4ad37','69b17648-6b31-4dd9-874e-d11c85b0fb63',auth.uid())$$);
SELECT pg_temp.chk('4a izleyici ticket oluşturamaz', '0', (SELECT count(*)::text FROM tickets WHERE title='QA izleyici ticket'));
SELECT pg_temp.try($$INSERT INTO ticket_statuses (project_id, name, color, order_index) VALUES ('69b17648-6b31-4dd9-874e-d11c85b0fb63','QA izleyici durum','#000000',99)$$);
SELECT pg_temp.chk('4b izleyici durum oluşturamaz', '0', (SELECT count(*)::text FROM ticket_statuses WHERE name='QA izleyici durum'));
SELECT pg_temp.try($$UPDATE tickets SET status_id = 'fc4f34be-a903-40b5-8b59-d22737cb45ce' WHERE id = 'cccccccc-0000-4000-8000-000000000001'$$);
SELECT pg_temp.chk('4c izleyici ticket taşıyamaz', 'e56ecdd5', (SELECT left(coalesce(max(status_id::text),'yok'),8) FROM tickets WHERE id='cccccccc-0000-4000-8000-000000000001'));
SELECT pg_temp.try($$INSERT INTO ticket_comments (ticket_id, author_id, content) VALUES ('cccccccc-0000-4000-8000-000000000001', auth.uid(), 'QA izleyici yorumu')$$);
SELECT pg_temp.chk('4d izleyici yorum yazabilir', '1', (SELECT count(*)::text FROM ticket_comments WHERE content='QA izleyici yorumu'));
SELECT pg_temp.chk('4e izleyici takım üyelerini görür', 'true', (SELECT (count(*) > 0)::text FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10'));
SELECT pg_temp.chk('4f izleyici başka takımı göremez', '0', (SELECT count(*)::text FROM team_members WHERE team_id='5cd68abc-a1b4-4c86-a49e-31c9a0f13f9d'));

-- ── 5. Role changes ──────────────────────────────────────────────────────────
SELECT pg_temp.as_user('b7b4c570-4b45-492e-9e02-5970c88ee48c');
SELECT pg_temp.try($$UPDATE team_members SET role = 'member' WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63'$$);
SELECT pg_temp.chk('5a yönetici sahibi değiştiremez', 'owner', (SELECT coalesce(max(role),'yok') FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63'));
SELECT pg_temp.try($$UPDATE team_members SET role = 'viewer' WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='11111111-1111-4111-8111-111111111111'$$);
SELECT pg_temp.chk('5b yönetici üyenin rolünü değiştirir', 'viewer', (SELECT coalesce(max(role),'yok') FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='11111111-1111-4111-8111-111111111111'));
SELECT pg_temp.try($$UPDATE team_members SET role = 'owner' WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='b7b4c570-4b45-492e-9e02-5970c88ee48c'$$);
SELECT pg_temp.chk('5c yönetici kendini sahip yapamaz', 'admin', (SELECT coalesce(max(role),'yok') FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='b7b4c570-4b45-492e-9e02-5970c88ee48c'));
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111');
SELECT pg_temp.try($$UPDATE team_members SET role = 'admin' WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='11111111-1111-4111-8111-111111111111'$$);
SELECT pg_temp.chk('5d izleyici kendi rolünü yükseltemez', 'viewer', (SELECT coalesce(max(role),'yok') FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='11111111-1111-4111-8111-111111111111'));
SELECT pg_temp.chk('5e team_members doğrudan INSERT engellenir', 'hata', (SELECT left(pg_temp.try($$INSERT INTO team_members (team_id, user_id, role) VALUES ('dfe5563c-cb92-43f2-b030-d8f1e132bc10','11111111-1111-4111-8111-111111111111','admin')$$), 4)));

-- ── 6. Ownership transfer ────────────────────────────────────────────────────
SELECT pg_temp.as_user('b7b4c570-4b45-492e-9e02-5970c88ee48c');
SELECT pg_temp.chk('6a yönetici devir RPC çağıramaz', 'hata', (SELECT left(pg_temp.try($$SELECT transfer_team_ownership('dfe5563c-cb92-43f2-b030-d8f1e132bc10','b7b4c570-4b45-492e-9e02-5970c88ee48c')$$), 4)));
SELECT pg_temp.as_user('9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63');
SELECT pg_temp.chk('6b sahip devri çalışır', 'ok', pg_temp.try($$SELECT transfer_team_ownership('dfe5563c-cb92-43f2-b030-d8f1e132bc10','b7b4c570-4b45-492e-9e02-5970c88ee48c')$$));
SELECT pg_temp.chk('6c yeni sahip', 'owner', (SELECT coalesce(max(role),'yok') FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='b7b4c570-4b45-492e-9e02-5970c88ee48c'));
SELECT pg_temp.chk('6d eski sahip yönetici olur', 'admin', (SELECT coalesce(max(role),'yok') FROM team_members WHERE team_id='dfe5563c-cb92-43f2-b030-d8f1e132bc10' AND user_id='9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63'));

-- ── 7. Bağlı kayıtları olan görev silinebilmeli (044) ───────────────────────
-- Aktivite tetikleyicileri, silinen görev için günlük yazmaya kalkıp yabancı
-- anahtar hatası veriyordu; atanan/yorumu olan görevler silinemiyordu.
SELECT pg_temp.as_user('9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63');
SELECT pg_temp.try($$INSERT INTO tickets (id,title,status,status_id,project_id,created_by,updated_by)
  VALUES ('dd000000-0000-4000-8000-000000000001','QA silme testi','Devam Ediyor','fc4f34be-a903-40b5-8b59-d22737cb45ce','69b17648-6b31-4dd9-874e-d11c85b0fb63',auth.uid(),auth.uid())$$);
SELECT pg_temp.try($$INSERT INTO tickets (id,title,status,status_id,project_id,parent_id,created_by,updated_by)
  VALUES ('dd000000-0000-4000-8000-000000000002','QA alt görev','Devam Ediyor','fc4f34be-a903-40b5-8b59-d22737cb45ce','69b17648-6b31-4dd9-874e-d11c85b0fb63','dd000000-0000-4000-8000-000000000001',auth.uid(),auth.uid())$$);
SELECT pg_temp.try($$INSERT INTO ticket_assignees (ticket_id,user_id) VALUES ('dd000000-0000-4000-8000-000000000001',auth.uid())$$);
SELECT pg_temp.try($$INSERT INTO ticket_comments (ticket_id,author_id,content) VALUES ('dd000000-0000-4000-8000-000000000001',auth.uid(),'yorum')$$);
SELECT pg_temp.chk('7a atanan ve yorumu olan görev silinir', 'ok',
  pg_temp.try($$DELETE FROM tickets WHERE id='dd000000-0000-4000-8000-000000000001'$$));
SELECT pg_temp.chk('7b alt görev de gitti', '0',
  (SELECT count(*)::text FROM tickets WHERE id::text LIKE 'dd000000%'));

SET LOCAL role = postgres;
SELECT CASE WHEN ok THEN 'OK   ' ELSE 'FAIL ' END || step || '  [beklenen: ' || expected || ' · gerçek: ' || actual || ']' FROM _r ORDER BY step;
SELECT 'ÖZET: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' geçti' FROM _r;
ROLLBACK;
