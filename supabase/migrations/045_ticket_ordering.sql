-- 045: Sütun içi sıralama kuralları
--
-- İki kural var:
--   1) Görev durumu değiştiğinde (Durum alanından, kart menüsünden, alt görev
--      satırından — nereden olursa olsun) hedef sütunun EN ÜSTÜNE gider.
--   2) Elle sürükle-bırak yapılan sıra bunu ezer; elle sıralanmış sütuna durum
--      değişikliğiyle gelen yeni görev yine en üste yerleşir.
--
-- Sürükle-bırak artık tek RPC ile yazılıyor (eskiden kart başına bir UPDATE).
-- RPC, işlem boyunca `fira.manual_reorder` bayrağını kaldırıyor; trigger bu
-- bayrağı görünce araya girmiyor, yani sürüklenen kart bırakıldığı yerde kalıyor.

-- 1) Sürükle-bırak: verilen sıra aynen yazılır, filtreyle gizlenmiş kartlar
--    (ör. "kapatılanları gizle" açıkken tamamlanmış görevler) kendi aralarındaki
--    sırayı koruyarak listenin altına iner. Böylece gizli kartlar görünenlerin
--    arasına karışmaz ve gizliyken bir sütuna bırakılan görev, kapatılanlar
--    tekrar gösterildiğinde de en üstte kalır.
--
-- p_columns: [{ "status_id": "<uuid>", "ids": ["<uuid>", ...] }, ...]
create or replace function public.reorder_tickets(p_columns jsonb)
returns void
language plpgsql
as $$
declare
  col jsonb;
  v_status uuid;
  v_ids uuid[];
  v_count int;
begin
  if p_columns is null or jsonb_typeof(p_columns) <> 'array' then
    raise exception 'p_columns bir JSON dizisi olmalı';
  end if;

  -- Trigger'a "bu sıralama elle yapıldı, karışma" demenin yolu (işlem boyunca geçerli).
  perform set_config('fira.manual_reorder', '1', true);

  for col in select value from jsonb_array_elements(p_columns) loop
    v_status := (col->>'status_id')::uuid;
    if v_status is null then
      continue;
    end if;

    select coalesce(array_agg(value::uuid order by ord), '{}')
      into v_ids
      from jsonb_array_elements_text(col->'ids') with ordinality as e(value, ord);

    v_count := coalesce(array_length(v_ids, 1), 0);

    if v_count > 0 then
      update public.tickets t
         set status_id = v_status,
             order_index = (u.ord - 1)::int,
             updated_at = now(),
             updated_by = auth.uid()
        from unnest(v_ids) with ordinality as u(id, ord)
       where t.id = u.id
         and (t.status_id is distinct from v_status or t.order_index is distinct from (u.ord - 1)::int);
    end if;

    update public.tickets t
       set order_index = v_count + h.rn - 1
      from (
        select id, row_number() over (order by order_index, created_at) as rn
          from public.tickets
         where status_id = v_status
           and not (id = any(v_ids))
      ) h
     where t.id = h.id
       and t.order_index is distinct from (v_count + h.rn - 1)::int;
  end loop;

  -- Bayrak işlem sonuna kadar yaşar; aynı işlemde sonra gelen durum değişiklikleri
  -- yine "en üste" kuralına tabi olsun diye burada bırakılıyor.
  perform set_config('fira.manual_reorder', '', true);
end;
$$;

comment on function public.reorder_tickets(jsonb) is
  'Kanban sürükle-bırak sırasını tek istekte yazar; listede olmayan (filtreli) kartlar sıralarını koruyarak altta kalır.';

revoke all on function public.reorder_tickets(jsonb) from public;
revoke all on function public.reorder_tickets(jsonb) from anon;  -- Supabase varsayılanı anon'a da verir
grant execute on function public.reorder_tickets(jsonb) to authenticated;

-- 2) Durum değişince en üste. Elle sıra (RPC) ve order_index'i açıkça veren
--    çağrılar (içe aktarma vb.) hariç tutulur.
create or replace function public.ticket_top_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status_id is distinct from old.status_id
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

drop trigger if exists tickets_top_on_status_change on public.tickets;
create trigger tickets_top_on_status_change
  before update on public.tickets
  for each row
  execute function public.ticket_top_on_status_change();
