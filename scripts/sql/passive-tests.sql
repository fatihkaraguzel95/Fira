-- Pasif işler · görseldeki metin (110, #1c2ace54) — ayar, sıra, üstlenme ve sonuç testleri.
-- Çalıştırma: docker exec -i supabase-db psql -U postgres -d postgres -At < passive-tests.sql
-- Her şey ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur. Demo takım "Fira Tanıtım",
-- onun bir görevi ve yalnız bu işlemde yaşayan deneme hesapları kullanılır.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

\set team     '''e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7'''
\set ticket   '''c5938b5e-70fd-4604-98dc-dfea31c98d4f'''
\set uye      '''a9e17000-0000-4000-8000-000000000011'''
\set yonetici '''a9e17000-0000-4000-8000-000000000012'''
\set yabanci  '''a9e17000-0000-4000-8000-000000000013'''
\set ajan     '''a9e17000-0000-4000-8000-0000000000b1'''
\set ajan2    '''a9e17000-0000-4000-8000-0000000000b2'''
\set disajan  '''a9e17000-0000-4000-8000-0000000000b3'''

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
  FROM (VALUES (:uye::uuid, 'qa-ps-uye@fira.test'), (:yonetici::uuid, 'qa-ps-yon@fira.test'), (:yabanci::uuid, 'qa-ps-yab@fira.test'),
               (:ajan::uuid, 'qa-ps-ajan@fira.test'), (:ajan2::uuid, 'qa-ps-ajan2@fira.test'), (:disajan::uuid, 'qa-ps-dis@fira.test')) v(id, mail);
INSERT INTO profiles (id, email, full_name) VALUES
  (:uye, 'qa-ps-uye@fira.test', 'QA Üye'), (:yonetici, 'qa-ps-yon@fira.test', 'QA Yönetici'), (:yabanci, 'qa-ps-yab@fira.test', 'QA Yabancı'),
  (:ajan, 'qa-ps-ajan@fira.test', 'QA Ajan'), (:ajan2, 'qa-ps-ajan2@fira.test', 'QA Ajan 2'), (:disajan, 'qa-ps-dis@fira.test', 'QA Dış Ajan')
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET is_ai = true WHERE id IN (:ajan, :ajan2, :disajan);
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :uye, 'member'), (:team, :yonetici, 'admin'), (:team, :ajan, 'member'), (:team, :ajan2, 'member');
INSERT INTO agents (profile_id, owner_id) VALUES (:ajan, :uye), (:ajan2, :yonetici), (:disajan, :yabanci);

-- Demo takımın mevcut görselleri deneme dışında kalsın: okunmuş sayılırlar.
DELETE FROM ai_team_passive WHERE team_id = :team;
INSERT INTO file_texts (team_id, file_url, status, claimed_by, finished_at)
SELECT DISTINCT ON (a.file_url) :team, a.file_url, 'done', NULL, now()
  FROM ticket_attachments a JOIN tickets t ON t.id = a.ticket_id JOIN projects p ON p.id = t.project_id
 WHERE p.team_id = :team
ON CONFLICT (file_url) DO NOTHING;
-- Denemenin dosyaları: iki görsel, bir PDF; arşivli bir görevde bir görsel daha.
INSERT INTO ticket_attachments (ticket_id, file_url, file_name, uploaded_by, created_at) VALUES
  (:ticket, 'https://qa.test/ps/ekran-1.png', 'ekran-1.png', :uye, now() - interval '2 minutes'),
  (:ticket, 'https://qa.test/ps/ekran-2.JPG', 'ekran-2.JPG', :uye, now() - interval '1 minute'),
  (:ticket, 'https://qa.test/ps/rapor.pdf', 'rapor.pdf', :uye, now());
INSERT INTO tickets (id, project_id, title, status_id, created_by, archived_at)
SELECT 'a9e17000-0000-4000-8000-0000000000c1', t.project_id, 'QA arşivli', t.status_id, :uye, now() FROM tickets t WHERE t.id = :ticket;
INSERT INTO ticket_attachments (ticket_id, file_url, file_name, uploaded_by) VALUES ('a9e17000-0000-4000-8000-0000000000c1', 'https://qa.test/ps/arsiv.png', 'arsiv.png', :uye);

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
CREATE OR REPLACE FUNCTION pg_temp.try(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN 'hata'; END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, coalesce(actual, '(null)'), expected IS NOT DISTINCT FROM actual) $$;
CREATE TEMP TABLE _k (name text PRIMARY KEY, val text);
GRANT ALL ON _k TO PUBLIC;

-- 1) Takımın anahtarı: varsayılan kapalı, yalnız yönetici açar
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('1a anahtar kapalıyken iş gelmez', 'yok', (SELECT coalesce(public.agent_passive_next()::text, 'yok')));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('1b üye anahtarı açamaz', 'hata', pg_temp.try(format('INSERT INTO public.ai_team_passive (team_id, image_text) VALUES (%L, true)', :team)));
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('1c takım dışı açamaz', 'hata', pg_temp.try(format('INSERT INTO public.ai_team_passive (team_id, image_text) VALUES (%L, true)', :team)));
SELECT pg_temp.as_user(:yonetici);
SELECT pg_temp.chk('1d yönetici açar', 'ok', pg_temp.try(format('INSERT INTO public.ai_team_passive (team_id, image_text) VALUES (%L, true)', :team)));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('1e kimin açtığı yazılır', 'true', (SELECT (updated_by = :yonetici)::text FROM ai_team_passive WHERE team_id = :team));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('1f üye ayarı okur', 'true', (SELECT image_text::text FROM ai_team_passive WHERE team_id = :team));
SELECT pg_temp.chk('1g üyenin kapatma denemesi hata vermez ama satıra ulaşmaz', 'ok', pg_temp.try(format('UPDATE public.ai_team_passive SET image_text = false WHERE team_id = %L', :team)));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('1h ayar yerinde', 'true', (SELECT image_text::text FROM ai_team_passive WHERE team_id = :team));
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('1i takım dışı ayarı göremez', '0', (SELECT count(*)::text FROM ai_team_passive WHERE team_id = :team));

-- 2) Sıra: yalnız ajan, yalnız üyesi olduğu takım, yalnız görsel, en yenisi önce
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('2a insan hesabı iş alamaz', 'hata', pg_temp.try('SELECT public.agent_passive_next()'));
SELECT pg_temp.as_user(:disajan);
SELECT pg_temp.chk('2b takımın üyesi olmayan ajana iş gelmez', 'yok', (SELECT coalesce(public.agent_passive_next()::text, 'yok')));
SELECT pg_temp.as_user(:ajan);
INSERT INTO _k SELECT 'j1', public.agent_passive_next()::text;
SELECT pg_temp.chk('2c en yeni görsel gelir (uzantı büyük harf olsa da)', 'ekran-2.JPG/image_text', (SELECT (val::jsonb ->> 'file_name') || '/' || (val::jsonb ->> 'kind') FROM _k WHERE name = 'j1'));
SELECT pg_temp.chk('2d iş görevi ve listeyi söyler', 'true', (SELECT ((val::jsonb ->> 'ticket_id')::uuid = :ticket AND (val::jsonb ->> 'list') IS NOT NULL AND (val::jsonb ->> 'team_id')::uuid = :team)::text FROM _k WHERE name = 'j1'));
SELECT pg_temp.as_user(:ajan2);
INSERT INTO _k SELECT 'j2', public.agent_passive_next()::text;
SELECT pg_temp.chk('2e ikinci ajan aynı işi almaz, sıradakini alır', 'ekran-1.png', (SELECT val::jsonb ->> 'file_name' FROM _k WHERE name = 'j2'));
SELECT pg_temp.chk('2f görseller bitince iş kalmaz (PDF ve arşivli görev gelmez)', 'yok', (SELECT coalesce(public.agent_passive_next()::text, 'yok')));

-- 3) Sonuç: yalnız üstlenen yazar, bir kez; takım okur
SELECT pg_temp.chk('3a başkasının işine sonuç yazılamaz', 'hata', pg_temp.try(format('SELECT public.agent_passive_save(%L, %L)', (SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'j1'), '{"text":"x"}')));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('3b üstlenen sonucu yazar', 'true', (SELECT public.agent_passive_save((SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j1'),
  jsonb_build_object('text', 'Hata: Belge kaydedilemedi', 'description', '  Bir SAP ekranında hata iletisi.  ', 'lang', ' TR ', 'model', 'claude-haiku-4-5', 'ms', 13472.6, 'cost_usd', 0.006138))::text));
SELECT pg_temp.chk('3c ikinci kez yazılamaz', 'hata', pg_temp.try(format('SELECT public.agent_passive_save(%L, %L)', (SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'j1'), '{"text":"y"}')));
SELECT pg_temp.chk('3d ajan satırı doğrudan değiştiremez', 'hata', pg_temp.try('UPDATE public.file_texts SET text = ''z'''));
SELECT pg_temp.chk('3e ajan satır ekleyemez', 'hata', pg_temp.try(format('INSERT INTO public.file_texts (team_id, file_url, status) VALUES (%L, ''https://qa.test/ps/sahte.png'', ''done'')', :team)));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('3f alanlar kırpılır, durum done', 'done|Hata: Belge kaydedilemedi|Bir SAP ekranında hata iletisi.|tr|claude-haiku-4-5',
  (SELECT concat_ws('|', status, text, description, lang, model) FROM file_texts WHERE file_url = 'https://qa.test/ps/ekran-2.JPG'));
SELECT pg_temp.chk('3f2 süre ve API karşılığı saklanır (112)', '13473/0.0061', (SELECT ms || '/' || cost_usd FROM file_texts WHERE file_url = 'https://qa.test/ps/ekran-2.JPG'));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('3g takım üyesi sonucu okur', 'Hata: Belge kaydedilemedi', (SELECT text FROM file_texts WHERE file_url = 'https://qa.test/ps/ekran-2.JPG'));
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('3h takım dışı okuyamaz', '0', (SELECT count(*)::text FROM file_texts WHERE team_id = :team));

-- 3z) Arama (111): okunan metin görevin metni sayılır; görev satırına dokunulmaz
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('3i görevin arama satırı oluşur', 'true', (SELECT (fold LIKE '%belge kaydedilemedi%' AND fold LIKE '%sap ekraninda%')::text FROM ticket_image_folds WHERE ticket_id = :ticket));
SELECT pg_temp.chk('3j sonuç yazılırken görevin güncellenme anı değişmez', 'true', (SELECT (updated_at < now() - interval '1 second')::text FROM tickets WHERE id = :ticket));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('3k üye, görseldeki kelimeyle görevi bulur', '1', (SELECT count(*)::text FROM public.palette_search('{"terms":["kaydedilemedi"]}'::jsonb) r WHERE r.id = :ticket));
SELECT pg_temp.chk('3l anlatımdaki kelimeyle de bulur', '1', (SELECT count(*)::text FROM public.palette_search('{"terms":["SAP", "ekranında"]}'::jsonb) r WHERE r.id = :ticket));
SELECT pg_temp.chk('3m üye arama satırını okuyabilir, yazamaz', '1/hata', (SELECT count(*)::text FROM ticket_image_folds WHERE ticket_id = :ticket) || '/' || pg_temp.try(format('UPDATE public.ticket_image_folds SET fold = ''x'' WHERE ticket_id = %L', :ticket)));
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('3n takım dışı aramayla bulamaz, satırı göremez', '0/0', (SELECT count(*)::text FROM public.palette_search('{"terms":["kaydedilemedi"]}'::jsonb) r WHERE r.id = :ticket) || '/' || (SELECT count(*)::text FROM ticket_image_folds));
SELECT pg_temp.as_admin();
DELETE FROM ticket_attachments WHERE ticket_id = :ticket AND file_url = 'https://qa.test/ps/ekran-2.JPG';
SELECT pg_temp.chk('3o dosya görevden çıkınca metni aramadan düşer', '0', (SELECT count(*)::text FROM ticket_image_folds WHERE ticket_id = :ticket AND fold LIKE '%kaydedilemedi%'));
INSERT INTO ticket_attachments (ticket_id, file_url, file_name, uploaded_by, created_at) VALUES (:ticket, 'https://qa.test/ps/ekran-2.JPG', 'ekran-2.JPG', :uye, now() - interval '1 minute');
SELECT pg_temp.chk('3p okunmuş dosya yeniden eklenince (kopya) metni geri gelir', '1', (SELECT count(*)::text FROM ticket_image_folds WHERE ticket_id = :ticket AND fold LIKE '%kaydedilemedi%'));

-- 4) Yapılamayan iş: üç deneme, atla, yarıda kalan
SELECT pg_temp.as_user(:ajan2);
SELECT pg_temp.chk('4a yapılamadı diye işaretlenir', 'true', (SELECT public.agent_passive_fail((SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j2'), 'oturum hata ile bitti')::text));
SELECT pg_temp.chk('4b hemen yeniden verilmez', 'yok', (SELECT coalesce(public.agent_passive_next()::text, 'yok')));
SELECT pg_temp.as_admin();
UPDATE file_texts SET finished_at = now() - interval '2 hours' WHERE file_url = 'https://qa.test/ps/ekran-1.png';
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('4c bir saat sonra başka bir ajan yeniden alabilir', 'ekran-1.png', (SELECT public.agent_passive_next() ->> 'file_name'));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('4d deneme sayısı artar, üstlenen değişir', '2/true', (SELECT attempts || '/' || (claimed_by = :ajan) FROM file_texts WHERE file_url = 'https://qa.test/ps/ekran-1.png'));
UPDATE file_texts SET claimed_at = now() - interval '11 minutes' WHERE file_url = 'https://qa.test/ps/ekran-1.png';
SELECT pg_temp.as_user(:ajan2);
SELECT pg_temp.chk('4e on dakikadır cevapsız iş yeniden alınır', 'ekran-1.png', (SELECT public.agent_passive_next() ->> 'file_name'));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('4f eski üstlenen artık yazamaz', 'hata', pg_temp.try(format('SELECT public.agent_passive_save(%L, %L)', (SELECT id FROM file_texts WHERE file_url = 'https://qa.test/ps/ekran-1.png'), '{"text":"geç"}')));
SELECT pg_temp.as_user(:ajan2);
SELECT public.agent_passive_fail((SELECT id FROM file_texts WHERE file_url = 'https://qa.test/ps/ekran-1.png'), 'yine olmadı') IS NOT NULL;
SELECT pg_temp.as_admin();
UPDATE file_texts SET finished_at = now() - interval '2 hours' WHERE file_url = 'https://qa.test/ps/ekran-1.png';
SELECT pg_temp.chk('4g üç denemeden sonra', '3/failed', (SELECT attempts || '/' || status FROM file_texts WHERE file_url = 'https://qa.test/ps/ekran-1.png'));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('4h üç kez düşen görsel bir daha verilmez', 'yok', (SELECT coalesce(public.agent_passive_next()::text, 'yok')));

-- atla: okunacak bir şey değil, bir daha denenmez
SELECT pg_temp.as_admin();
INSERT INTO ticket_attachments (ticket_id, file_url, file_name, uploaded_by) VALUES (:ticket, 'https://qa.test/ps/bozuk.png', 'bozuk.png', :uye);
SELECT pg_temp.as_user(:ajan);
SELECT public.agent_passive_fail((public.agent_passive_next() ->> 'id')::uuid, 'dosya açılamadı', true) IS NOT NULL;
SELECT pg_temp.as_admin();
UPDATE file_texts SET finished_at = now() - interval '2 hours' WHERE file_url = 'https://qa.test/ps/bozuk.png';
SELECT pg_temp.chk('4i atlanan iş skipped olur, neden yazılır', 'skipped/dosya açılamadı', (SELECT status || '/' || error FROM file_texts WHERE file_url = 'https://qa.test/ps/bozuk.png'));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('4j atlanan görsel bir daha verilmez', 'yok', (SELECT coalesce(public.agent_passive_next()::text, 'yok')));

-- 5) Anahtar kapanınca sıra durur; ajan takımdan çıkınca iş gelmez
SELECT pg_temp.as_admin();
INSERT INTO ticket_attachments (ticket_id, file_url, file_name, uploaded_by) VALUES (:ticket, 'https://qa.test/ps/yeni.webp', 'yeni.webp', :uye);
SELECT pg_temp.as_user(:yonetici);
UPDATE ai_team_passive SET image_text = false WHERE team_id = :team;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('5a anahtar kapatılınca yeni görsel verilmez', 'yok', (SELECT coalesce(public.agent_passive_next()::text, 'yok')));
SELECT pg_temp.as_user(:yonetici);
UPDATE ai_team_passive SET image_text = true WHERE team_id = :team;
SELECT pg_temp.as_admin();
DELETE FROM team_members WHERE team_id = :team AND user_id = :ajan;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('5b takımdan çıkan ajana iş gelmez', 'yok', (SELECT coalesce(public.agent_passive_next()::text, 'yok')));
SELECT pg_temp.as_user(:ajan2);
SELECT pg_temp.chk('5c üye olan ajana gelir', 'yeni.webp', (SELECT public.agent_passive_next() ->> 'file_name'));
SELECT pg_temp.chk('5d sayı olmayan süre ve tutar yok sayılır, sonuç yine yazılır', 'true', (SELECT public.agent_passive_save((SELECT id FROM file_texts WHERE file_url = 'https://qa.test/ps/yeni.webp'), '{"text":"a","description":"b","ms":"çok","cost_usd":null}'::jsonb)::text));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('5e öyle bir satırda süre ve tutar boş', 'done/true/true', (SELECT status || '/' || (ms IS NULL) || '/' || (cost_usd IS NULL) FROM file_texts WHERE file_url = 'https://qa.test/ps/yeni.webp'));

-- 6) Oturumsuz çağrı yok
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('6a anon fonksiyonları çağıramaz', 'f/f/f', (SELECT concat_ws('/',
  has_function_privilege('anon', 'public.agent_passive_next()', 'EXECUTE'),
  has_function_privilege('anon', 'public.agent_passive_save(uuid, jsonb)', 'EXECUTE'),
  has_function_privilege('anon', 'public.agent_passive_fail(uuid, text, boolean)', 'EXECUTE'))));
SELECT pg_temp.chk('6b anon tabloları okuyamaz', 'f/f', (SELECT concat_ws('/',
  has_table_privilege('anon', 'public.file_texts', 'SELECT'), has_table_privilege('anon', 'public.ai_team_passive', 'SELECT'))));

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SELECT step || ' | bekl: ' || expected || ' | gerçek: ' || actual || ' | ' || CASE WHEN ok THEN 'GEÇTİ' ELSE '*** KALDI ***' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' kontrol geçti' FROM _r;

ROLLBACK;
