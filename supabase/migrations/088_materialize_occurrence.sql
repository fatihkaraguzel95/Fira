-- 088: Hayalet tekrarı şimdi göreve çevir (#59e0b75e, TK-5)
--
-- Gelecek tekrarlar görev olarak önceden üretilmez; listede "hayalet" satır
-- olarak görünürler (kural motorundan hesaplanır). Kullanıcı bir hayalete
-- "Şimdi oluştur" derse o tekrar zamanından önce gerçek göreve dönüşür ve seri
-- bir sonraki tekrara ilerler — üretim işi aynı tekrarı bir daha üretmez.

create or replace function public.materialize_occurrence(p_recurrence uuid, p_due timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r      public.ticket_recurrences%rowtype;
  v_no   int;
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'oturum yok'; end if;
  select * into r from public.ticket_recurrences where id = p_recurrence;
  if not found then raise exception 'seri bulunamadı'; end if;
  if not public.can_write_team(public.project_team(r.project_id)) then raise exception 'yetki yok'; end if;
  if not r.active then raise exception 'seri durdurulmuş'; end if;
  if p_due is null or p_due < now() - interval '1 day' then raise exception 'geçersiz tekrar zamanı'; end if;

  -- Aynı tekrar iki kez göreve dönüşmesin.
  select ticket_id into v_id from public.recurrence_occurrences
   where recurrence_id = r.id and due_at = p_due and outcome = 'created';
  if v_id is not null then return v_id; end if;

  select coalesce(max(occurrence_no), 1) + 1 into v_no from public.recurrence_occurrences where recurrence_id = r.id;
  v_id := public.recurrence_spawn(r.id, p_due, v_no);
  insert into public.recurrence_occurrences (recurrence_id, occurrence_no, due_at, outcome, ticket_id)
  values (r.id, v_no, p_due, 'created', v_id);

  -- Seri, elle öne çekilen tekrarın ötesine ilerler.
  if r.next_at <= p_due then
    update public.ticket_recurrences
       set next_at = coalesce(public.fira_next_for(r, p_due), next_at),
           active = public.fira_next_for(r, p_due) is not null,
           updated_at = now()
     where id = r.id;
  end if;
  return v_id;
end $$;

revoke all on function public.materialize_occurrence(uuid, timestamptz) from public, anon;
grant execute on function public.materialize_occurrence(uuid, timestamptz) to authenticated;
