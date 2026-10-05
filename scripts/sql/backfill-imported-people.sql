-- Tek seferlik: eski Planner içe aktarmalarındaki kişileri geri kazan (ticket #BEE700).
--
-- İlk aktarmalar, Fira'da hesabı olmayan kişileri atayamıyor, adlarını yalnızca
-- açıklamaya ("Eşleşmeyen atananlar: …", "Oluşturan: …") ve tamamlanma kaydının
-- meta.by_name alanına yazıyordu. Bu script o adları okuyup:
--   1) her biri için "içe aktarma" profili açar (e-posta ve Planner kimliğiyle),
--   2) atamalarını geri kurar,
--   3) tamamlanma ve oluşturma aktivite kayıtlarını o kişilere bağlar.
--
-- E-postalar dışa aktarım dosyalarının "Kullanıcılar" sayfasından gelir; kişi
-- aynı e-posta ile Fira'ya kayıt olduğunda geçmişi hesabına devredilir (040).
-- Kullanıcı listesinde hiç geçmeyen Planner kimlikleri için e-postasız, kimlikle
-- ayırt edilen bir kayıt açılır.
--
-- Tekrar çalıştırmak güvenli: var olan profil bulunur, var olan atama atlanır.
-- Atama sırasında assignees_activity tetikleyicisi kapatılır — aksi hâlde günlüğe
-- "bugün atandı" satırları düşerdi.
--
-- Çalıştırma: base64 ile sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t < backfill-imported-people.sql
\pset format unaligned
BEGIN;
SET LOCAL search_path = public;

-- Dışa aktarım dosyalarının "Kullanıcılar" sayfasındaki kişiler.
CREATE TEMP TABLE known_people (name text, email text, guid text);
INSERT INTO known_people VALUES
  ('Halil Ibrahim Aydin', 'Halil.Aydin@epiuse.com',        '4bbaafaa-4322-4b93-a911-10483cbd6e97'),
  ('Fatih Karaguezel',    'fatih.karaguezel@epiuse.com',   '44afb272-1ef9-4bbb-a7fc-bc827d4f0e83'),
  ('Ilker Topcu',         'ilker.topcu@epiuse.com',        'cdce2d70-94d8-4cc8-b269-47f153ef5dc2'),
  ('Salih Talha Akgün',   'salih.talha.akgun@epiuse.com',  '3eb56bca-6ff4-42ca-9a01-357fff33434c'),
  ('Nihatcan Oencuel',    'nihatcan.oencuel@epiuse.com',   'c76a5805-aa33-4422-983e-5d1306e102e3'),
  ('Yavuz Dogdu',         'yavuz.dogdu@epiuse.com',        'd5916423-e216-4f7a-871e-bfd8a71d790b');

-- Açıklamalarda geçen bütün adlar (kullanıcı listesinde olmayan Planner kimlikleri dahil).
CREATE TEMP TABLE mentioned AS
SELECT DISTINCT btrim(x) AS name FROM tickets t
CROSS JOIN LATERAL regexp_match(t.description, 'Eşleşmeyen atananlar: ([^' || chr(10) || ']*)') m
CROSS JOIN LATERAL unnest(string_to_array(m[1], ',')) x
WHERE m[1] IS NOT NULL AND btrim(x) <> ''
UNION
SELECT DISTINCT btrim(m[1]) FROM tickets t
CROSS JOIN LATERAL regexp_match(t.description, 'Oluşturan: ([^' || chr(10) || ']*)') m
WHERE m[1] IS NOT NULL AND btrim(m[1]) <> ''
UNION
SELECT DISTINCT btrim(meta ->> 'by_name') FROM ticket_activity WHERE meta ->> 'by_name' IS NOT NULL;

SELECT '--- açıklamalarda geçen kişi sayısı: ' || count(*)::text FROM mentioned;

-- Her ad için hedef profil: önce e-postadan, sonra addan; yoksa yeni "içe aktarma" kaydı.
CREATE TEMP TABLE person_map AS
SELECT m.name,
       k.email,
       COALESCE(k.guid, CASE WHEN m.name ~ '^[0-9a-f-]{36}$' THEN m.name END) AS guid,
       CASE WHEN m.name ~ '^[0-9a-f-]{36}$' THEN 'Planner kullanıcısı ' || left(m.name, 8) ELSE m.name END AS display_name,
       COALESCE(
         (SELECT p.id FROM profiles p WHERE k.email IS NOT NULL AND lower(p.email) = lower(k.email)),
         (SELECT p.id FROM profiles p WHERE lower(p.full_name) = lower(m.name)),
         (SELECT p.id FROM profiles p WHERE p.source = 'import' AND p.external_id = m.name)
       ) AS profile_id
FROM mentioned m LEFT JOIN known_people k ON lower(k.name) = lower(m.name);

INSERT INTO profiles (id, email, full_name, source, imported_from, imported_at, external_id)
SELECT gen_random_uuid(), pm.email, pm.display_name, 'import', 'Microsoft Planner', now(), pm.guid
FROM person_map pm WHERE pm.profile_id IS NULL;

UPDATE person_map pm SET profile_id = p.id
FROM profiles p
WHERE pm.profile_id IS NULL
  AND ((pm.email IS NOT NULL AND lower(p.email) = lower(pm.email)) OR (pm.email IS NULL AND p.full_name = pm.display_name));

SELECT '--- kişiler';
SELECT pm.name || ' → ' || coalesce(p.full_name, '?') || ' (' || p.source || coalesce(', ' || p.email, '') || ')'
FROM person_map pm JOIN profiles p ON p.id = pm.profile_id ORDER BY 1;

-- 1) Atamaları geri kur.
ALTER TABLE ticket_assignees DISABLE TRIGGER assignees_activity;
INSERT INTO ticket_assignees (ticket_id, user_id)
SELECT DISTINCT t.id, pm.profile_id
FROM tickets t
CROSS JOIN LATERAL regexp_match(t.description, 'Eşleşmeyen atananlar: ([^' || chr(10) || ']*)') m
CROSS JOIN LATERAL unnest(string_to_array(m[1], ',')) x
JOIN person_map pm ON lower(pm.name) = lower(btrim(x))
WHERE m[1] IS NOT NULL AND pm.profile_id IS NOT NULL
ON CONFLICT DO NOTHING;
ALTER TABLE ticket_assignees ENABLE TRIGGER assignees_activity;

SELECT '--- içe aktarma kişilerine bağlı atama sayısı';
SELECT count(*)::text FROM ticket_assignees a JOIN profiles p ON p.id = a.user_id WHERE p.source = 'import';

-- 2) Tamamlanma kayıtlarının aktörünü bağla.
UPDATE ticket_activity a SET actor_id = pm.profile_id
FROM person_map pm
WHERE a.actor_id IS NULL AND lower(a.meta ->> 'by_name') = lower(pm.name) AND pm.profile_id IS NOT NULL;

-- 3) "Oluşturuldu" kaydının aktörünü Planner'daki oluşturana bağla
--    (görevin Fira'daki created_by alanı, kaydı gerçekten oluşturan hesapta kalır).
UPDATE ticket_activity a SET actor_id = pm.profile_id
FROM tickets t
CROSS JOIN LATERAL regexp_match(t.description, 'Oluşturan: ([^' || chr(10) || ']*)') m
JOIN person_map pm ON lower(pm.name) = lower(btrim(m[1]))
WHERE a.ticket_id = t.id AND a.kind = 'created' AND m[1] IS NOT NULL AND pm.profile_id IS NOT NULL;

SELECT '--- sonuç';
SELECT 'içe aktarma profili: ' || count(*)::text FROM profiles WHERE source = 'import';
SELECT 'aktörü içe aktarma kişisi olan aktivite: ' || count(*)::text
FROM ticket_activity a JOIN profiles p ON p.id = a.actor_id WHERE p.source = 'import';
SELECT 'hâlâ aktörsüz tamamlanma kaydı: ' || count(*)::text FROM ticket_activity WHERE actor_id IS NULL AND (meta ->> 'imported') = 'true';
COMMIT;
