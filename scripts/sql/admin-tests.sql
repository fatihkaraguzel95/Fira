-- Çalıştırma: sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -At < admin-tests.sql
-- Tüm işlem ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur.
-- Yönetici paneli RPC'lerini doğrular (091): kullanıcının izi, silme koruma
-- kuralları, içerik devri, "bugün" metrikleri ve özellik ısı haritası. 19 kontrol.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected IS NOT DISTINCT FROM actual) $$;
/** Bir çağrının hata verip vermediğini yakalar: beklenen hatayı da sınıyoruz. */
CREATE OR REPLACE FUNCTION pg_temp.fails(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN 'hata yok';
EXCEPTION WHEN OTHERS THEN RETURN 'hata';
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_admin(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

\set admin '''9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63'''
\set keep  '''b7b4c570-4b45-492e-9e02-5970c88ee48c'''
\set ghost '''ee000000-0000-4000-8000-000000000401'''
\set team  '''dfe5563c-cb92-43f2-b030-d8f1e132bc10'''
\set list  '''ee000000-0000-4000-8000-000000000411'''
\set todo  '''ee000000-0000-4000-8000-000000000412'''
\set tkt   '''ee000000-0000-4000-8000-000000000413'''

-- ── Kurulum: içe aktarmayla açılmış gibi bir profil (oturumu yok) ───────────
INSERT INTO profiles (id, email, full_name, source) VALUES (:ghost, NULL, 'QA Hayalet', 'import');
INSERT INTO projects (id, team_id, name, created_by) VALUES (:list, :team, 'QA Yonetici Testi', :ghost);
INSERT INTO ticket_statuses (id, project_id, name, color, order_index, category)
VALUES (:todo, :list, 'Yapilacak', '#6366f1', 0, 'backlog');
INSERT INTO tickets (id, project_id, status_id, title, created_by, order_index)
VALUES (:tkt, :list, :todo, 'Hayaletin gorevi', :ghost, 0);
INSERT INTO ticket_comments (ticket_id, author_id, content) VALUES (:tkt, :ghost, 'Hayaletin yorumu');
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :ghost, 'member')
  ON CONFLICT (team_id, user_id) DO NOTHING;

SELECT pg_temp.as_admin(:admin);

-- ── 1) İz ───────────────────────────────────────────────────────────────────
SELECT pg_temp.chk('1a gorev sayisi', '1', (admin_user_footprint(:ghost))->>'tickets');
SELECT pg_temp.chk('1b yorum sayisi', '1', (admin_user_footprint(:ghost))->>'comments');
SELECT pg_temp.chk('1c liste sayisi', '1', (admin_user_footprint(:ghost))->>'projects');
SELECT pg_temp.chk('1d icerik toplami', '3', (admin_user_footprint(:ghost))->>'content');
SELECT pg_temp.chk('1e uyelik', '1', (admin_user_footprint(:ghost))->>'memberships');

-- ── 2) Koruma kuralları ─────────────────────────────────────────────────────
SELECT pg_temp.chk('2a icerik varken devirsiz silinmez', 'hata',
  pg_temp.fails(format('SELECT admin_delete_user(%L)', :ghost)));
SELECT pg_temp.chk('2b kendini silemez', 'hata',
  pg_temp.fails(format('SELECT admin_delete_user(%L, %L)', :admin, :keep)));
SELECT pg_temp.chk('2c yonetici silinemez', 'hata',
  pg_temp.fails(format('SELECT admin_delete_user(%L, %L)', :admin, :ghost)));
SELECT pg_temp.chk('2d ayni kisiye devir olmaz', 'hata',
  pg_temp.fails(format('SELECT admin_delete_user(%L, %L)', :ghost, :ghost)));
SELECT pg_temp.chk('2e silinmedi', '1', (SELECT count(*)::text FROM profiles WHERE id = :ghost));

-- ── 3) Devrederek silme ─────────────────────────────────────────────────────
SELECT admin_delete_user(:ghost, :keep) AS res \gset
SELECT pg_temp.chk('3a profil gitti', '0', (SELECT count(*)::text FROM profiles WHERE id = :ghost));
SELECT pg_temp.chk('3b gorev devredildi', '1',
  (SELECT count(*)::text FROM tickets WHERE id = :tkt AND created_by = :keep));
SELECT pg_temp.chk('3c yorum devredildi', '1',
  (SELECT count(*)::text FROM ticket_comments WHERE ticket_id = :tkt AND author_id = :keep));
SELECT pg_temp.chk('3d liste devredildi', '1',
  (SELECT count(*)::text FROM projects WHERE id = :list AND created_by = :keep));
SELECT pg_temp.chk('3e uyelik silindi', '0',
  (SELECT count(*)::text FROM team_members WHERE user_id = :ghost));
SELECT pg_temp.chk('3f denetim kaydi', '1',
  (SELECT count(*)::text FROM admin_audit WHERE action = 'delete_user' AND target = 'QA Hayalet'));

-- ── 4) Metrikler ve ısı haritası ────────────────────────────────────────────
SELECT pg_temp.chk('4a bugun tek gun', '1', jsonb_array_length((admin_metrics(0))->'series')::text);
SELECT pg_temp.chk('4b isi haritasi her ozelligi listeler', '19',
  jsonb_array_length((admin_feature_usage(7))->'features')::text);
SELECT pg_temp.chk('4c 7 gun = 7 sutun', '7',
  jsonb_array_length((admin_feature_usage(7))->'dates')::text);

SELECT step, expected, actual, ok FROM _r WHERE NOT ok;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS sonuc FROM _r;
ROLLBACK;
