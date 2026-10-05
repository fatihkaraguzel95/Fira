-- 089: Gelen kutusu birleştirmesini geri getir (#746B62E9)
--
-- Gerileme: 085 (tekrarlayan görevler) `notifications_fanout`'u yalnız yeni
-- 'reminder' olayını eklemek için yeniden yazarken gövdeyi **058'den** aldı;
-- 060'ın getirdiği birleştirme (aynı görev, 3 dk penceresi, group_count) ve
-- 076'nın 'mention' olayı o sırada düştü. Sonuç: bir göreve arka arkaya gelen
-- atama + yorum + durum değişikliği yine üç ayrı satır üretiyordu.
--
-- Burada 076'nın gövdesi, 085'in eklediği 'reminder' olayıyla birlikte geri
-- konuyor. DİKKAT: bu fonksiyonu ileride yeniden yazarken taban olarak **en
-- son** sürümü al; yeni bir olay türü eklemek gövdeyi baştan yazmayı gerektirmez.

CREATE OR REPLACE FUNCTION public.notifications_fanout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event  text;
  v_title  text;
  v_project uuid;
  v_rec    record;
  v_existing uuid;
BEGIN
  -- İçe aktarma satırları (BEFORE tetiği meta.bulk damgalar) kutuya düşmez.
  IF coalesce(NEW.meta ->> 'bulk', 'false') = 'true' THEN RETURN NEW; END IF;

  v_event := CASE NEW.kind
    WHEN 'assignee_added'   THEN 'assigned'
    WHEN 'comment_added'    THEN 'comment'
    WHEN 'status'           THEN 'status'
    WHEN 'child_added'      THEN 'subtask'
    WHEN 'attachment_added' THEN 'file'
    WHEN 'mentioned'        THEN 'mention'
    WHEN 'reminder'         THEN 'reminder'
    ELSE NULL END;
  IF v_event IS NULL THEN RETURN NEW; END IF;

  SELECT title, project_id INTO v_title, v_project FROM public.tickets WHERE id = NEW.ticket_id;

  FOR v_rec IN SELECT user_id FROM public.activity_recipients(NEW.id) LOOP
    -- Aynı göreve ait yakın tarihli bildirim (aktör kim olursa olsun) bu güncellemeyi toplar.
    SELECT id INTO v_existing
      FROM public.user_notifications
     WHERE user_id = v_rec.user_id
       AND ticket_id = NEW.ticket_id
       AND created_at > now() - interval '3 minutes'
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      UPDATE public.user_notifications
         SET activity_id  = NEW.id,
             event        = v_event,
             actor_id     = NEW.actor_id,
             value        = left(NEW.to_value, 300),
             ticket_title = v_title,
             created_at   = now(),
             read_at      = NULL,          -- yeni değişiklik görevi tekrar okunmamış yapar
             group_count  = group_count + 1
       WHERE id = v_existing;
    ELSE
      INSERT INTO public.user_notifications
        (user_id, activity_id, ticket_id, project_id, event, actor_id, value, ticket_title, group_count, group_started_at)
      VALUES
        (v_rec.user_id, NEW.id, NEW.ticket_id, v_project, v_event, NEW.actor_id, left(NEW.to_value, 300), v_title, 1, now())
      ON CONFLICT (user_id, activity_id) DO NOTHING;
    END IF;
  END LOOP;

  -- Saklama: 90 gün, yalnız burada dokunulan alıcılar için.
  DELETE FROM public.user_notifications n
  USING public.activity_recipients(NEW.id) r
  WHERE n.user_id = r.user_id AND n.created_at < now() - interval '90 days';

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notifications_fanout() FROM public, anon, authenticated;

-- 085 ile gerileme arasında açılmış satırlarda group_started_at boş kalmış olabilir.
UPDATE public.user_notifications SET group_started_at = created_at WHERE group_started_at IS NULL;
