-- Çalıştırma: sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -At < notification-tests.sql
-- Tüm işlem ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur.
-- Gelen kutusu dağıtımını (058 → 060 birleştirme → 062 sessize alma → 076 bahsetme
-- → 085 hatırlatma → 089 geri getirme → 090 katılma) doğrular. 089 bir gerilemeden
-- doğdu: 085 fonksiyonu 058'den kopyalayınca birleştirme sessizce kayboldu. 20 kontrol.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected IS NOT DISTINCT FROM actual) $$;
-- Alıcıya düşen satır sayısı ve son satırın sayacı.
CREATE OR REPLACE FUNCTION pg_temp.rows_for(u uuid, t uuid) RETURNS text LANGUAGE sql AS $$
  SELECT count(*)::text FROM public.user_notifications WHERE user_id = u AND ticket_id = t $$;
CREATE OR REPLACE FUNCTION pg_temp.last_for(u uuid, t uuid) RETURNS user_notifications LANGUAGE sql AS $$
  SELECT n.* FROM public.user_notifications n WHERE n.user_id = u AND n.ticket_id = t ORDER BY n.created_at DESC LIMIT 1 $$;
-- Aktivite yazıp id'sini döndürür (tetik dağıtımı burada çalışır).
CREATE OR REPLACE FUNCTION pg_temp.act(t uuid, who uuid, kind text, val text, meta jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, to_value, meta)
  VALUES (t, who, kind, val, meta) RETURNING id INTO v;
  RETURN v;
END $$;

\set team '''dfe5563c-cb92-43f2-b030-d8f1e132bc10'''
\set claude '''b7b4c570-4b45-492e-9e02-5970c88ee48c'''
\set human '''9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63'''
\set list '''ee000000-0000-4000-8000-000000000301'''
\set todo '''ee000000-0000-4000-8000-000000000311'''
\set tkt  '''ee000000-0000-4000-8000-000000000321'''
\set nteam '''ee000000-0000-4000-8000-000000000331'''
\set joiner '''33069d15-508a-4642-97d7-967aaceaadb9'''

-- ── Kurulum: görev Claude'un, atanan insan; aktör Claude → alıcı yalnız insan ──
INSERT INTO projects (id, team_id, name, created_by) VALUES (:list, :team, 'QA Bildirim Testi', :claude);
DELETE FROM ticket_statuses WHERE project_id = :list;
INSERT INTO ticket_statuses (id, project_id, name, color, order_index, category)
VALUES (:todo, :list, 'Yapılacak', '#6366f1', 0, 'backlog');
INSERT INTO tickets (id, project_id, status_id, title, created_by, order_index)
VALUES (:tkt, :list, :todo, 'Bildirim birleştirme', :claude, 0);
INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (:tkt, :human);
-- Kurulumun kendi atama bildirimi sayacı kaydırmasın: temiz başla.
DELETE FROM user_notifications WHERE ticket_id = :tkt;

-- ── 1) İlk olay tek satır açar ───────────────────────────────────────────────
SELECT pg_temp.act(:tkt, :claude, 'status', 'İncelemede');
SELECT pg_temp.chk('1a tek bildirim', '1', pg_temp.rows_for(:human, :tkt));
SELECT pg_temp.chk('1b sayac 1', '1', (pg_temp.last_for(:human, :tkt)).group_count::text);
SELECT pg_temp.chk('1c olay durum', 'status', (pg_temp.last_for(:human, :tkt)).event);
SELECT pg_temp.chk('1d aktore bildirim gitmez', '0', pg_temp.rows_for(:claude, :tkt));

-- ── 2) Aynı görev, 3 dk içinde: yeni satır değil, aynı satır ─────────────────
SELECT pg_temp.act(:tkt, :claude, 'comment_added', 'Yapıldı, incelemene bırakıyorum');
SELECT pg_temp.chk('2a hala tek satir', '1', pg_temp.rows_for(:human, :tkt));
SELECT pg_temp.chk('2b sayac 2', '2', (pg_temp.last_for(:human, :tkt)).group_count::text);
SELECT pg_temp.chk('2c baslik son olayi gosterir', 'comment', (pg_temp.last_for(:human, :tkt)).event);

-- ── 3) Okunmuş satır yeni değişiklikle tekrar okunmamış olur ────────────────
UPDATE user_notifications SET read_at = now() WHERE user_id = :human AND ticket_id = :tkt;
SELECT pg_temp.act(:tkt, :claude, 'assignee_added', NULL, jsonb_build_object('user_id', :human));
SELECT pg_temp.chk('3a hala tek satir', '1', pg_temp.rows_for(:human, :tkt));
SELECT pg_temp.chk('3b sayac 3', '3', (pg_temp.last_for(:human, :tkt)).group_count::text);
SELECT pg_temp.chk('3c tekrar okunmamis', 'true', ((pg_temp.last_for(:human, :tkt)).read_at IS NULL)::text);

-- ── 4) Pencere kapanınca yeni satır ─────────────────────────────────────────
UPDATE user_notifications SET created_at = now() - interval '5 minutes'
 WHERE user_id = :human AND ticket_id = :tkt;
SELECT pg_temp.act(:tkt, :claude, 'status', 'Tamamlandı');
SELECT pg_temp.chk('4a ikinci satir acildi', '2', pg_temp.rows_for(:human, :tkt));
SELECT pg_temp.chk('4b yeni satirin sayaci 1', '1', (pg_temp.last_for(:human, :tkt)).group_count::text);

-- ── 5) İçe aktarma satırı kutuya düşmez ─────────────────────────────────────
SELECT pg_temp.act(:tkt, :claude, 'status', 'Yapılacak', '{"bulk": true}'::jsonb);
SELECT pg_temp.chk('5 toplu aktarma sessiz', '2', pg_temp.rows_for(:human, :tkt));

-- ── 6) Sessize alınan görev bildirim üretmez ────────────────────────────────
INSERT INTO ticket_mutes (user_id, ticket_id) VALUES (:human, :tkt);
UPDATE user_notifications SET created_at = now() - interval '5 minutes'
 WHERE user_id = :human AND ticket_id = :tkt;
SELECT pg_temp.act(:tkt, :claude, 'comment_added', 'Sessizdeyken yazıldı');
SELECT pg_temp.chk('6 sessizde yeni satir yok', '2', pg_temp.rows_for(:human, :tkt));

-- ── 7) Davet kabul edilince davet eden ve yöneticiler haber alır (090) ──────
INSERT INTO teams (id, name, created_by) VALUES (:nteam, 'QA Katilma Testi', :claude);
DELETE FROM team_members WHERE team_id = :nteam;
INSERT INTO team_members (team_id, user_id, role) VALUES (:nteam, :claude, 'owner'), (:nteam, :human, 'member');
INSERT INTO team_invitations (id, team_id, email, invited_by, role)
VALUES ('ee000000-0000-4000-8000-000000000341', :nteam, 'qa-katilma@example.invalid', :human, 'member');
-- Davet edilenin kutusundaki satır (073) kabulden sonra düşmeli.
INSERT INTO user_notifications (user_id, team_id, invitation_id, event, actor_id, value, ticket_title)
VALUES (:joiner, :nteam, 'ee000000-0000-4000-8000-000000000341', 'team_invite', :human, 'member', 'QA Katilma Testi');

INSERT INTO team_members (team_id, user_id, role) VALUES (:nteam, :joiner, 'member');
UPDATE team_invitations SET status = 'accepted', accepted_by = :joiner, accepted_at = now()
 WHERE id = 'ee000000-0000-4000-8000-000000000341';

SELECT pg_temp.chk('7a davet edene haber', '1',
  (SELECT count(*)::text FROM user_notifications WHERE user_id = :human AND event = 'team_joined' AND team_id = :nteam));
SELECT pg_temp.chk('7b takim sahibine haber', '1',
  (SELECT count(*)::text FROM user_notifications WHERE user_id = :claude AND event = 'team_joined' AND team_id = :nteam));
SELECT pg_temp.chk('7c katilana haber yok', '0',
  (SELECT count(*)::text FROM user_notifications WHERE user_id = :joiner AND event = 'team_joined'));
SELECT pg_temp.chk('7d davet satiri dustu', '0',
  (SELECT count(*)::text FROM user_notifications WHERE event = 'team_invite' AND invitation_id = 'ee000000-0000-4000-8000-000000000341'));
SELECT pg_temp.chk('7e satirda takim adi ve rol', 'QA Katilma Testi|member',
  (SELECT ticket_title || '|' || value FROM user_notifications WHERE user_id = :claude AND event = 'team_joined' LIMIT 1));

-- ── 8) Reddedilen davet kimseye haber vermez ────────────────────────────────
INSERT INTO team_invitations (id, team_id, email, invited_by, role)
VALUES ('ee000000-0000-4000-8000-000000000342', :nteam, 'qa-ret@example.invalid', :claude, 'member');
UPDATE team_invitations SET status = 'declined' WHERE id = 'ee000000-0000-4000-8000-000000000342';
SELECT pg_temp.chk('8 ret sessiz', '0',
  (SELECT count(*)::text FROM user_notifications WHERE invitation_id = 'ee000000-0000-4000-8000-000000000342'));

SELECT step, expected, actual, ok FROM _r WHERE NOT ok;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS sonuc FROM _r;
ROLLBACK;
