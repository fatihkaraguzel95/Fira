-- Çalıştırma: base64 ile sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -At < rls-audit-tests.sql
-- Tüm işlem ROLLBACK ile biter; QA verisine kalıcı etkisi yoktur.
--
-- RLS denetimi: public şemasındaki HER tablo için, hiçbir takıma üye olmayan bir hesap
-- ("yabancı") SELECT/INSERT/UPDATE/DELETE dener; hiçbir satır görememeli ve değiştirememeli.
-- Ardından bilinen sızıntı noktaları: profiles (e-posta), team_invitations (token),
-- storage.objects politikaları, USING(true) kalıntıları, RPC yetkileri.
BEGIN;
SET LOCAL search_path = public;
CREATE TEMP TABLE _r (step text, expected text, actual text, ok boolean);
GRANT ALL ON _r TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid, em text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', em)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk(step text, expected text, actual text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _r VALUES (step, expected, actual, expected = actual) $$;
-- Bir yazma denemesi: 'reddedildi' (hata ya da 0 satır) / 'YAZDI n'
CREATE OR REPLACE FUNCTION pg_temp.try_write(sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE sql; GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 0 THEN 'reddedildi' ELSE 'YAZDI ' || n END;
EXCEPTION WHEN OTHERS THEN RETURN 'reddedildi';
END $$;

-- ── Yabancı hesap: gerçek bir auth kullanıcısı gerekmez, RLS yalnızca JWT'ye bakar ──
\set outsider '''00000000-0000-4000-8000-00000000dead'''
\set ali '''9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63'''
\set claude '''b7b4c570-4b45-492e-9e02-5970c88ee48c'''

-- 0) Politikasız RLS tablosu / RLS kapalı tablo var mı? (yönetici gözüyle)
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('0a RLS kapalı public tablo yok', '',
  coalesce((SELECT string_agg(tablename, ',') FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity AND tablename NOT LIKE '%_legacy'), ''));
SELECT pg_temp.chk('0b USING(true) yalnızca system_settings okuması', 'system_settings',
  coalesce((SELECT string_agg(DISTINCT tablename, ',') FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true')), ''));
-- 0c (095, #990dfec5): anon'a açık SECURITY DEFINER yalnız izin listesi — davet önizlemesi
-- ve politikaların anonim sorguda değerlendirdiği yardımcılar. Yeni bir fonksiyon PUBLIC
-- varsayılanıyla anon'a açık kalırsa burada görünür.
SELECT pg_temp.chk('0c anon SECURITY DEFINER yalnız izinliler', '',
  coalesce((SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname NOT IN ('agent_session', 'invitation_preview', 'can_write_team', 'is_system_admin', 'is_team_admin', 'project_team', 'team_role', 'ticket_team')), ''));

-- 1) Yabancı: her tabloda SELECT 0 satır
CREATE TEMP TABLE _tables AS
  SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity AND tablename NOT LIKE '%_legacy' ORDER BY 1;
GRANT SELECT ON _tables TO PUBLIC;
DO $$
DECLARE t text; n bigint; r text;
BEGIN
  PERFORM pg_temp.as_user('00000000-0000-4000-8000-00000000dead'::uuid, 'yabanci@example.invalid');
  FOR t IN SELECT tablename FROM _tables LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      r := n::text;
    EXCEPTION WHEN insufficient_privilege THEN r := '0'; -- GRANT yok = görünmez, o da kabul
    WHEN OTHERS THEN r := 'hata';
    END;
    -- system_settings bilerek herkese açık (duyuru/bakım)
    IF t = 'system_settings' THEN CONTINUE; END IF;
    INSERT INTO _r VALUES ('1 yabancı SELECT ' || t, '0', r, r = '0');
  END LOOP;
END $$;

-- 2) Yabancı: mevcut satırları güncelleyemez / silemez (örnek tablolar)
SELECT pg_temp.as_user(:outsider, 'yabanci@example.invalid');
SELECT pg_temp.chk('2a yabancı tickets UPDATE', 'reddedildi', pg_temp.try_write('UPDATE public.tickets SET title = title'));
SELECT pg_temp.chk('2b yabancı tickets DELETE', 'reddedildi', pg_temp.try_write('DELETE FROM public.tickets'));
SELECT pg_temp.chk('2c yabancı projects UPDATE', 'reddedildi', pg_temp.try_write('UPDATE public.projects SET name = name'));
SELECT pg_temp.chk('2d yabancı team_members INSERT', 'reddedildi',
  pg_temp.try_write(format('INSERT INTO public.team_members (team_id, user_id, role) SELECT id, %L, ''owner'' FROM public.teams LIMIT 1', :outsider)));
SELECT pg_temp.chk('2e yabancı profiles UPDATE (başkası)', 'reddedildi', pg_temp.try_write(format('UPDATE public.profiles SET full_name = ''x'' WHERE id = %L', :ali)));
SELECT pg_temp.chk('2f yabancı ticket_comments INSERT', 'reddedildi',
  pg_temp.try_write(format('INSERT INTO public.ticket_comments (ticket_id, author_id, content) SELECT id, %L, ''x'' FROM public.tickets LIMIT 1', :outsider)));
SELECT pg_temp.chk('2g yabancı user_preferences başkasınınkini okuyamaz', '0', (SELECT count(*)::text FROM public.user_preferences));
SELECT pg_temp.chk('2h yabancı telegram_accounts okuyamaz', '0', (SELECT count(*)::text FROM public.telegram_accounts));

-- 3) Profiller: üye yalnızca takımdaşlarını görür
SELECT pg_temp.as_user(:ali, 'ilker.topcu@epiuse.com');
SELECT pg_temp.chk('3a üye kendini görür', '1', (SELECT count(*)::text FROM public.profiles WHERE id = :ali));
SELECT pg_temp.chk('3b üye takımdaşını görür (Claude)', '1', (SELECT count(*)::text FROM public.profiles WHERE id = :claude));
SELECT pg_temp.chk('3c üye, takımı olmayan yabancıyı göremez', '0', (SELECT count(*)::text FROM public.profiles WHERE id = :outsider));
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('3d takımdaşı olmayan gerçek profil yok mu? (bilgi)', 'bilgi',
  'bilgi: ' || (SELECT count(*) FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.user_id = p.id))::text || ' takımsız profil');
UPDATE _r SET ok = true WHERE step LIKE '3d%';

-- 4) Davet token'ı: yabancı ve alakasız üye göremez
SELECT pg_temp.as_user(:outsider, 'yabanci@example.invalid');
SELECT pg_temp.chk('4a yabancı davet token göremez', '0', (SELECT count(*)::text FROM public.team_invitations));
SELECT pg_temp.as_user(:claude, 'no@mail.co');
SELECT pg_temp.chk('4b üye yalnızca kendi takımının davetlerini görür', 'true',
  (SELECT (count(*) = 0)::text FROM public.team_invitations i WHERE NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.team_id = i.team_id AND m.user_id = :claude) AND lower(i.email) <> 'no@mail.co'));
SELECT pg_temp.chk('4c süresiz davet kalmadı', '0', (SELECT count(*)::text FROM public.team_invitations WHERE expires_at IS NULL));

-- 5) Storage politikaları: silme yalnızca sahibi + yönetici
SELECT pg_temp.as_admin();
SELECT pg_temp.chk('5a storage delete politikaları', 'storage_delete_admin,storage_delete_own',
  (SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd='DELETE'));
SELECT pg_temp.chk('5b storage insert yalnızca authenticated', 'true',
  (SELECT (count(*) = 0)::text FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd='INSERT' AND 'anon' = ANY(roles::text[])));

-- 6) RPC yetkileri: anon'a açık kritik fonksiyon yok
SELECT pg_temp.chk('6a anon EXECUTE alamayan fonksiyonlar', 'true',
  (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'execute'))::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('join_team_by_code','accept_invitation','accept_invitation_by_id','add_team_member_by_email','import_bundle','reorder_tickets','merge_user_prefs','telegram_link_code','telegram_unlink','notify_import_summary','set_import_author','log_import_completion')));

-- 7) Kod deneme sınırı: 5 hatalı denemeden sonra 6.'sı kilitlenir
SELECT pg_temp.as_user(:outsider, 'yabanci@example.invalid');
SELECT pg_temp.chk('7a kısa kod reddedilir', 'Geçersiz takım kodu', (SELECT public.join_team_by_code('ABC')->>'error'));
SELECT public.join_team_by_code('YANLISKOD' || i) FROM generate_series(1, 4) i;  -- 7a ile birlikte 5 hatalı deneme
SELECT pg_temp.chk('7b 6. hatalı deneme kilitlenir', 'true', (SELECT (public.join_team_by_code('YANLISKOD9')->>'locked')));

-- 8) Çizim / whiteboard (096, #cf0c7678): beta açmayan görmez, sahne öğe başına birleşir
\set drawing '''00000000-0000-4000-8000-0000000c0de1'''
\set demo '''e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7'''
SELECT pg_temp.as_admin();
INSERT INTO public.pages (id, team_id, title, kind, created_by) VALUES (:drawing, :demo, 'RLS denetim çizimi', 'drawing', :claude);
DELETE FROM public.user_preferences WHERE user_id = :claude AND scope = 'global' AND prefs ? 'beta';
SELECT pg_temp.as_user(:claude, 'no@mail.co');
SELECT pg_temp.chk('8a betasız üye çizimi görmez', '0', (SELECT count(*)::text FROM public.pages WHERE id = :drawing));
SELECT pg_temp.chk('8b betasız üyeye yalnız tür ipucu', 'drawing', coalesce(public.hidden_page_kind(:drawing), 'null'));
SELECT pg_temp.chk('8c betasız üye kanala katılamaz', 'false', public.canvas_topic_access('canvas:' || :drawing, false)::text);
SELECT public.merge_user_prefs('global', '{"beta": {"drawing": true}}'::jsonb);
SELECT pg_temp.chk('8d betalı üye görür', '1', (SELECT count(*)::text FROM public.pages WHERE id = :drawing));
SELECT pg_temp.chk('8e betalı üye kanala yazar', 'true', public.canvas_topic_access('canvas:' || :drawing, true)::text);
SELECT pg_temp.chk('8f bozuk kanal adı reddedilir', 'false', public.canvas_topic_access('canvas:' || :drawing || 'x', false)::text);
SELECT pg_temp.chk('8g whiteboard betası ayrı', 'reddedildi',
  pg_temp.try_write(format('INSERT INTO public.pages (team_id, title, kind, created_by) VALUES (%L, ''x'', ''whiteboard'', %L)', :demo, :claude)));
SELECT public.save_page_scene(:drawing, '[{"id":"a","version":2,"versionNonce":5},{"id":"b","version":1,"versionNonce":9}]'::jsonb);
SELECT public.save_page_scene(:drawing, '[{"id":"a","version":1,"versionNonce":1},{"id":"b","version":1,"versionNonce":3},{"id":"c","version":1,"versionNonce":1}]'::jsonb);
SELECT pg_temp.chk('8h birleştirme: büyük sürüm, eşitlikte küçük nonce', 'a:2:5,b:1:3,c:1:1',
  (SELECT string_agg((e->>'id') || ':' || (e->>'version') || ':' || (e->>'versionNonce'), ',' ORDER BY e->>'id') FROM public.page_scenes s, jsonb_array_elements(s.elements) e WHERE s.page_id = :drawing));
SELECT pg_temp.chk('8i sahne tabloya doğrudan yazılamaz', 'reddedildi', pg_temp.try_write(format('UPDATE public.page_scenes SET elements = ''[]'' WHERE page_id = %L', :drawing)));
SELECT pg_temp.chk('8j çizimin altına sayfa eklenemez', 'reddedildi',
  pg_temp.try_write(format('INSERT INTO public.pages (team_id, parent_page_id, title, created_by) VALUES (%L, %L, ''x'', %L)', :demo, :drawing, :claude)));
SELECT pg_temp.chk('8k tür değişmez', 'reddedildi', pg_temp.try_write(format('UPDATE public.pages SET kind = ''page'' WHERE id = %L', :drawing)));
SELECT pg_temp.as_user(:outsider, 'yabanci@example.invalid');
SELECT pg_temp.chk('8l yabancıya tür ipucu yok', 'null', coalesce(public.hidden_page_kind(:drawing), 'null'));
SELECT pg_temp.chk('8m yabancı sahne kaydedemez', 'reddedildi', pg_temp.try_write(format('SELECT public.save_page_scene(%L, ''[]''::jsonb)', :drawing)));
SELECT pg_temp.chk('8n yabancı kanala katılamaz', 'false', public.canvas_topic_access('canvas:' || :drawing, false)::text);

-- ── Sonuç ────────────────────────────────────────────────────────────────────
SELECT pg_temp.as_admin();
SELECT step || ' | bekl: ' || expected || ' | gerçek: ' || actual || ' | ' || CASE WHEN ok THEN 'GEÇTİ' ELSE '*** KALDI ***' END FROM _r WHERE NOT ok OR step NOT LIKE '1 %' ORDER BY step;
SELECT count(*) FILTER (WHERE ok AND step LIKE '1 %') || ' tablo yabancıya kapalı, ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' kontrol geçti' FROM _r;

ROLLBACK;
