-- Yetim dosya taraması avatarları yetim sanıyordu (#7EFB0246).
--
-- 071 referansları metinden çıkarırken yolu olduğu gibi alıyordu; avatar
-- adresleri ise önbellek kırmak için "?t=…" ile saklanıyor:
--   profiles.avatar_url = …/ticket-attachments/avatars/<id>/avatar.webp?t=1
-- Depolamadaki nesnenin adı "avatars/<id>/avatar.webp" olduğu için eşleşme
-- tutmadı, dosya yetim listesine düştü ve yönetim temizliğinde silindi.
-- (051'deki eski sorgu `LIKE '%' || o.name || '%'` yaptığı için sorgu dizesi
-- zararsızdı; hız düzeltmesiyle birlikte bu tolerans kayboldu.)
--
-- Düzeltme: çıkarılan her yoldan sorgu dizesi ve çapa (#…) atılır — istemci
-- tarafındaki `storagePathFromUrl` ile aynı kural. Ayrıca yüzde kaçışlı yollar
-- için çözülmüş hâl de referans sayılır (bugün böyle bir ad yok; adres
-- kodlaması dosya adına Türkçe harf ya da boşluk girdiği gün aynı kaza
-- tekrarlamasın diye).

CREATE OR REPLACE FUNCTION public.url_decode(input text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path TO 'public' AS $function$
DECLARE bin bytea := ''; piece text;
BEGIN
  IF position('%' in input) = 0 THEN RETURN input; END IF;
  FOR piece IN SELECT (regexp_matches(input, '(%[0-9a-fA-F]{2}|.)', 'g'))[1] LOOP
    IF length(piece) = 3 THEN bin := bin || decode(substring(piece, 2, 2), 'hex');
    ELSE bin := bin || convert_to(piece, 'utf8'); END IF;
  END LOOP;
  RETURN convert_from(bin, 'utf8');
EXCEPTION WHEN others THEN RETURN input;   -- bozuk kaçış: ham hâli kullan
END $function$;

REVOKE ALL ON FUNCTION public.url_decode(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.url_decode(text) TO authenticated;

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
  ), raw AS MATERIALIZED (
    -- Bir metinde geçen her depolama yolu. Parçalama + baştan eşleme, global
    -- regexp taramasından ucuz.
    SELECT DISTINCT split_part(split_part(substring(piece FROM '^[^)"''[:space:]]+'), '#', 1), '?', 1) AS path
    FROM src, LATERAL regexp_split_to_table(src.txt, '/object/public/ticket-attachments/') WITH ORDINALITY AS t(piece, n)
    WHERE t.n > 1
  ), refs AS MATERIALIZED (
    SELECT path FROM raw WHERE path <> ''
    UNION
    SELECT public.url_decode(path) FROM raw WHERE path LIKE '%\%%'
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
