-- 085: Tekrarlayan görevler — üretim motoru ve hatırlatma (#59e0b75e, TK-2 + TK-3)
--
-- Üretim iki tetikten gelir:
--   • takvim (varsayılan): zamanı gelince yeni görev doğar, önceki tamamlanmasa bile.
--     Seride aynı anda tek açık görev olur; açık görev dururken gelen tekrar
--     "kaçırıldı" olarak kayda geçer (kullanıcı kararı, 21 Eyl 2026).
--   • tamamlanınca: sıradaki görev, öncekini tamamlayınca doğar.
--
-- Zamanlayıcı: Fira'da pg_cron yok (paylaşımlı sunucuya eklenti kurulmuyor).
-- `generate_due_recurrences()` sunucudaki 5 dakikalık cron'dan çağrılır; ayrıca
-- liste açılınca istemci aynı işlevi kendi listesi için çağırır (emniyet kemeri,
-- çöp kutusundaki `purge_expired_pages` kalıbı).
--
-- Hatırlatma: `send_due_reminders()` son tarihe X dakika kalan tekrar için
-- `ticket_activity`ye `reminder` satırı yazar; bildirim kutusu, tarayıcı
-- bildirimi ve Telegram bu satırdan beslenir (058 dağıtımı aynen çalışır).

-- ── Bir tekrarı doğur ────────────────────────────────────────────────────────
-- Şablondan kopyalar: başlık, açıklama, öncelik, atananlar, etiketler, alt
-- görevler. Oturum gerekmez (cron'dan da çalışır): aktör serinin sahibidir.
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

  -- Listenin ilk durumu (pano soldan başlar); şablonun durumu taşınmaz çünkü
  -- şablon zamanla tamamlanmış olabilir.
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

  -- Alt görevler şablondaki hâliyle (tamamlanmamış olarak) gelir.
  for v_child in select id from public.tickets where parent_id = src.id and archived_at is null order by order_index loop
    perform public.recurrence_spawn(p_rec, p_due, p_no, v_new, v_child);
  end loop;

  return v_new;
end $$;

-- Seride hâlâ açık (tamamlanmamış, arşivlenmemiş) bir görev var mı?
create or replace function public.recurrence_has_open(p_rec uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tickets t
      left join public.ticket_statuses s on s.id = t.status_id
     where t.recurrence_id = p_rec and t.archived_at is null
       and coalesce(s.category, 'active') not in ('done', 'closed'))
$$;

-- ── Zamanı gelen tekrarları üret ─────────────────────────────────────────────
-- p_project verilirse yalnız o liste (istemcinin açılışta yaptığı yakalama).
-- Döndürdüğü sayı: üretilen görev adedi.
create or replace function public.generate_due_recurrences(p_project uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r      public.ticket_recurrences%rowtype;
  v_next timestamptz;
  v_no   int;
  v_made int := 0;
  guard  int;
begin
  for r in select * from public.ticket_recurrences
            where active and trigger = 'schedule' and next_at <= now()
              and (p_project is null or project_id = p_project)
            order by next_at
  loop
    guard := 0;
    while r.next_at is not null and r.next_at <= now() and guard < 60 loop
      guard := guard + 1;
      select coalesce(max(occurrence_no), 1) + 1 into v_no from public.recurrence_occurrences where recurrence_id = r.id;

      if public.recurrence_has_open(r.id) then
        -- Önceki tekrar hâlâ açık: yenisini üretip yığmıyoruz, kaçırıldı diye yazıyoruz.
        insert into public.recurrence_occurrences (recurrence_id, occurrence_no, due_at, outcome)
        values (r.id, v_no, r.next_at, 'missed') on conflict do nothing;
      else
        insert into public.recurrence_occurrences (recurrence_id, occurrence_no, due_at, outcome, ticket_id)
        values (r.id, v_no, r.next_at, 'created', public.recurrence_spawn(r.id, r.next_at, v_no))
        on conflict do nothing;
        v_made := v_made + 1;
      end if;

      v_next := public.fira_next_for(r, r.next_at);
      r.next_at := v_next;
      update public.ticket_recurrences
         set next_at = coalesce(v_next, next_at), active = (v_next is not null), updated_at = now()
       where id = r.id;
    end loop;
  end loop;
  return v_made;
end $$;

-- ── "Tamamlanınca" tetiği ────────────────────────────────────────────────────
create or replace function public.recurrence_on_complete()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r      public.ticket_recurrences%rowtype;
  v_old  text;
  v_new  text;
  v_no   int;
  v_due  timestamptz;
begin
  if new.recurrence_id is null or not (new.status_id is distinct from old.status_id) then return new; end if;
  select category into v_old from public.ticket_statuses where id = old.status_id;
  select category into v_new from public.ticket_statuses where id = new.status_id;
  if coalesce(v_new, 'active') not in ('done', 'closed') or coalesce(v_old, 'active') in ('done', 'closed') then return new; end if;

  select * into r from public.ticket_recurrences where id = new.recurrence_id and active and trigger = 'completion';
  if not found then return new; end if;

  v_due := public.fira_next_for(r, now());
  if v_due is null then
    update public.ticket_recurrences set active = false, updated_at = now() where id = r.id;
    return new;
  end if;
  select coalesce(max(occurrence_no), 1) + 1 into v_no from public.recurrence_occurrences where recurrence_id = r.id;
  insert into public.recurrence_occurrences (recurrence_id, occurrence_no, due_at, outcome, ticket_id)
  values (r.id, v_no, v_due, 'created', public.recurrence_spawn(r.id, v_due, v_no));
  update public.ticket_recurrences set next_at = v_due, updated_at = now() where id = r.id;
  return new;
end $$;

drop trigger if exists tickets_recurrence_complete on public.tickets;
create trigger tickets_recurrence_complete
  after update on public.tickets
  for each row execute function public.recurrence_on_complete();

-- ── Hatırlatma ───────────────────────────────────────────────────────────────
-- Bildirim kutusu yeni bir olay türü tanır: reminder.
alter table public.user_notifications drop constraint if exists user_notifications_event_check;
alter table public.user_notifications add constraint user_notifications_event_check
  check (event in ('assigned', 'comment', 'status', 'subtask', 'file', 'team_invite', 'mention', 'reminder'));

create or replace function public.notifications_fanout()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_event text;
begin
  if coalesce(new.meta ->> 'bulk', 'false') = 'true' then return new; end if;

  v_event := case new.kind
    when 'assignee_added'   then 'assigned'
    when 'comment_added'    then 'comment'
    when 'status'           then 'status'
    when 'child_added'      then 'subtask'
    when 'attachment_added' then 'file'
    when 'mentioned'        then 'mention'
    when 'reminder'         then 'reminder'
    else null end;
  if v_event is null then return new; end if;

  insert into public.user_notifications (user_id, activity_id, ticket_id, project_id, event, actor_id, value, ticket_title)
  select r.user_id, new.id, new.ticket_id, t.project_id, v_event, new.actor_id, left(new.to_value, 300), t.title
  from public.activity_recipients(new.id) r
  cross join public.tickets t
  where t.id = new.ticket_id
  on conflict do nothing;

  delete from public.user_notifications n
  using public.activity_recipients(new.id) r
  where n.user_id = r.user_id and n.created_at < now() - interval '90 days';

  return new;
end $$;

-- Son tarihe hatırlatma süresi kadar kalan tekrarlar için aktivite satırı yaz.
create or replace function public.send_due_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  o     record;
  v_cnt int := 0;
begin
  for o in
    select oc.id, oc.due_at, oc.ticket_id, r.tz, r.reminder_minutes
      from public.recurrence_occurrences oc
      join public.ticket_recurrences r on r.id = oc.recurrence_id
      join public.tickets t on t.id = oc.ticket_id
      left join public.ticket_statuses s on s.id = t.status_id
     where oc.outcome = 'created' and oc.reminded_at is null
       and r.reminder_minutes is not null
       and t.archived_at is null
       and coalesce(s.category, 'active') not in ('done', 'closed')
       and now() >= oc.due_at - make_interval(mins => r.reminder_minutes)
       and now() < oc.due_at + interval '1 day'
     limit 200
  loop
    insert into public.ticket_activity (ticket_id, actor_id, kind, to_value, meta)
    values (o.ticket_id, null, 'reminder',
            to_char(o.due_at at time zone o.tz, 'DD.MM.YYYY HH24:MI'),
            jsonb_build_object('due_at', o.due_at, 'minutes', o.reminder_minutes));
    update public.recurrence_occurrences set reminded_at = now() where id = o.id;
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end $$;

-- Cron'un çağırdığı tek giriş: üret + hatırlat.
create or replace function public.recurrence_tick()
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('created', public.generate_due_recurrences(null), 'reminded', public.send_due_reminders())
$$;

revoke all on function public.recurrence_spawn(uuid, timestamptz, int, uuid, uuid) from public, anon, authenticated;
revoke all on function public.recurrence_has_open(uuid) from public, anon;
grant execute on function public.recurrence_has_open(uuid) to authenticated;
revoke all on function public.generate_due_recurrences(uuid) from public, anon;
grant execute on function public.generate_due_recurrences(uuid) to authenticated;
revoke all on function public.send_due_reminders() from public, anon, authenticated;
revoke all on function public.recurrence_tick() from public, anon, authenticated;
revoke all on function public.notifications_fanout() from public, anon, authenticated;
revoke all on function public.recurrence_on_complete() from public, anon, authenticated;
