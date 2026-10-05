-- Çalıştırma: base64 ile sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -At < ordering-tests.sql
-- Tüm işlem ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur.
-- Sütun içi sıralama kurallarını (045) doğrular: durum değişince en üste, sürükle-bırak sırası kalıcı,
-- filtreyle gizlenmiş kartlar araya karışmaz, alt görev durum değiştirince yerinde kalır (081). 21 kontrol.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', (SELECT email FROM public.profiles WHERE id = u))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected = actual) $$;
-- Sütunun görünen sırası: order_index, eşitlikte oluşturulma (istemcideki sıralamanın aynısı)
-- Not: parametreye `status` denemez — tickets tablosunda `status` adında bir kolon var, adı o gölgeler.
CREATE OR REPLACE FUNCTION pg_temp.col(p_status uuid) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(title, ',' ORDER BY order_index, created_at) FROM public.tickets WHERE status_id = p_status $$;

\set team '''dfe5563c-cb92-43f2-b030-d8f1e132bc10'''
\set claude '''b7b4c570-4b45-492e-9e02-5970c88ee48c'''
\set list '''dd000000-0000-4000-8000-000000000001'''
\set todo '''dd000000-0000-4000-8000-000000000011'''
\set done '''dd000000-0000-4000-8000-000000000012'''

SELECT pg_temp.as_user(:claude);

-- ── Kurulum: bir liste, iki sütun, üç görev ──────────────────────────────────
INSERT INTO projects (id, team_id, name, created_by) VALUES (:list, :team, 'QA Sıralama Testi', auth.uid());
DELETE FROM ticket_statuses WHERE project_id = :list;  -- varsayılan sütunlar bu testte istenmiyor
INSERT INTO ticket_statuses (id, project_id, name, color, order_index, category) VALUES
  (:todo, :list, 'Yapılacak', '#6366f1', 0, 'backlog'),
  (:done, :list, 'Tamamlandı', '#14b8a6', 1, 'done');

INSERT INTO tickets (id, project_id, status_id, title, created_by, order_index) VALUES
  ('dd000000-0000-4000-8000-000000000101', :list, :todo, 'A', auth.uid(), 0),
  ('dd000000-0000-4000-8000-000000000102', :list, :todo, 'B', auth.uid(), 1),
  ('dd000000-0000-4000-8000-000000000103', :list, :todo, 'C', auth.uid(), 2),
  ('dd000000-0000-4000-8000-000000000201', :list, :done, 'X', auth.uid(), 0),
  ('dd000000-0000-4000-8000-000000000202', :list, :done, 'Y', auth.uid(), 1);

SELECT pg_temp.chk('0a başlangıç Yapılacak', 'A,B,C', pg_temp.col(:todo));
SELECT pg_temp.chk('0b başlangıç Tamamlandı', 'X,Y', pg_temp.col(:done));

-- ── 1. Durum alanından taşıma → hedef sütunun en üstü ────────────────────────
UPDATE tickets SET status_id = :done WHERE id = 'dd000000-0000-4000-8000-000000000102';
SELECT pg_temp.chk('1a B tamamlandıya geçti, en üstte', 'B,X,Y', pg_temp.col(:done));
SELECT pg_temp.chk('1b kaynak sütun bozulmadı', 'A,C', pg_temp.col(:todo));
SELECT pg_temp.chk('1c order_index gerçekten küçüldü', 'true',
  (SELECT (order_index < (SELECT min(order_index) FROM tickets WHERE status_id = :done AND title <> 'B'))::text
     FROM tickets WHERE title = 'B'));

-- İkinci taşıma da en üste (yani "en son gelen en üstte")
UPDATE tickets SET status_id = :done WHERE id = 'dd000000-0000-4000-8000-000000000103';
SELECT pg_temp.chk('1d en son gelen en üstte', 'C,B,X,Y', pg_temp.col(:done));

-- ── 2. order_index'i açıkça veren çağrı (içe aktarma vb.) ezilmez ────────────
UPDATE tickets SET status_id = :todo, order_index = 99 WHERE id = 'dd000000-0000-4000-8000-000000000201';
SELECT pg_temp.chk('2a verilen order_index korunur', '99', (SELECT order_index::text FROM tickets WHERE title = 'X'));
SELECT pg_temp.chk('2b X en altta', 'A,X', pg_temp.col(:todo));

-- ── 3. Sürükle-bırak (RPC): verilen sıra aynen yazılır ───────────────────────
SELECT reorder_tickets('[{"status_id":"dd000000-0000-4000-8000-000000000012","ids":["dd000000-0000-4000-8000-000000000201","dd000000-0000-4000-8000-000000000103"]}]'::jsonb);
-- X hâlâ Yapılacak'ta değil: RPC onu Tamamlandı'ya taşıdı (sütunlar arası bırakma)
SELECT pg_temp.chk('3a RPC sırayı yazdı', 'X,C,B,Y', pg_temp.col(:done));
SELECT pg_temp.chk('3b sürüklenen kart en üste zıplamadı', '0', (SELECT order_index::text FROM tickets WHERE title = 'X'));
SELECT pg_temp.chk('3c listede olmayan kartlar altta', 'true',
  (SELECT (min(order_index) >= 2)::text FROM tickets WHERE status_id = :done AND title IN ('B','Y')));
SELECT pg_temp.chk('3d gizli kartların kendi sırası korundu', 'B,Y',
  (SELECT string_agg(title, ',' ORDER BY order_index) FROM tickets WHERE status_id = :done AND title IN ('B','Y')));

-- ── 4. Sütun içi sürükleme ───────────────────────────────────────────────────
SELECT reorder_tickets('[{"status_id":"dd000000-0000-4000-8000-000000000012","ids":["dd000000-0000-4000-8000-000000000103","dd000000-0000-4000-8000-000000000201","dd000000-0000-4000-8000-000000000102","dd000000-0000-4000-8000-000000000202"]}]'::jsonb);
SELECT pg_temp.chk('4a elle sıra kalıcı', 'C,X,B,Y', pg_temp.col(:done));

-- ── 5. Elle sıralanmış sütuna durum değişikliğiyle gelen görev en üste ───────
UPDATE tickets SET status_id = :done WHERE id = 'dd000000-0000-4000-8000-000000000101';
SELECT pg_temp.chk('5a yeni gelen en üstte, elle sıra bozulmadı', 'A,C,X,B,Y', pg_temp.col(:done));

-- ── 6. "Kapatılanları gizle" senaryosu ───────────────────────────────────────
-- Pano yalnızca A'yı görüyor (diğerleri filtreyle gizli) ve A başka sütuna sürükleniyor;
-- ardından gizli kartlar gösterildiğinde en son bırakılan kart en üstte kalmalı.
SELECT reorder_tickets('[{"status_id":"dd000000-0000-4000-8000-000000000011","ids":[]},
                         {"status_id":"dd000000-0000-4000-8000-000000000012","ids":["dd000000-0000-4000-8000-000000000101"]}]'::jsonb);
SELECT pg_temp.chk('6a bırakılan kart en üstte', 'A,C,X,B,Y', pg_temp.col(:done));
SELECT pg_temp.chk('6b gizli kartlar sırasını korudu', 'C,X,B,Y',
  (SELECT string_agg(title, ',' ORDER BY order_index) FROM tickets WHERE status_id = :done AND title <> 'A'));
SELECT pg_temp.chk('6c order_index çakışması yok', '5',
  (SELECT count(DISTINCT order_index)::text FROM tickets WHERE status_id = :done));

-- ── 7. RPC yetkisi ───────────────────────────────────────────────────────────
SELECT pg_temp.chk('7a anon çalıştıramaz', 'false',
  (SELECT has_function_privilege('anon', 'public.reorder_tickets(jsonb)', 'execute')::text));
SELECT pg_temp.chk('7b authenticated çalıştırabilir', 'true',
  (SELECT has_function_privilege('authenticated', 'public.reorder_tickets(jsonb)', 'execute')::text));

-- ── 8. Alt görev durum değiştirince yerinde kalır (081, #9da49444) ──────────
-- Alt görevin order_index'i üst görevin alt görev listesindeki sırası; "en üste" kuralı ona uygulanmaz.
INSERT INTO tickets (id, project_id, status_id, title, created_by, order_index, parent_id) VALUES
  ('dd000000-0000-4000-8000-000000000301', :list, :todo, 'P', auth.uid(), 10, NULL);
INSERT INTO tickets (id, project_id, status_id, title, created_by, order_index, parent_id) VALUES
  ('dd000000-0000-4000-8000-000000000302', :list, :todo, 'S1', auth.uid(), 0, 'dd000000-0000-4000-8000-000000000301'),
  ('dd000000-0000-4000-8000-000000000303', :list, :todo, 'S2', auth.uid(), 1, 'dd000000-0000-4000-8000-000000000301');
UPDATE tickets SET status_id = :done WHERE id = 'dd000000-0000-4000-8000-000000000303';
SELECT pg_temp.chk('8a tamamlanan alt görevin sırası korundu', '1', (SELECT order_index::text FROM tickets WHERE title = 'S2'));
SELECT pg_temp.chk('8b alt görev listesi aynı sırada', 'S1,S2',
  (SELECT string_agg(title, ',' ORDER BY order_index, created_at) FROM tickets WHERE parent_id = 'dd000000-0000-4000-8000-000000000301'));

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SELECT step || ' | bekl: ' || expected || ' | gerçek: ' || actual || ' | ' || CASE WHEN ok THEN 'GEÇTİ' ELSE '*** KALDI ***' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' kontrol geçti' FROM _r;

ROLLBACK;
