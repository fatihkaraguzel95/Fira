-- 090: Davet kabul edilince davet edene haber ver (#9AB1F2D8)
--
-- İstek: "Takıma davet edilen üye, daveti kabul edip eklendiğinde bildirim gelsin."
-- 073 daveti davet edilenin kutusuna düşürüyordu; karşı yön eksikti — daveti
-- gönderen, kişinin katıldığını ancak üye listesine bakarak görebiliyordu.
--
-- Alıcılar: daveti gönderen + takımın sahibi/yöneticileri (katılan kişinin
-- kendisi hariç, tekrarsız). Yönetici de alıyor çünkü takıma kimin girdiği
-- yalnız daveti göndereni değil takımı yönetenleri de ilgilendiriyor.
--
-- Tetik `team_invitations` üzerinde: kabul üç ayrı RPC'den geçebiliyor
-- (028'de iki, 073'te bir) ve üçü de `status = 'accepted'` yazıyor.

ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_event_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_event_check
  CHECK (event IN ('assigned', 'comment', 'status', 'subtask', 'file', 'team_invite',
                   'mention', 'reminder', 'team_joined'));

-- Takım satırı göreve değil davete bağlı; görev satırı hâlâ göreve bağlı.
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_shape_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_shape_check
  CHECK ((event IN ('team_invite', 'team_joined') AND invitation_id IS NOT NULL AND ticket_id IS NULL)
      OR (event NOT IN ('team_invite', 'team_joined') AND ticket_id IS NOT NULL));

-- Silme ve haber verme **aynı** fonksiyonda: iki ayrı tetik olsaydı sıraya
-- bağlı kalırdık (silen sonra çalışırsa yeni satırları da süpürürdü).
CREATE OR REPLACE FUNCTION public.invitations_drop_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pending' THEN RETURN NEW; END IF;

  -- Karar verilen davetin kutudaki satırı (davet edilene giden) düşer.
  DELETE FROM public.user_notifications WHERE invitation_id = NEW.id;

  IF NEW.status = 'accepted' THEN
    INSERT INTO public.user_notifications
      (user_id, team_id, invitation_id, event, actor_id, value, ticket_title)
    SELECT r.user_id, NEW.team_id, NEW.id, 'team_joined', NEW.accepted_by, NEW.role, t.name
      FROM teams t
      CROSS JOIN LATERAL (
        SELECT DISTINCT m.user_id
          FROM public.team_members m
         WHERE m.team_id = NEW.team_id
           AND m.user_id IS DISTINCT FROM NEW.accepted_by
           AND (m.user_id = NEW.invited_by OR m.role IN ('owner', 'admin'))
      ) r
     WHERE t.id = NEW.team_id
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.invitations_drop_notification() FROM public, anon, authenticated;
