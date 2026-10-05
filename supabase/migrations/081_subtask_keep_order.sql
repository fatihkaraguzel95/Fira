-- 081: Alt görev tamamlanınca (ya da durumu değişince) sırası değişmesin (#9da49444, v0.37.1)
--
-- 045'in "durum değişince hedef sütunun en üstüne" kuralı alt görevlere de uygulanıyordu.
-- Alt görevin order_index'i aynı zamanda üst görevin alt görev listesindeki sırasıdır
-- (görev penceresi ChildTicketList, yeni liste buildRows): kural onu sütundaki en küçük
-- değerin bir altına çektiği için tamamlanan alt görev listenin başına zıplıyordu.
-- Kural artık yalnız üst düzey görevlere (parent_id null) uygulanır; alt görev durum
-- değiştirince yerinde kalır. Elle sıralama (reorder_tickets, useReorderChildren) aynen çalışır.
-- Yalnız fonksiyon gövdesi değişir; eski istemci etkilenmez.
create or replace function public.ticket_top_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status_id is distinct from old.status_id
     and new.parent_id is null
     and new.order_index is not distinct from old.order_index
     and coalesce(current_setting('fira.manual_reorder', true), '') <> '1'
  then
    select coalesce(min(order_index), 0) - 1
      into new.order_index
      from public.tickets
     where status_id = new.status_id
       and id <> new.id;
  end if;
  return new;
end;
$$;
