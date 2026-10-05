-- Arama · türe göre: sayfa, çizim, whiteboard (114, #570e41ee).
-- Çalıştırma: docker exec -i supabase-db psql -U postgres -d postgres -At < palette-kind-tests.sql
-- Her şey ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur. Demo takım "Fira Tanıtım" ve yalnız
-- bu işlemde yaşayan iki deneme hesabı (betası açık / kapalı) ile üç sayfa satırı kullanılır.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

\set team   '''e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7'''
\set beta   '''a9e17200-0000-4000-8000-000000000011'''
\set duz    '''a9e17200-0000-4000-8000-000000000012'''
\set sayfa  '''a9e17200-0000-4000-8000-0000000000c1'''
\set cizim  '''a9e17200-0000-4000-8000-0000000000c2'''
\set tahta  '''a9e17200-0000-4000-8000-0000000000c3'''

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
  FROM (VALUES (:beta::uuid, 'qa-pk-beta@fira.test'), (:duz::uuid, 'qa-pk-duz@fira.test')) v(id, mail);
INSERT INTO profiles (id, email, full_name) VALUES (:beta, 'qa-pk-beta@fira.test', 'QA Beta'), (:duz, 'qa-pk-duz@fira.test', 'QA Düz') ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :beta, 'member'), (:team, :duz, 'member');
INSERT INTO user_preferences (user_id, scope, prefs) VALUES (:beta, 'global', '{"beta": {"drawing": true, "whiteboard": true}}');
-- Üçünün de adında aynı uydurma kelime var: arama yalnız bunları bulur.
INSERT INTO pages (id, team_id, kind, title, created_by) VALUES
  (:sayfa, :team, 'page', 'Zorpkelime toplantı notu', :beta),
  (:cizim, :team, 'drawing', 'Zorpkelime akış çizimi', :beta),
  (:tahta, :team, 'whiteboard', 'Zorpkelime retro tahtası', :beta);

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
-- Bir aramanın sonucu: "tür/işaret:başlığın son kelimesi", başlığa göre sıralı.
CREATE OR REPLACE FUNCTION pg_temp.hits(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(kind || '/' || coalesce(icon, '-') || ':' || split_part(title, ' ', array_length(string_to_array(title, ' '), 1)), ' | ' ORDER BY title), 'yok')
    FROM public.palette_search(p || '{"terms": ["zorpkelime"]}'::jsonb) $$;

SELECT pg_temp.as_user(:beta);
SELECT pg_temp.chk('1a tür verilmeyince üçü de gelir, hepsi sayfa türünde, işaretleri ayrı', 'page/drawing:çizimi | page/whiteboard:tahtası | page/-:notu', pg_temp.hits('{}'));
SELECT pg_temp.chk('1b tür:sayfa yalnız yazı sayfasını getirir', 'page/-:notu', pg_temp.hits('{"kinds": ["page"]}'));
SELECT pg_temp.chk('1c tür:çizim yalnız çizimi getirir', 'page/drawing:çizimi', pg_temp.hits('{"kinds": ["drawing"]}'));
SELECT pg_temp.chk('1d tür:whiteboard yalnız whiteboard''u getirir', 'page/whiteboard:tahtası', pg_temp.hits('{"kinds": ["whiteboard"]}'));
SELECT pg_temp.chk('1e iki tür birlikte', 'page/drawing:çizimi | page/whiteboard:tahtası', pg_temp.hits('{"kinds": ["drawing", "whiteboard"]}'));
SELECT pg_temp.chk('1f tür:görev bunların hiçbirini getirmez', 'yok', pg_temp.hits('{"kinds": ["ticket"]}'));
SELECT pg_temp.chk('1g takım kimliğiyle daraltınca da aynı', 'page/drawing:çizimi', pg_temp.hits(jsonb_build_object('kinds', jsonb_build_array('drawing'), 'team_id', :team)));
SELECT pg_temp.chk('1h hariç tutulan kelime çizimde de çalışır', 'page/whiteboard:tahtası', pg_temp.hits('{"kinds": ["drawing", "whiteboard"], "not": ["akış"]}'));

-- Kelime yazmadan, yalnız türle: o türün öğeleri listelenir (önce: kelimesiz arama yalnız görev listelerdi).
CREATE OR REPLACE FUNCTION pg_temp.only(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT count(*) || ' sonuç, işaretler: ' || coalesce(string_agg(DISTINCT kind || '/' || coalesce(icon, '-'), ',' ORDER BY kind || '/' || coalesce(icon, '-')), 'yok')
         || ', deneme öğesi: ' || (count(*) FILTER (WHERE title LIKE 'Zorpkelime%') > 0)::text
    FROM public.palette_search(p) $$;
SELECT pg_temp.chk('1i yalnız tür:çizim: yalnız çizimler, deneme çizimi aralarında', 'true', (SELECT (pg_temp.only('{"kinds": ["drawing"]}') ~ '^[1-9][0-9]* sonuç, işaretler: page/drawing, deneme öğesi: true$')::text));
SELECT pg_temp.chk('1j yalnız tür:whiteboard: yalnız whiteboard''lar', 'true', (SELECT (pg_temp.only('{"kinds": ["whiteboard"]}') ~ '^[1-9][0-9]* sonuç, işaretler: page/whiteboard, deneme öğesi: true$')::text));
SELECT pg_temp.chk('1k yalnız tür:sayfa: yalnız yazı sayfaları', 'true', (SELECT (pg_temp.only('{"kinds": ["page"]}') ~ '^[1-9][0-9]* sonuç, işaretler: page/-, deneme öğesi: true$')::text));
SELECT pg_temp.chk('1l en yeni önce gelir', 'Zorpkelime retro tahtası', (SELECT title FROM public.palette_search('{"kinds": ["whiteboard"]}'::jsonb) LIMIT 1));
SELECT pg_temp.chk('1m tür de kelime de yokken sayfa listelenmez (yalnız görev süzgeçleri içindir)', '0', (SELECT count(*)::text FROM public.palette_search('{"priority": "high"}'::jsonb) WHERE kind = 'page'));
SELECT pg_temp.chk('1n göreve özgü süzgeç varken tür:çizim boş döner', '0', (SELECT count(*)::text FROM public.palette_search('{"kinds": ["drawing"], "priority": "high"}'::jsonb)));

-- Betası kapalı üye çizim ve whiteboard'u hiç görmez (RLS); arama da göstermez.
SELECT pg_temp.as_user(:duz);
SELECT pg_temp.chk('2a betası kapalı üye yalnız yazı sayfasını bulur', 'page/-:notu', pg_temp.hits('{}'));
SELECT pg_temp.chk('2b türü adıyla istese de bulamaz', 'yok', pg_temp.hits('{"kinds": ["drawing", "whiteboard"]}'));

-- Çöpteki öğe gelmez.
SELECT pg_temp.as_admin();
UPDATE pages SET archived_at = now() WHERE id = :cizim;
SELECT pg_temp.as_user(:beta);
SELECT pg_temp.chk('3a çöpteki çizim gelmez', 'yok', pg_temp.hits('{"kinds": ["drawing"]}'));

-- Görev ve liste araması değişmedi: tür verilmeyince görevler de gelir.
SELECT pg_temp.chk('4a tür verilmeyen aramada görevler hâlâ var', 'true', (SELECT (count(*) FILTER (WHERE kind = 'ticket') > 0)::text FROM public.palette_search('{"terms": ["ana", "sayfa"]}'::jsonb)));
SELECT pg_temp.chk('4b tür:liste listeleri getirir', 'true', (SELECT (count(*) > 0 AND bool_and(kind = 'project'))::text FROM public.palette_search('{"terms": ["web"], "kinds": ["project"]}'::jsonb)));

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SELECT step || ' | bekl: ' || expected || ' | gerçek: ' || actual || ' | ' || CASE WHEN ok THEN 'GEÇTİ' ELSE '*** KALDI ***' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' kontrol geçti' FROM _r;

ROLLBACK;
