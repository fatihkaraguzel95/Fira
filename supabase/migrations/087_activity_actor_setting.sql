-- 087: Sunucu işlerinin ürettiği aktivitede aktör görünsün (#59e0b75e)
--
-- `activity_actor()` aktörü yalnız `auth.uid()`ten okuyordu. Oturumsuz çalışan
-- sunucu işleri (tekrarlayan görev üretimi, cron) için bu hep boş: günlükte ve
-- gelen kutusunda "Biri seni atadı" yazıyordu. Artık iş, işlem boyunca geçerli
-- `fira.actor` ayarını koyabiliyor; ayar yoksa davranış aynı kalır.
--
-- Not: ayar `set_config(..., true)` ile **yerel** konur, yani işlem bitince
-- kaybolur; istemci tarafı bu ayarı koyamaz (RLS altında set_config çağrısı
-- yalnız SECURITY DEFINER fonksiyonlarımızın içinde).

create or replace function public.activity_actor() returns uuid
language sql stable as $$
  select coalesce(
    (select p.id from public.profiles p where p.id = auth.uid()),
    (select p.id from public.profiles p
      where p.id = nullif(current_setting('fira.actor', true), '')::uuid)
  )
$$;

-- Üretim serinin sahibi adına yapılır: yeni görevin "atandı" satırı ve günlüğü
-- seriyi kuran kişiyi gösterir.
create or replace function public.recurrence_spawn(p_rec uuid, p_due timestamptz, p_no int, p_parent uuid default null, p_src uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r      public.ticket_recurrences%rowtype;
  src    public.tickets%rowtype;
  v_status uuid;
  v_name   text;
  v_min    int;
  v_new    uuid;
  v_child  uuid;
begin
  select * into r from public.ticket_recurrences where id = p_rec;
  if not found then raise exception 'seri bulunamadı'; end if;
  select * into src from public.tickets where id = coalesce(p_src, r.template_ticket_id);
  if not found then raise exception 'şablon görev bulunamadı'; end if;

  if r.created_by is not null then perform set_config('fira.actor', r.created_by::text, true); end if;

  select id, name into v_status, v_name from public.ticket_statuses
   where project_id = r.project_id order by order_index limit 1;
  if v_status is null then raise exception 'listede durum yok'; end if;
  select coalesce(min(order_index), 0) - 1 into v_min from public.tickets where status_id = v_status;

  perform set_config('fira.manual_reorder', '1', true);
  insert into public.tickets (project_id, parent_id, title, description, status, status_id, priority,
                              due_date, due_time, cover_url, created_by, updated_by, order_index,
                              recurrence_id, occurrence_no)
  values (r.project_id, p_parent, src.title, src.description, v_name, v_status, src.priority,
          (p_due at time zone r.tz)::date, r.at_time, src.cover_url, r.created_by, r.created_by, v_min,
          case when p_parent is null then r.id end, case when p_parent is null then p_no end)
  returning id into v_new;

  insert into public.ticket_assignees (ticket_id, user_id)
  select v_new, a.user_id from public.ticket_assignees a where a.ticket_id = src.id;

  insert into public.ticket_tag_assignments (ticket_id, tag_id)
  select v_new, ta.tag_id from public.ticket_tag_assignments ta where ta.ticket_id = src.id;

  for v_child in select id from public.tickets where parent_id = src.id and archived_at is null order by order_index loop
    perform public.recurrence_spawn(p_rec, p_due, p_no, v_new, v_child);
  end loop;

  return v_new;
end $$;

revoke all on function public.recurrence_spawn(uuid, timestamptz, int, uuid, uuid) from public, anon, authenticated;
