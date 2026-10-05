-- Tek seferlik: içe aktarılan görevlerin "Oluşturan" bilgisini düzelt (ticket #BEE700).
--
-- İlk aktarmalar görevleri aktarmayı yapan kişinin adına oluşturmuştu; Planner'daki
-- gerçek oluşturan yalnızca açıklamada duruyordu. Bu script açıklamadaki
-- "- Oluşturan: X" satırını okuyup görevin sahibini o kişiye çevirir ve "bu görevi
-- kim aktardı" bilgisini aktivite günlüğüne `imported` satırı olarak ekler.
--
-- Tekrar çalıştırmak güvenli: `imported` satırı olan görev atlanır.
-- Çalıştırma: base64 ile sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t < backfill-import-authors.sql
\pset format unaligned
BEGIN;
SET LOCAL search_path = public;

-- Dış sistemdeki ad ile Fira'daki ad her zaman aynı yazılmıyor (ör. "Ilker Topcu"
-- ↔ "Ali İlker Topçu"), o yüzden e-posta üzerinden de eşleştirilir.
CREATE TEMP TABLE name_mail (name text, email text);
INSERT INTO name_mail VALUES
  ('Halil Ibrahim Aydin', 'Halil.Aydin@epiuse.com'),
  ('Fatih Karaguezel',    'fatih.karaguezel@epiuse.com'),
  ('Ilker Topcu',         'ilker.topcu@epiuse.com'),
  ('Salih Talha Akgün',   'salih.talha.akgun@epiuse.com'),
  ('Nihatcan Oencuel',    'nihatcan.oencuel@epiuse.com'),
  ('Yavuz Dogdu',         'yavuz.dogdu@epiuse.com');

CREATE TEMP TABLE authors AS
SELECT t.id AS ticket_id, t.created_by AS importer, t.updated_at AS imported_at,
       btrim(m[1]) AS creator_name,
       COALESCE(
         (SELECT p.id FROM name_mail nm JOIN profiles p ON lower(p.email) = lower(nm.email) WHERE lower(nm.name) = lower(btrim(m[1]))),
         (SELECT p.id FROM profiles p WHERE lower(p.full_name) = lower(btrim(m[1])))
       ) AS creator_id
FROM tickets t
CROSS JOIN LATERAL regexp_match(t.description, 'Oluşturan: ([^' || chr(10) || ']*)') m
WHERE t.description LIKE '%**Planner alanları**%' AND m[1] IS NOT NULL;

SELECT '--- açıklamasında oluşturan yazan görev: ' || count(*)::text FROM authors;
SELECT '--- kişi eşleşmesi';
SELECT coalesce(creator_name,'?') || ' → ' || CASE WHEN creator_id IS NULL THEN 'EŞLEŞMEDİ' ELSE 'ok' END || ' (' || count(*) || ')'
FROM authors GROUP BY creator_name, (creator_id IS NULL) ORDER BY 1;

-- "Bu görev bir aktarmayla geldi" — aktaran kişi kayıtta kalsın.
INSERT INTO ticket_activity (ticket_id, actor_id, kind, to_value, meta, created_at)
SELECT a.ticket_id, a.importer, 'imported', 'Microsoft Planner',
       jsonb_build_object('imported', true, 'backfilled', true), a.imported_at
FROM authors a
WHERE NOT EXISTS (SELECT 1 FROM ticket_activity x WHERE x.ticket_id = a.ticket_id AND x.kind = 'imported');

-- Görevin sahibi: Planner'daki oluşturan.
UPDATE tickets t SET created_by = a.creator_id
FROM authors a WHERE t.id = a.ticket_id AND a.creator_id IS NOT NULL AND t.created_by <> a.creator_id;

SELECT '--- sonuç';
SELECT 'sahibi değişen görev: ' || count(*)::text FROM tickets t JOIN authors a ON a.ticket_id = t.id WHERE t.created_by = a.creator_id AND a.creator_id <> a.importer;
SELECT 'aktarma kaydı: ' || count(*)::text FROM ticket_activity WHERE kind = 'imported';
SELECT '--- örnek';
SELECT t.title || ' | oluşturan: ' || coalesce(p.full_name,'?') || ' (' || p.source || ') | aktaran: ' || coalesce(i.full_name,'?')
FROM authors a JOIN tickets t ON t.id = a.ticket_id JOIN profiles p ON p.id = t.created_by LEFT JOIN profiles i ON i.id = a.importer
LIMIT 3;
COMMIT;
