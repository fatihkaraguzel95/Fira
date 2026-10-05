-- 066: Sayfalardaki dosyalar yetim sayılmasın (#AAC9D463)
--
-- admin_orphan_files (051) bir depolama nesnesini, hiçbir sütun ona işaret
-- etmiyorsa "yetim" listeler; Yönetim ekranı bu listeden toplu silme yapar.
-- 064 sayfaları getirdi ve sayfa içeriği (markdown) görsel/dosya URL'leri
-- taşıyor — ama liste sayfalara bakmıyordu: sayfaya yapıştırılan her görsel ve
-- OneNote'tan aktarılacak ~700 dosya yetim görünür, silinebilirdi.
-- Kural (CLAUDE.md, Storage temizliği): yeni bir dosya referansı sütunu bu
-- sorguya da eklenir.

CREATE OR REPLACE FUNCTION public.admin_orphan_files()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'bucket', o.bucket_id, 'size', (o.metadata->>'size')::bigint, 'created_at', o.created_at) ORDER BY o.created_at), '[]'::jsonb)
  INTO r
  FROM storage.objects o
  WHERE o.bucket_id = 'ticket-attachments'
    AND o.name NOT LIKE '%/'  -- folders
    AND NOT EXISTS (SELECT 1 FROM ticket_attachments a WHERE a.file_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.icon_url LIKE '%/' || o.name || '%' OR p.background_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.avatar_url LIKE '%/' || o.name || '%' OR p.avatar_full_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.description LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM ticket_comments c WHERE c.content LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM pages pg WHERE pg.content LIKE '%/' || o.name || '%');
  RETURN r;
END $function$;

REVOKE ALL ON FUNCTION public.admin_orphan_files() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_orphan_files() TO authenticated;

-- 064'teki tetikleyici fonksiyonu SECURITY DEFINER; doğrudan çağrılamasın
-- (CLAUDE.md, Güvenlik: yeni SECURITY DEFINER fonksiyon → REVOKE).
REVOKE ALL ON FUNCTION public.pages_before_write() FROM public, anon, authenticated;
