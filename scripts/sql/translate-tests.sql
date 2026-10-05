-- Pasif işler · çeviri (113, #fa4b05e9) — anahtar, hedef diller, sıra, sonuç, bayatlama ve yetki testleri.
-- Çalıştırma: docker exec -i supabase-db psql -U postgres -d postgres -At < translate-tests.sql
-- Her şey ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur. Demo takım "Fira Tanıtım",
-- onun bir listesi ve yalnız bu işlemde yaşayan deneme hesapları, görevleri, yorumları kullanılır.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

\set team     '''e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7'''
\set ticket   '''c5938b5e-70fd-4604-98dc-dfea31c98d4f'''
\set uye      '''a9e17100-0000-4000-8000-000000000011'''
\set yonetici '''a9e17100-0000-4000-8000-000000000012'''
\set yabanci  '''a9e17100-0000-4000-8000-000000000013'''
\set alman    '''a9e17100-0000-4000-8000-000000000014'''
\set ajan     '''a9e17100-0000-4000-8000-0000000000b1'''
\set ajan2    '''a9e17100-0000-4000-8000-0000000000b2'''
\set disajan  '''a9e17100-0000-4000-8000-0000000000b3'''
\set t1       '''a9e17100-0000-4000-8000-0000000000c1'''
\set tarsiv   '''a9e17100-0000-4000-8000-0000000000c2'''
\set c1       '''a9e17100-0000-4000-8000-0000000000d1'''
\set c2       '''a9e17100-0000-4000-8000-0000000000d2'''
\set c3       '''a9e17100-0000-4000-8000-0000000000d3'''

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
  FROM (VALUES (:uye::uuid, 'qa-tr-uye@fira.test'), (:yonetici::uuid, 'qa-tr-yon@fira.test'), (:yabanci::uuid, 'qa-tr-yab@fira.test'), (:alman::uuid, 'qa-tr-alm@fira.test'),
               (:ajan::uuid, 'qa-tr-ajan@fira.test'), (:ajan2::uuid, 'qa-tr-ajan2@fira.test'), (:disajan::uuid, 'qa-tr-dis@fira.test')) v(id, mail);
INSERT INTO profiles (id, email, full_name) VALUES
  (:uye, 'qa-tr-uye@fira.test', 'QA Üye'), (:yonetici, 'qa-tr-yon@fira.test', 'QA Yönetici'), (:yabanci, 'qa-tr-yab@fira.test', 'QA Yabancı'), (:alman, 'qa-tr-alm@fira.test', 'QA Almanca Okur'),
  (:ajan, 'qa-tr-ajan@fira.test', 'QA Ajan'), (:ajan2, 'qa-tr-ajan2@fira.test', 'QA Ajan 2'), (:disajan, 'qa-tr-dis@fira.test', 'QA Dış Ajan')
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET is_ai = true WHERE id IN (:ajan, :ajan2, :disajan);
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :uye, 'member'), (:team, :yonetici, 'admin'), (:team, :alman, 'viewer'), (:team, :ajan, 'member'), (:team, :ajan2, 'member');
INSERT INTO agents (profile_id, owner_id) VALUES (:ajan, :uye), (:ajan2, :yonetici), (:disajan, :yabanci);

-- Takımın gerçek üyelerinin okuma dili tercihi denemeye karışmasın; ayar da baştan.
UPDATE user_preferences SET prefs = prefs - 'reading' WHERE scope = 'global' AND user_id IN (SELECT user_id FROM team_members WHERE team_id = :team);
DELETE FROM ai_team_passive WHERE team_id = :team;
DELETE FROM content_translations WHERE team_id = :team;
-- Kim ne okur: üye yalnız Türkçe; yönetici Türkçe ve İngilizce (çeviri Türkçeye); izleyici Almanca ve İngilizce (çeviri Almancaya).
-- Biçimi bozuk tercih sayılmaz.
INSERT INTO user_preferences (user_id, scope, prefs) VALUES
  (:uye, 'global', '{"reading": {"read": ["tr"], "to": "tr"}}'),
  (:yonetici, 'global', '{"reading": {"read": ["TR", "en"], "to": "tr"}, "theme": "dark"}'),
  (:alman, 'global', '{"reading": {"read": ["de", "en", "bozuk dil"], "to": "DE"}}'),
  (:ajan2, 'global', '{"reading": {"read": "tr", "to": "türkçe"}}');
-- Demo takımın mevcut metinleri deneme dışında kalsın: iki hedef için de "denenmez" sayılırlar.
INSERT INTO content_translations (team_id, ticket_id, comment_id, target_lang, source_hash, status)
SELECT :team::uuid, t.id, NULL::uuid, g.l, 'x', 'skipped' FROM tickets t JOIN projects p ON p.id = t.project_id, (VALUES ('tr'), ('de')) g(l)
 WHERE p.team_id = :team AND length(btrim(coalesce(t.description, ''))) >= 2
UNION ALL
SELECT :team::uuid, c.ticket_id, c.id, g.l, 'x', 'skipped' FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id JOIN projects p ON p.id = t.project_id, (VALUES ('tr'), ('de')) g(l)
 WHERE p.team_id = :team AND length(btrim(coalesce(c.content, ''))) >= 2;
-- Denemenin metinleri: bir görev (İngilizce açıklama), üç yorumu, bir de arşivli görev.
INSERT INTO tickets (id, project_id, title, description, status_id, created_by, updated_at)
SELECT :t1, t.project_id, 'QA çeviri görevi', 'This is the English description.', t.status_id, :uye, now() - interval '10 minutes' FROM tickets t WHERE t.id = :ticket;
INSERT INTO tickets (id, project_id, title, description, status_id, created_by, archived_at)
SELECT :tarsiv, t.project_id, 'QA arşivli', 'Archived text that nobody reads.', t.status_id, :uye, now() FROM tickets t WHERE t.id = :ticket;
INSERT INTO ticket_comments (id, ticket_id, author_id, content, created_at) VALUES
  (:c1, :t1, :uye, 'Bitte prüfen, ob das stimmt.', now() - interval '3 minutes'),
  (:c2, :t1, :uye, 'Looks good to me.', now() - interval '2 minutes'),
  (:c3, :t1, :uye, ' k ', now() - interval '1 minute');

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
-- Bir işin kısa adı: hangi metin, hangi dile.
CREATE OR REPLACE FUNCTION pg_temp.job(j text) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN j IS NULL THEN 'yok' ELSE (j::jsonb ->> 'field') || ':' || left(j::jsonb ->> 'text', 5) || '>' || (j::jsonb ->> 'target') END $$;

-- 1) Takımın anahtarı: görsel anahtarından ayrı, varsayılan kapalı, yalnız yönetici açar
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('1a anahtar kapalıyken iş gelmez', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_user(:yonetici);
SELECT pg_temp.chk('1b yönetici görsel anahtarını açar', 'ok', pg_temp.try(format('INSERT INTO public.ai_team_passive (team_id, image_text) VALUES (%L, true)', :team)));
SELECT pg_temp.chk('1b2 görsel anahtarını açmak çeviriyi açmaz', 'false', (SELECT translate::text FROM ai_team_passive WHERE team_id = :team));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('1c yalnız görsel anahtarı açıkken çeviri işi gelmez', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.try(format('UPDATE public.ai_team_passive SET translate = true WHERE team_id = %L', :team));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('1d üyenin açma denemesi satıra ulaşmaz', 'false', (SELECT translate::text FROM ai_team_passive WHERE team_id = :team));
SELECT pg_temp.as_user(:yonetici);
SELECT pg_temp.chk('1e yönetici çeviriyi açar', 'ok', pg_temp.try(format('UPDATE public.ai_team_passive SET translate = true WHERE team_id = %L', :team)));
SELECT pg_temp.chk('1f eski istemcinin yazdığı satır (yalnız görsel anahtarı) çeviriyi kapatmaz', 'true', (SELECT (pg_temp.try(format('INSERT INTO public.ai_team_passive (team_id, image_text) VALUES (%L, false) ON CONFLICT (team_id) DO UPDATE SET image_text = EXCLUDED.image_text', :team)) = 'ok' AND (SELECT translate FROM ai_team_passive WHERE team_id = :team))::text));

-- 2) Hedef diller: kişilerin tercihinden; her hedef için "çeviri gerekmeyen" diller o hedefin bütün okurlarının okuduklarıdır
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('2a hedefler ve atlanacak diller (bozuk tercihin payı yok)', 'de:de,en | tr:tr', (SELECT string_agg(target || ':' || array_to_string(skip, ','), ' | ' ORDER BY target) FROM public.ai_translation_targets(:team)));
SELECT pg_temp.as_user(:uye);
SELECT pg_temp.chk('2b kimin ne okuduğu üyeye açık değil (fonksiyon kapalı)', 'hata', pg_temp.try(format('SELECT * FROM public.ai_translation_targets(%L)', :team)));

-- 3) Sıra: yalnız ajan, yalnız üyesi olduğu takım, en yeni metin önce, her hedef dil ayrı iş
SELECT pg_temp.chk('3a insan hesabı iş alamaz', 'hata', pg_temp.try('SELECT public.agent_translate_next()'));
SELECT pg_temp.as_user(:disajan);
SELECT pg_temp.chk('3b takımın üyesi olmayan ajana iş gelmez', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_user(:ajan);
INSERT INTO _k SELECT 'j1', public.agent_translate_next()::text;
INSERT INTO _k SELECT 'j2', public.agent_translate_next()::text;
SELECT pg_temp.chk('3c en yeni metin gelir, iki hedef için iki ayrı iş (tek harflik yorum iş değil)', 'comment:Looks>de | comment:Looks>tr', (SELECT string_agg(pg_temp.job(val), ' | ' ORDER BY pg_temp.job(val)) FROM _k WHERE name IN ('j1', 'j2')));
SELECT pg_temp.chk('3d iş metni, görevi, listeyi ve atlanacak dilleri söyler', 'true', (SELECT ((val::jsonb ->> 'text') = 'Looks good to me.' AND (val::jsonb ->> 'ticket_id')::uuid = :t1 AND (val::jsonb ->> 'comment_id')::uuid = :c2
  AND (val::jsonb ->> 'ticket_title') = 'QA çeviri görevi' AND (val::jsonb ->> 'list') IS NOT NULL AND (val::jsonb ->> 'kind') = 'translate'
  AND (val::jsonb -> 'skip') = CASE WHEN (val::jsonb ->> 'target') = 'de' THEN '["de","en"]'::jsonb ELSE '["tr"]'::jsonb END)::text FROM _k WHERE name = 'j1'));
SELECT pg_temp.as_user(:ajan2);
INSERT INTO _k SELECT 'j3', public.agent_translate_next()::text;
SELECT pg_temp.chk('3e ikinci ajan aynı işi almaz, sıradaki metni alır', 'comment:Bitte', (SELECT split_part(pg_temp.job(val), '>', 1) FROM _k WHERE name = 'j3'));
INSERT INTO _k SELECT 'j4', public.agent_translate_next()::text;
INSERT INTO _k SELECT 'j5', public.agent_translate_next()::text;
INSERT INTO _k SELECT 'j6', public.agent_translate_next()::text;
SELECT pg_temp.chk('3f sonra açıklama gelir', 'description:This >de | description:This >tr', (SELECT string_agg(pg_temp.job(val), ' | ' ORDER BY pg_temp.job(val)) FROM _k WHERE name IN ('j5', 'j6')));
SELECT pg_temp.chk('3g metinler bitince iş kalmaz (arşivli görev gelmez)', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('3h üstlenilen satır metnin özetini taşır (sha256)', 'true', (SELECT bool_and(x.source_hash = encode(sha256(convert_to('Looks good to me.', 'UTF8')), 'hex'))::text FROM content_translations x WHERE x.comment_id = :c2));
SELECT pg_temp.chk('3i özet istemcinin hesapladığıyla aynı biçimde (UTF-8, onaltılık)', '6c77b1464df6e52b64786431582ba647b5bf50943c52ff8e1d4e0b566ed20682', encode(sha256(convert_to(E'Günaydın, ⟦1⟧ hazır mı?\n- [x] evet', 'UTF8')), 'hex'));

-- 4) Sonuç: yalnız üstlenen yazar, bir kez; metinsiz sonuç "çeviri gerekmez"
-- j1/j2: "Looks good to me." (ajan). de hedefinde İngilizce atlanır, tr hedefinde çevrilir.
INSERT INTO _k SELECT 'jde', val FROM _k WHERE name IN ('j1', 'j2') AND (val::jsonb ->> 'target') = 'de';
INSERT INTO _k SELECT 'jtr', val FROM _k WHERE name IN ('j1', 'j2') AND (val::jsonb ->> 'target') = 'tr';
SELECT pg_temp.as_user(:ajan2);
SELECT pg_temp.chk('4a başkasının işine sonuç yazılamaz', 'hata', pg_temp.try(format('SELECT public.agent_translate_save(%L, %L)', (SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'jtr'), '{"text":"x","lang":"en"}')));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('4b üstlenen çeviriyi yazar', 'true', (SELECT public.agent_translate_save((SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'jtr'),
  jsonb_build_object('text', 'Bana göre iyi görünüyor.', 'lang', ' EN ', 'model', 'claude-haiku-4-5', 'ms', 4321.4, 'cost_usd', 0.00127))::text));
SELECT pg_temp.chk('4c metinsiz sonuç: çeviri gerekmez', 'true', (SELECT public.agent_translate_save((SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'jde'),
  jsonb_build_object('text', '', 'lang', 'en', 'ms', 'çok', 'cost_usd', NULL))::text));
SELECT pg_temp.chk('4d aynı işe ikinci sonuç yazılamaz', 'hata', pg_temp.try(format('SELECT public.agent_translate_save(%L, %L)', (SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'jtr'), '{"text":"y","lang":"en"}')));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('4e çeviri satırı: durum, dil, model, süre, karşılık', 'done/en/claude-haiku-4-5/4321/0.0013/Bana göre iyi görünüyor.', (SELECT concat_ws('/', status, source_lang, model, ms, cost_usd, text) FROM content_translations WHERE comment_id = :c2 AND target_lang = 'tr'));
SELECT pg_temp.chk('4f gerekmez satırı: metin yok, dil yazılı, sayı olmayan ölçü boş', 'none/en/true/true', (SELECT concat_ws('/', status, source_lang, (text IS NULL)::text, (ms IS NULL AND cost_usd IS NULL)::text) FROM content_translations WHERE comment_id = :c2 AND target_lang = 'de'));

-- 5) Okuma: takım okur, takım dışı okuyamaz, kimse doğrudan yazamaz
SELECT pg_temp.as_user(:alman);
SELECT pg_temp.chk('5a izleyici üye çeviriyi okur', '1', (SELECT count(*)::text FROM content_translations WHERE comment_id = :c2 AND status = 'done'));
SELECT pg_temp.as_user(:yabanci);
SELECT pg_temp.chk('5b takım dışı hiçbir satırı göremez', '0', (SELECT count(*)::text FROM content_translations WHERE team_id = :team));
SELECT pg_temp.as_user(:yonetici);
SELECT pg_temp.chk('5c yönetici de doğrudan yazamaz (ekle / değiştir / sil)', 'hata/hata/hata', concat_ws('/',
  pg_temp.try(format('INSERT INTO public.content_translations (team_id, ticket_id, target_lang, source_hash, status) VALUES (%L, %L, %L, %L, %L)', :team, :t1, 'fr', 'x', 'done')),
  pg_temp.try(format('UPDATE public.content_translations SET text = %L WHERE comment_id = %L', 'sahte', :c2)),
  pg_temp.try(format('DELETE FROM public.content_translations WHERE comment_id = %L', :c2))));

-- 6) Olmayan iş: yeniden deneme kuralları
-- j3/j4: "Bitte prüfen…" (ajan2). Biri başarısız, biri "bir daha denenmez".
SELECT pg_temp.as_user(:ajan2);
SELECT pg_temp.chk('6a iş olmadı diye yazılır', 'true', (SELECT public.agent_translate_fail((SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j3'), '  yer tutucular eksik döndü  ')::text));
SELECT pg_temp.chk('6b bir daha denenmez diye yazılır', 'true', (SELECT public.agent_translate_fail((SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j4'), 'metin çok uzun', true)::text));
SELECT pg_temp.chk('6c başarısız iş hemen yeniden gelmez', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_admin();
UPDATE content_translations SET finished_at = now() - interval '2 hours' WHERE id = (SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j3');
SELECT pg_temp.as_user(:ajan);
INSERT INTO _k SELECT 'j7', public.agent_translate_next()::text;
SELECT pg_temp.chk('6d bir saat sonra yeniden gelir (başka ajana da)', 'true', (SELECT ((SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'j7') = (SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'j3'))::text));
SELECT pg_temp.chk('6d2 deneme sayısı artar', '2', (SELECT attempts::text FROM content_translations WHERE id = (SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j3')));
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('6e bırakılan iş bir daha gelmez', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT public.agent_translate_fail((SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j7'), 'yine olmadı');
SELECT pg_temp.as_admin();
UPDATE content_translations SET finished_at = now() - interval '2 hours' WHERE id = (SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j3');
SELECT pg_temp.as_user(:ajan);
INSERT INTO _k SELECT 'j8', public.agent_translate_next()::text;
SELECT public.agent_translate_fail((SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j8'), 'üçüncü kez');
SELECT pg_temp.as_admin();
UPDATE content_translations SET finished_at = now() - interval '2 hours' WHERE id = (SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j3');
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('6f üç denemeden sonra bırakılır', 'yok', pg_temp.job(public.agent_translate_next()::text));
-- j5/j6: açıklama (ajan2 üstlendi, cevap vermedi)
SELECT pg_temp.chk('6g başkasının süren işi alınmaz', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_admin();
UPDATE content_translations SET claimed_at = now() - interval '11 minutes' WHERE id = (SELECT (val::jsonb ->> 'id')::uuid FROM _k WHERE name = 'j5');
SELECT pg_temp.as_user(:ajan);
INSERT INTO _k SELECT 'j9', public.agent_translate_next()::text;
SELECT pg_temp.chk('6h on dakika cevapsız kalan iş yeniden alınır', 'true', (SELECT ((SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'j9') = (SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'j5'))::text));
SELECT pg_temp.as_user(:ajan2);
SELECT pg_temp.chk('6i işi elinden alınan ajan sonuç yazamaz', 'hata', pg_temp.try(format('SELECT public.agent_translate_save(%L, %L)', (SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'j5'), '{"text":"geç kaldı","lang":"en"}')));

-- 7) Metin değişince eski çeviri gider; değişmeyince kalır
SELECT pg_temp.as_user(:uye);
UPDATE ticket_comments SET content = content WHERE id = :c2;
UPDATE tickets SET title = 'QA çeviri görevi (adı değişti)' WHERE id = :t1;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('7a aynı metni yeniden yazmak ve başlığı değiştirmek çeviriye dokunmaz', '2/2', (SELECT count(*) FILTER (WHERE comment_id = :c2) || '/' || count(*) FILTER (WHERE ticket_id = :t1 AND comment_id IS NULL) FROM content_translations));
SELECT pg_temp.as_user(:uye);
UPDATE ticket_comments SET content = 'Looks good to me, ship it.', edited_at = now() WHERE id = :c2;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('7b yorum değişince iki hedefteki satırı da gider', '0', (SELECT count(*)::text FROM content_translations WHERE comment_id = :c2));
SELECT pg_temp.as_user(:ajan);
INSERT INTO _k SELECT 'j10', public.agent_translate_next()::text;
SELECT pg_temp.chk('7c değişen yorum yeniden iştir, yeni metniyle', 'Looks good to me, ship it.', (SELECT val::jsonb ->> 'text' FROM _k WHERE name = 'j10'));
SELECT pg_temp.as_user(:uye);
UPDATE tickets SET description = 'Die Beschreibung ist jetzt deutsch.' WHERE id = :t1;
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('7d açıklama değişince açıklamanın satırları gider, yorumlarınki kalır', '0/true', (SELECT count(*) FILTER (WHERE comment_id IS NULL) || '/' || (count(*) FILTER (WHERE comment_id = :c1) > 0)::text FROM content_translations WHERE ticket_id = :t1));
SELECT pg_temp.as_user(:ajan2);
SELECT pg_temp.chk('7e metni değişen işin eski sahibi sonuç yazamaz (satır yok)', 'hata', pg_temp.try(format('SELECT public.agent_translate_save(%L, %L)', (SELECT val::jsonb ->> 'id' FROM _k WHERE name = 'j6'), '{"text":"eski metnin çevirisi","lang":"en"}')));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('7f çeviri yazmak görevi ve yorumu oynatmaz', 'true', (SELECT ((SELECT edited_at FROM ticket_comments WHERE id = :c1) IS NULL AND NOT EXISTS (SELECT 1 FROM ticket_activity WHERE ticket_id = :t1 AND meta::text ILIKE '%translat%'))::text));

-- 8) "Gerekmez" satırı, o dili okumayan biri hedefe katılınca yeniden iştir
-- Önce kalan işleri kapat: sıra boşalsın.
SELECT pg_temp.as_admin();
UPDATE content_translations SET status = 'skipped', finished_at = now() WHERE team_id = :team AND status IN ('processing', 'failed');
INSERT INTO content_translations (team_id, ticket_id, comment_id, target_lang, source_hash, status, finished_at)
SELECT :team, :t1, c.id, g.l, 'x', 'skipped', now() FROM (VALUES (:c2::uuid)) c(id), (VALUES ('tr'), ('de')) g(l)
 WHERE NOT EXISTS (SELECT 1 FROM content_translations x WHERE x.comment_id = c.id AND x.target_lang = g.l);
INSERT INTO content_translations (team_id, ticket_id, comment_id, target_lang, source_hash, status, finished_at)
SELECT :team, :t1, NULL, g.l, 'x', 'skipped', now() FROM (VALUES ('tr'), ('de')) g(l)
 WHERE NOT EXISTS (SELECT 1 FROM content_translations x WHERE x.ticket_id = :t1 AND x.comment_id IS NULL AND x.target_lang = g.l);
UPDATE content_translations SET status = 'none', source_lang = 'en', text = NULL WHERE comment_id = :c2 AND target_lang = 'de';
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('8a herkes İngilizce okurken gerekmez satırı iş değildir', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_admin();
INSERT INTO team_members (team_id, user_id, role) VALUES (:team, :yabanci, 'member');
INSERT INTO user_preferences (user_id, scope, prefs) VALUES (:yabanci, 'global', '{"reading": {"read": ["de"], "to": "de"}}');
SELECT pg_temp.chk('8b yalnız Almanca okuyan katılınca Almancaya atlanacak dil yalnız Almanca kalır', 'de:de | tr:tr', (SELECT string_agg(target || ':' || array_to_string(skip, ','), ' | ' ORDER BY target) FROM public.ai_translation_targets(:team)));
SELECT pg_temp.as_user(:ajan);
INSERT INTO _k SELECT 'j11', public.agent_translate_next()::text;
SELECT pg_temp.chk('8c İngilizce yorum Almancaya yeniden iştir', 'comment:Looks>de', pg_temp.job((SELECT val FROM _k WHERE name = 'j11')));
SELECT pg_temp.chk('8d deneme sayısı baştan başlar', '1', (SELECT attempts::text FROM content_translations WHERE comment_id = :c2 AND target_lang = 'de'));

-- 9) Anahtar kapanınca ve ajan takımdan çıkınca iş gelmez
SELECT pg_temp.as_admin();
DELETE FROM content_translations WHERE comment_id = :c1;
SELECT pg_temp.as_user(:yonetici);
UPDATE ai_team_passive SET translate = false WHERE team_id = :team;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('9a anahtar kapanınca iş gelmez', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_user(:yonetici);
UPDATE ai_team_passive SET translate = true WHERE team_id = :team;
SELECT pg_temp.as_admin();
DELETE FROM team_members WHERE team_id = :team AND user_id = :ajan;
SELECT pg_temp.as_user(:ajan);
SELECT pg_temp.chk('9b takımdan çıkan ajana iş gelmez', 'yok', pg_temp.job(public.agent_translate_next()::text));
SELECT pg_temp.as_user(:ajan2);
SELECT pg_temp.chk('9c takımdaki ajana gelir', 'comment:Bitte', split_part(pg_temp.job(public.agent_translate_next()::text), '>', 1));

-- 10) Görev ve yorum silinince satırları da gider
SELECT pg_temp.as_admin();
DELETE FROM ticket_comments WHERE id = :c2;
SELECT pg_temp.chk('10a yorum silinince çevirisi gider', '0', (SELECT count(*)::text FROM content_translations WHERE comment_id = :c2));
DELETE FROM tickets WHERE id = :t1;
SELECT pg_temp.chk('10b görev silinince bütün satırları gider', '0', (SELECT count(*)::text FROM content_translations WHERE ticket_id = :t1));

-- 11) Yetkiler
SELECT pg_temp.chk('11a anon hiçbir fonksiyonu çağıramaz', 'f/f/f/f', (SELECT concat_ws('/',
  has_function_privilege('anon', 'public.agent_translate_next()', 'EXECUTE'), has_function_privilege('anon', 'public.agent_translate_save(uuid, jsonb)', 'EXECUTE'),
  has_function_privilege('anon', 'public.agent_translate_fail(uuid, text, boolean)', 'EXECUTE'), has_function_privilege('anon', 'public.ai_translation_targets(uuid)', 'EXECUTE'))));
SELECT pg_temp.chk('11b anon tabloyu okuyamaz; giriş yapmış hesap yalnız okur', 'f/t/f/f/f', (SELECT concat_ws('/',
  has_table_privilege('anon', 'public.content_translations', 'SELECT'), has_table_privilege('authenticated', 'public.content_translations', 'SELECT'),
  has_table_privilege('authenticated', 'public.content_translations', 'INSERT'), has_table_privilege('authenticated', 'public.content_translations', 'UPDATE'),
  has_table_privilege('authenticated', 'public.content_translations', 'DELETE'))));
SELECT pg_temp.chk('11c tablo canlı yayında değil', '0', (SELECT count(*)::text FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'content_translations'));

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SELECT step || ' | bekl: ' || expected || ' | gerçek: ' || actual || ' | ' || CASE WHEN ok THEN 'GEÇTİ' ELSE '*** KALDI ***' END FROM _r ORDER BY step;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' kontrol geçti' FROM _r;

ROLLBACK;
