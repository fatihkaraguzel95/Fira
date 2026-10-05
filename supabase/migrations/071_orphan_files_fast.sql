-- Yetim dosya listesi 500 dönüyordu (#F236F25C).
--
-- Eski sorgu her depolama nesnesi için her metin sütununda ayrı `LIKE '%…%'`
-- taraması yapıyordu: 8.765 nesne × (görev + yorum + sayfa + sürüm) satırları.
-- Sayfalar (064) ve sürümleri (067) geldikçe maliyet patladı — ölçüm: yalnız
-- `pages` şartı 97 sn, 400 nesnelik örnekte bütün şartlar 151 sn. PostgREST'in
-- 8 sn'lik `statement_timeout`'una takılıp 500 dönüyordu.
--
-- Yeni yol: referans verilen yollar **bir kez** çıkarılır (metinler yalnız bir
-- kez taranır), sonra depolama nesneleriyle anti-join yapılır: 4,6 sn.
-- Doğrulama: 400 nesnelik örnekte iki yöntem birebir aynı sonucu verdi
-- (0 fark, 129 referanslı).
--
-- Dönüş şekli de değişti: liste artık ilk 1000 ile sınırlı, toplam sayı ve
-- boyut ayrıca dönüyor — 6.000 satırlık tabloyu tarayıcıya yıkmak ve hepsini
-- tek silme isteğine koymak kendi başına bir sorundu.

CREATE OR REPLACE FUNCTION public.admin_orphan_files()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  -- Bakım sorgusu: 8 sn'lik varsayılan sınır bunun için fazla dar.
  SET LOCAL statement_timeout = '60s';

  WITH src AS (
    SELECT file_url AS txt FROM ticket_attachments WHERE file_url IS NOT NULL
    UNION ALL SELECT icon_url FROM projects WHERE icon_url IS NOT NULL
    UNION ALL SELECT background_url FROM projects WHERE background_url IS NOT NULL
    UNION ALL SELECT avatar_url FROM profiles WHERE avatar_url IS NOT NULL
    UNION ALL SELECT avatar_full_url FROM profiles WHERE avatar_full_url IS NOT NULL
    UNION ALL SELECT cover_url FROM tickets WHERE cover_url IS NOT NULL
    UNION ALL SELECT description FROM tickets WHERE description LIKE '%/object/public/ticket-attachments/%'
    UNION ALL SELECT content FROM ticket_comments WHERE content LIKE '%/object/public/ticket-attachments/%'
    UNION ALL SELECT content FROM pages WHERE content LIKE '%/object/public/ticket-attachments/%'
    UNION ALL SELECT content FROM page_versions WHERE content LIKE '%/object/public/ticket-attachments/%'
  ), refs AS MATERIALIZED (
    -- Bir metinde geçen her depolama yolu. Parçalama + baştan eşleme, global
    -- regexp taramasından ucuz; yollarımız kaçışsız (ASCII) üretiliyor.
    SELECT DISTINCT substring(piece FROM '^[^)"''[:space:]]+') AS path
    FROM src, LATERAL regexp_split_to_table(src.txt, '/object/public/ticket-attachments/') WITH ORDINALITY AS t(piece, n)
    WHERE t.n > 1
  ), orph AS MATERIALIZED (
    SELECT o.name, (o.metadata->>'size')::bigint AS size, o.created_at
    FROM storage.objects o
    WHERE o.bucket_id = 'ticket-attachments'
      AND o.name NOT LIKE '%/'                      -- klasör kayıtları
      AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.path = o.name)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM orph),
    'total_bytes', (SELECT coalesce(sum(size), 0) FROM orph),
    'limit', 1000,
    'files', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'bucket', 'ticket-attachments', 'size', size, 'created_at', created_at) ORDER BY created_at), '[]'::jsonb)
      FROM (SELECT * FROM orph ORDER BY created_at LIMIT 1000) z
    )
  ) INTO r;
  RETURN r;
END $function$;

REVOKE ALL ON FUNCTION public.admin_orphan_files() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_orphan_files() TO authenticated;
