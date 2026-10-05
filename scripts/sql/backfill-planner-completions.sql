-- Tek seferlik: eski Planner içe aktarmalarında tamamlanma bilgisini geri kazan.
--
-- İlk aktarmalar, "Tamamlanma Tarihi" ve "Tarafından tamamlanmıştır" alanlarını
-- yalnızca açıklamadaki "Planner alanları" bloğuna yazıyordu; durumu Tamamlandı
-- olan görevler de kutularında kalıyordu (bkz. ticket #C0ADED). Bu script o iki
-- bilgiyi açıklamadan geri okuyup:
--   1) durumu Tamamlandı olan görevleri listenin tamamlandı sütununa taşır,
--   2) tamamlanmayı aktivite günlüğüne gerçek tarihi ve kişisiyle yazar.
--
-- Tekrar çalıştırmak güvenli: kaydı olan görev atlanır. Taşıma sırasında
-- tickets_activity_upd tetikleyicisi kapatılır, çünkü geçiş bugünün tarihiyle
-- değil, gerçek tamamlanma tarihiyle yazılıyor.
--
-- Çalıştırma: base64 ile sunucuya kopyala → docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t < backfill-planner-completions.sql

\pset format unaligned
BEGIN;
SET LOCAL search_path = public;

-- Aktarılan görevlerden tamamlanma satırını ayıkla: "- Tamamlanma: 2026-08-19 (Halil Ibrahim Aydin)"
CREATE TEMP TABLE src AS
SELECT t.id AS ticket_id, t.project_id, p.name AS list, s.name AS from_status, s.category AS from_category,
       m[1] AS done_date, NULLIF(btrim(coalesce(m[2],'')),'') AS done_by,
       (t.description LIKE '%Durum (Planner): Tamamlandı%') AS progress_done
FROM tickets t
JOIN projects p ON p.id = t.project_id
JOIN ticket_statuses s ON s.id = t.status_id
CROSS JOIN LATERAL regexp_match(t.description, 'Tamamlanma: (\d{4}-\d{2}-\d{2})(?: \(([^)]*)\))?') AS m
WHERE t.description LIKE '%**Planner alanları**%' AND m[1] IS NOT NULL;   -- regexp_match eşleşmezse NULL satır döner

SELECT '--- kaynak satırlar';
SELECT list||' | '||count(*)||' tamamlanma kaydı | adı olan: '||count(*) FILTER (WHERE done_by IS NOT NULL) FROM src GROUP BY list;

SELECT '--- tamamlayan adları ve Fira karşılıkları';
SELECT coalesce(s.done_by,'(ad yok)')||' → '||coalesce(max(pr.full_name),'EŞLEŞMEDİ')||' ('||count(*)||')'
FROM src s LEFT JOIN profiles pr ON lower(pr.full_name) = lower(s.done_by)
GROUP BY s.done_by ORDER BY count(*) DESC;

-- 1) Kutusu farklı ama durumu Tamamlandı olanları tamamlandı sütununa taşı.
--    Tetikleyici susturulur: geçiş, aşağıda gerçek tarihiyle günlüğe yazılacak.
ALTER TABLE tickets DISABLE TRIGGER tickets_activity_upd;
WITH done AS (
  SELECT DISTINCT ON (project_id) project_id, id, name
  FROM ticket_statuses WHERE category IN ('done','closed') ORDER BY project_id, order_index
)
UPDATE tickets t SET status_id = d.id, status = d.name, updated_by = 'b7b4c570-4b45-492e-9e02-5970c88ee48c'
FROM src s JOIN done d ON d.project_id = s.project_id
WHERE t.id = s.ticket_id AND s.progress_done AND t.status_id <> d.id;
ALTER TABLE tickets ENABLE TRIGGER tickets_activity_upd;

SELECT '--- taşınan görev sayısı';
SELECT count(*)::text FROM src s JOIN tickets t ON t.id=s.ticket_id JOIN ticket_statuses st ON st.id=t.status_id
WHERE s.progress_done AND st.name <> s.from_status;

-- 2) Tamamlanma geçişini günlüğe yaz (gerçek tarih + kişi).
INSERT INTO ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta, created_at)
SELECT s.ticket_id, pr.id, 'status',
       NULLIF(s.from_status, st.name),
       st.name,
       jsonb_build_object('to_category', st.category, 'to_color', st.color, 'by_name', s.done_by, 'imported', true, 'backfilled', true),
       (s.done_date || ' 12:00:00+00')::timestamptz
FROM src s
JOIN tickets t ON t.id = s.ticket_id
JOIN ticket_statuses st ON st.id = t.status_id
LEFT JOIN profiles pr ON lower(pr.full_name) = lower(s.done_by)
WHERE NOT EXISTS (
  SELECT 1 FROM ticket_activity a WHERE a.ticket_id = s.ticket_id AND a.kind = 'status' AND (a.meta->>'imported') = 'true'
);

SELECT '--- yazılan aktivite kaydı';
SELECT count(*)::text FROM ticket_activity WHERE (meta->>'imported')='true';
SELECT '--- örnek kayıtlar';
SELECT t.title||' | '||coalesce(a.from_value,'—')||' → '||a.to_value||' | '||to_char(a.created_at,'YYYY-MM-DD')||' | '||coalesce(pr.full_name, a.meta->>'by_name','?')
FROM ticket_activity a JOIN tickets t ON t.id=a.ticket_id LEFT JOIN profiles pr ON pr.id=a.actor_id
WHERE (a.meta->>'imported')='true' ORDER BY a.created_at DESC LIMIT 5;
SELECT '--- Rewe sütun dağılımı (sonuç)';
SELECT st.name||' ('||st.category||'): '||count(*) FROM tickets t JOIN ticket_statuses st ON st.id=t.status_id JOIN projects p ON p.id=t.project_id
WHERE p.name='Rewe' GROUP BY st.name, st.category, st.order_index ORDER BY st.order_index;
COMMIT;
