-- 051: Yetim dosya taraması liste arkaplanlarını canlı saysın
--
-- 043 ile listelere arkaplan (`projects.background_url`) geldi; dosyalar aynı bucket'a
-- (`ticket-attachments/<uid>/backgrounds/…`) yükleniyor. `admin_orphan_files()` bu sütunu
-- bilmiyordu: Yönetim → "Yetim dosyalar → Temizle" canlı arkaplanları da silecekti.
-- Sorgu ayrıca `LIKE '%' || name || '%'` kalıbından `'%/' || name` kalıbına alındı ki
-- kısa bir dosya adı başka bir yolun içinde tesadüfen geçince yanlış eşleşmesin.

CREATE OR REPLACE FUNCTION public.admin_orphan_files() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    AND NOT EXISTS (SELECT 1 FROM ticket_comments c WHERE c.content LIKE '%/' || o.name || '%');
  RETURN r;
END $$;
