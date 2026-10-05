-- Çalıştırma: sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -At < recurrence-tests.sql
-- Tüm işlem ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur.
-- Tekrarlayan görevleri (084/085) doğrular: kural motoru, takvim tetiği, kaçırılan tekrar kaydı,
-- tamamlanınca tetiği, şablondan kopyalananlar, hatırlatma ve RLS. 23 kontrol.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', (SELECT email FROM public.profiles WHERE id = u))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_owner() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'postgres', true); END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected IS NOT DISTINCT FROM actual) $$;
CREATE OR REPLACE FUNCTION pg_temp.loc(t timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT to_char(t AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI Dy') $$;

\set team '''dfe5563c-cb92-43f2-b030-d8f1e132bc10'''
\set claude '''b7b4c570-4b45-492e-9e02-5970c88ee48c'''
\set list '''ee000000-0000-4000-8000-000000000001'''
\set todo '''ee000000-0000-4000-8000-000000000011'''
\set done '''ee000000-0000-4000-8000-000000000012'''
\set tpl  '''ee000000-0000-4000-8000-000000000101'''
\set sub  '''ee000000-0000-4000-8000-000000000102'''

SELECT pg_temp.as_user(:claude);

-- ── 1) Kural motoru ──────────────────────────────────────────────────────────
SELECT pg_temp.chk('1a her cuma 12:00', '2026-09-25 12:00 Fri',
  pg_temp.loc(fira_next_occurrence('weekly', 1, ARRAY[5]::smallint[], NULL, '12:00', 'Europe/Istanbul', '2026-09-01', NULL, '2026-09-21 09:00+03')));
SELECT pg_temp.chk('1b iki haftada bir pazartesi', '2026-09-28 09:00 Mon',
  pg_temp.loc(fira_next_occurrence('weekly', 2, ARRAY[1]::smallint[], NULL, '09:00', 'Europe/Istanbul', '2026-09-14', NULL, '2026-09-21 09:00+03')));
SELECT pg_temp.chk('1c ayın 31i şubatı atlar', '2026-03-31',
  to_char(fira_next_occurrence('monthly', 1, NULL, 31::smallint, '10:00', 'Europe/Istanbul', '2026-01-31', NULL, '2026-01-31 12:00+03') AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD'));
SELECT pg_temp.chk('1d bitiş tarihi geçince yok', NULL,
  fira_next_occurrence('daily', 3, NULL, NULL, '08:00', 'Europe/Istanbul', '2026-09-21', '2026-09-22', '2026-09-25')::text);
SELECT pg_temp.chk('1e aynı gün saat geçmişse ertesi tekrar', '2026-09-22 08:00 Tue',
  pg_temp.loc(fira_next_occurrence('daily', 1, NULL, NULL, '08:00', 'Europe/Istanbul', '2026-09-01', NULL, '2026-09-21 09:00+03')));

-- ── Kurulum: liste, iki sütun, şablon görev + alt görev, etiket, atama ───────
INSERT INTO projects (id, team_id, name, created_by) VALUES (:list, :team, 'QA Tekrar Testi', auth.uid());
DELETE FROM ticket_statuses WHERE project_id = :list;
INSERT INTO ticket_statuses (id, project_id, name, color, order_index, category) VALUES
  (:todo, :list, 'Yapılacak', '#6366f1', 0, 'backlog'),
  (:done, :list, 'Tamamlandı', '#14b8a6', 1, 'done');
INSERT INTO tickets (id, project_id, status_id, title, description, priority, created_by, order_index) VALUES
  (:tpl, :list, :todo, 'Haftalık saat bildirimi', 'Cuma öğlene kadar', 'high', auth.uid(), 0);
INSERT INTO tickets (id, project_id, parent_id, status_id, title, created_by, order_index) VALUES
  (:sub, :list, :tpl, :todo, 'Saatleri kontrol et', auth.uid(), 0);
INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (:tpl, auth.uid());
INSERT INTO tags (id, project_id, name, color) VALUES ('ee000000-0000-4000-8000-000000000201', :list, 'rapor', '#f59e0b');
INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (:tpl, 'ee000000-0000-4000-8000-000000000201');

-- ── 2) Seri kurma ────────────────────────────────────────────────────────────
SELECT set_ticket_recurrence(:tpl, jsonb_build_object(
  'freq', 'weekly', 'interval', 1, 'byweekday', jsonb_build_array(5), 'at_time', '12:00',
  'tz', 'Europe/Istanbul', 'starts_on', '2026-09-01', 'trigger', 'schedule', 'reminder_minutes', 120)) AS rec \gset
SELECT pg_temp.chk('2a şablon 1. tekrar', '1', (SELECT occurrence_no::text FROM tickets WHERE id = :tpl));
SELECT pg_temp.chk('2b seri göreve bağlı', 'true', (SELECT (recurrence_id = :'rec')::text FROM tickets WHERE id = :tpl));
SELECT pg_temp.chk('2c sıradaki tekrar cuma', '2026-09-25 12:00 Fri',
  (SELECT pg_temp.loc(next_at) FROM ticket_recurrences WHERE id = :'rec'));
SELECT pg_temp.chk('2d alt görev seriye bağlanmaz', NULL, (SELECT recurrence_id::text FROM tickets WHERE id = :sub));

-- ── 3) Takvim tetiği: şablon kapalıyken yeni tekrar doğar ───────────────────
UPDATE tickets SET status_id = :done, status = 'Tamamlandı' WHERE id = :tpl;
UPDATE ticket_recurrences SET next_at = now() - interval '1 minute' WHERE id = :'rec';
SELECT pg_temp.as_owner();
SELECT generate_due_recurrences(:list) AS made \gset
SELECT pg_temp.as_user(:claude);
SELECT pg_temp.chk('3a bir görev üretildi', '1', :'made');
SELECT pg_temp.chk('3b üretilen görev listenin ilk sütununda', 'Yapılacak',
  (SELECT s.name FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id WHERE t.recurrence_id = :'rec' AND t.occurrence_no = 2));
SELECT pg_temp.chk('3c başlık şablondan', 'Haftalık saat bildirimi',
  (SELECT title FROM tickets WHERE recurrence_id = :'rec' AND occurrence_no = 2));
SELECT pg_temp.chk('3d atama kopyalandı', '1',
  (SELECT count(*)::text FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id WHERE t.recurrence_id = :'rec' AND t.occurrence_no = 2));
SELECT pg_temp.chk('3e etiket kopyalandı', '1',
  (SELECT count(*)::text FROM ticket_tag_assignments ta JOIN tickets t ON t.id = ta.ticket_id WHERE t.recurrence_id = :'rec' AND t.occurrence_no = 2));
SELECT pg_temp.chk('3f alt görev kopyalandı', '1',
  (SELECT count(*)::text FROM tickets c WHERE c.parent_id = (SELECT id FROM tickets WHERE recurrence_id = :'rec' AND occurrence_no = 2)));
SELECT pg_temp.chk('3g tekrar kaydı oluşturuldu', 'created',
  (SELECT outcome FROM recurrence_occurrences WHERE recurrence_id = :'rec' AND occurrence_no = 2));

-- ── 4) Açık görev dururken gelen tekrar kaçırıldı diye yazılır ──────────────
UPDATE ticket_recurrences SET next_at = now() - interval '1 minute' WHERE id = :'rec';
SELECT pg_temp.as_owner();
SELECT generate_due_recurrences(:list) AS made2 \gset
SELECT pg_temp.as_user(:claude);
SELECT pg_temp.chk('4a yeni görev üretilmedi', '0', :'made2');
SELECT pg_temp.chk('4b kaçırıldı kaydı düştü', 'missed',
  (SELECT outcome FROM recurrence_occurrences WHERE recurrence_id = :'rec' AND occurrence_no = 3));

-- ── 5) Hatırlatma ────────────────────────────────────────────────────────────
UPDATE recurrence_occurrences SET due_at = now() + interval '30 minutes' WHERE recurrence_id = :'rec' AND occurrence_no = 2;
SELECT pg_temp.as_owner();
SELECT send_due_reminders() AS rem \gset
SELECT send_due_reminders() AS rem2 \gset
SELECT pg_temp.as_user(:claude);
SELECT pg_temp.chk('5a bir hatırlatma gitti', '1', :'rem');
SELECT pg_temp.chk('5b ikinci turda tekrar gitmez', '0', :'rem2');
SELECT pg_temp.chk('5c aktivite satırı yazıldı', 'reminder',
  (SELECT kind FROM ticket_activity a JOIN tickets t ON t.id = a.ticket_id
    WHERE t.recurrence_id = :'rec' AND a.kind = 'reminder' LIMIT 1));

-- ── 6) Tamamlanınca tetiği ───────────────────────────────────────────────────
UPDATE ticket_recurrences SET trigger = 'completion', active = true WHERE id = :'rec';
UPDATE tickets SET status_id = :done, status = 'Tamamlandı'
 WHERE recurrence_id = :'rec' AND occurrence_no = 2;
SELECT pg_temp.chk('6a tamamlanınca sıradaki doğdu', '1',
  (SELECT count(*)::text FROM tickets WHERE recurrence_id = :'rec' AND occurrence_no = 4));

-- ── 7) RLS: başka takımdan biri seriyi göremez ──────────────────────────────
SELECT pg_temp.chk('7a yabancı seriyi görmez', '0', (
  SELECT count(*)::text FROM ticket_recurrences r
   WHERE r.id = :'rec' AND public.team_role(:team) IS NULL));

SELECT step, expected, actual, CASE WHEN ok THEN 'OK' ELSE 'FAIL' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS sonuc FROM _r;
ROLLBACK;
