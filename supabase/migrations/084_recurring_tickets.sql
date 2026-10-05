-- 084: Tekrarlayan görevler — veri modeli ve kural motoru (#59e0b75e, TK-1)
--
-- Karar (kullanıcı, 21 Eyl 2026):
--   • Tetik seri başına seçilir, varsayılan **takvim** (tamamlanmayı beklemez).
--   • Kaçırılan tekrar sessizce yutulmaz, kayda geçer.
--   • Gelecek tekrarlar "hayalet" olarak gösterilir; önceden görev üretilmez.
--   • Şablon ayrı bir nesne değil: bir görevin kendisi serinin şablonudur.
--   • Hatırlatma bu işin içinde (085).
--
-- Model: bir seri (`ticket_recurrences`) bir şablon göreve bağlıdır; şablon aynı
-- zamanda serinin 1. tekrarıdır. Her üretilen tekrar ayrı bir görevdir (ölçüm ve
-- geçmiş doğru kalsın diye — Planner/Linear/ClickUp da böyle yapıyor), üretim
-- kaydı `recurrence_occurrences`'ta durur: oluşturuldu, kaçırıldı ya da atlandı.
--
-- Yalnız ekleme: eski istemci bu tabloları ve sütunları görmez, etkilenmez.

create table if not exists public.ticket_recurrences (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  -- Serinin şablonu ve ilk tekrarı. Şablon silinirse seri de gider.
  template_ticket_id uuid not null unique references public.tickets(id) on delete cascade,
  freq               text not null check (freq in ('daily', 'weekly', 'monthly', 'yearly')),
  interval_n         int  not null default 1 check (interval_n between 1 and 99),
  -- Haftalık kuralda günler: ISO (1 = Pazartesi … 7 = Pazar). Boşsa başlangıcın günü.
  byweekday          smallint[],
  -- Aylık kuralda ayın günü. Boşsa başlangıcın günü. O ayda olmayan gün atlanır.
  bymonthday         smallint check (bymonthday between 1 and 31),
  at_time            time not null default '09:00',
  tz                 text not null default 'Europe/Istanbul',
  starts_on          date not null default current_date,
  ends_on            date,
  trigger            text not null default 'schedule' check (trigger in ('schedule', 'completion')),
  -- Hatırlatma: son tarihten kaç dakika önce (085 gönderir). Boşsa hatırlatma yok.
  reminder_minutes   int check (reminder_minutes between 0 and 43200),
  -- Sıradaki tekrarın zamanı (UTC). Üretim işi buna bakar.
  next_at            timestamptz not null,
  active             boolean not null default true,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (byweekday is null or (array_length(byweekday, 1) between 1 and 7))
);
create index if not exists ticket_recurrences_due_idx on public.ticket_recurrences (next_at) where active;
create index if not exists ticket_recurrences_project_idx on public.ticket_recurrences (project_id);

create table if not exists public.recurrence_occurrences (
  id            uuid primary key default gen_random_uuid(),
  recurrence_id uuid not null references public.ticket_recurrences(id) on delete cascade,
  occurrence_no int  not null,
  due_at        timestamptz not null,
  outcome       text not null check (outcome in ('created', 'missed', 'skipped')),
  ticket_id     uuid references public.tickets(id) on delete set null,
  reminded_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (recurrence_id, occurrence_no)
);
create index if not exists recurrence_occurrences_due_idx on public.recurrence_occurrences (due_at);

alter table public.tickets add column if not exists recurrence_id uuid references public.ticket_recurrences(id) on delete set null;
alter table public.tickets add column if not exists occurrence_no int;
-- Bitiş tarihi bugün yalnız günü tutuyor; "cuma öğleye kadar" için saat gerekiyor.
alter table public.tickets add column if not exists due_time time;
create index if not exists tickets_recurrence_idx on public.tickets (recurrence_id) where recurrence_id is not null;

comment on table public.ticket_recurrences is 'Tekrarlayan görev serisi: kural + şablon görev (084).';
comment on table public.recurrence_occurrences is 'Serinin tekrar kaydı: oluşturulan, kaçırılan ve atlanan tekrarlar (084).';
comment on column public.tickets.due_time is 'Bitiş saatinin saat kısmı; tekrar ve hatırlatma bunu kullanır (084).';

-- ── Kural motoru ─────────────────────────────────────────────────────────────
-- p_after'dan **kesinlikle sonraki** tekrarın zamanı. Yerel saatte hesaplanır
-- (yaz saati geçişinde "her cuma 12:00" 12:00 kalsın diye), UTC döner.
-- Gün gün ilerler: kural gün bazlı (haftanın günleri, ayın günü) ve aralıklar
-- küçük; üst sınır 4 yıl (yıllık × 4 aralığa kadar yeter), bulunamazsa null.
create or replace function public.fira_next_occurrence(
  p_freq text, p_interval int, p_byweekday smallint[], p_bymonthday smallint,
  p_at_time time, p_tz text, p_start date, p_ends date, p_after timestamptz)
returns timestamptz
language plpgsql immutable as $$
declare
  v_days     smallint[] := p_byweekday;
  v_monthday smallint;
  v_day      date;
  v_local    timestamp;
  v_cand     timestamptz;
  v_match    boolean;
  i          int := 0;
begin
  if p_freq is null or p_start is null then return null; end if;
  v_local := (coalesce(p_after, now()) at time zone p_tz);
  v_day   := greatest(p_start, v_local::date);
  if v_days is null or array_length(v_days, 1) is null then
    v_days := array[extract(isodow from p_start)::smallint];
  end if;
  v_monthday := coalesce(p_bymonthday, extract(day from p_start)::smallint);

  while i < 1500 loop
    if p_ends is not null and v_day > p_ends then return null; end if;
    -- plpgsql'de IF koşulundaki CASE ilk THEN'i koşulun sonu sanıyor: önce değişkene al.
    v_match := case p_freq
         when 'daily'   then (v_day - p_start) % p_interval = 0
         when 'weekly'  then extract(isodow from v_day)::smallint = any(v_days)
                             and ((date_trunc('week', v_day)::date - date_trunc('week', p_start)::date) / 7) % p_interval = 0
         when 'monthly' then extract(day from v_day)::smallint = v_monthday
                             and ((extract(year from v_day) - extract(year from p_start)) * 12
                                  + (extract(month from v_day) - extract(month from p_start)))::int % p_interval = 0
         when 'yearly'  then extract(month from v_day) = extract(month from p_start)
                             and extract(day from v_day)::smallint = v_monthday
                             and (extract(year from v_day) - extract(year from p_start))::int % p_interval = 0
         else false end;
    if v_match then
      v_cand := (v_day + p_at_time) at time zone p_tz;
      if v_cand > coalesce(p_after, now()) then return v_cand; end if;
    end if;
    v_day := v_day + 1;
    i := i + 1;
  end loop;
  return null;
end $$;

-- Serinin kendi satırından sonraki tekrar (üretim işi ve önizleme bunu çağırır).
create or replace function public.fira_next_for(p_rec public.ticket_recurrences, p_after timestamptz)
returns timestamptz
language sql immutable as $$
  select public.fira_next_occurrence(p_rec.freq, p_rec.interval_n, p_rec.byweekday, p_rec.bymonthday,
                                     p_rec.at_time, p_rec.tz, p_rec.starts_on, p_rec.ends_on, p_after)
$$;

-- Hayalet tekrarlar (TK-5): sıradaki n tekrarın zamanı. Görev üretmez.
create or replace function public.recurrence_preview(p_recurrence uuid, p_count int default 5)
returns setof timestamptz
language plpgsql stable security invoker set search_path = public as $$
declare
  r public.ticket_recurrences%rowtype;
  v timestamptz;
  i int := 0;
begin
  select * into r from public.ticket_recurrences where id = p_recurrence;
  if not found or not r.active then return; end if;
  v := greatest(r.next_at, now()) - interval '1 second';
  while i < least(greatest(coalesce(p_count, 5), 1), 50) loop
    v := public.fira_next_for(r, v);
    exit when v is null;
    return next v;
    i := i + 1;
  end loop;
end $$;

-- ── Seriyi kurma / güncelleme / kapatma ──────────────────────────────────────
-- Şablon görev = serinin 1. tekrarı. Kural jsonb olarak gelir (istemci tarafı
-- src/lib/recurrence.ts ile aynı alan adlarını kullanır).
create or replace function public.set_ticket_recurrence(p_ticket uuid, p_rule jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t         public.tickets%rowtype;
  v_me      uuid := auth.uid();
  v_id      uuid;
  v_freq    text := coalesce(p_rule->>'freq', 'weekly');
  v_int     int  := coalesce((p_rule->>'interval')::int, 1);
  v_days    smallint[] := case when p_rule ? 'byweekday'
                               then (select coalesce(array_agg(x::smallint), null) from jsonb_array_elements_text(p_rule->'byweekday') x)
                               else null end;
  v_mday    smallint := nullif(p_rule->>'bymonthday', '')::smallint;
  v_time    time := coalesce(nullif(p_rule->>'at_time', '')::time, '09:00');
  v_tz      text := coalesce(nullif(p_rule->>'tz', ''), 'Europe/Istanbul');
  v_start   date := coalesce(nullif(p_rule->>'starts_on', '')::date, current_date);
  v_ends    date := nullif(p_rule->>'ends_on', '')::date;
  v_trigger text := coalesce(nullif(p_rule->>'trigger', ''), 'schedule');
  v_remind  int  := nullif(p_rule->>'reminder_minutes', '')::int;
  v_next    timestamptz;
begin
  if v_me is null then raise exception 'oturum yok'; end if;
  select * into t from public.tickets where id = p_ticket;
  if not found then raise exception 'görev bulunamadı'; end if;
  if not public.can_write_team(public.project_team(t.project_id)) then raise exception 'yetki yok'; end if;
  if t.parent_id is not null then raise exception 'alt görev tekrarlanamaz'; end if;

  v_next := public.fira_next_occurrence(v_freq, v_int, v_days, v_mday, v_time, v_tz, v_start, v_ends, now());
  if v_next is null then raise exception 'kural hiç tekrar üretmiyor'; end if;

  insert into public.ticket_recurrences (project_id, template_ticket_id, freq, interval_n, byweekday, bymonthday,
                                         at_time, tz, starts_on, ends_on, trigger, reminder_minutes, next_at, created_by)
  values (t.project_id, p_ticket, v_freq, v_int, v_days, v_mday, v_time, v_tz, v_start, v_ends, v_trigger, v_remind, v_next, v_me)
  on conflict (template_ticket_id) do update
     set freq = excluded.freq, interval_n = excluded.interval_n, byweekday = excluded.byweekday,
         bymonthday = excluded.bymonthday, at_time = excluded.at_time, tz = excluded.tz,
         starts_on = excluded.starts_on, ends_on = excluded.ends_on, trigger = excluded.trigger,
         reminder_minutes = excluded.reminder_minutes, next_at = excluded.next_at,
         active = true, updated_at = now()
  returning id into v_id;

  -- Şablon aynı zamanda 1. tekrardır.
  update public.tickets
     set recurrence_id = v_id, occurrence_no = coalesce(occurrence_no, 1),
         due_time = coalesce(due_time, v_time), updated_by = v_me
   where id = p_ticket;
  return v_id;
end $$;

create or replace function public.clear_ticket_recurrence(p_ticket uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets%rowtype;
begin
  if auth.uid() is null then raise exception 'oturum yok'; end if;
  select * into t from public.tickets where id = p_ticket;
  if not found then raise exception 'görev bulunamadı'; end if;
  if not public.can_write_team(public.project_team(t.project_id)) then raise exception 'yetki yok'; end if;
  -- Seri durur; üretilmiş görevler ve kayıtlar yerinde kalır (geçmiş bozulmasın).
  update public.ticket_recurrences set active = false, updated_at = now() where template_ticket_id = p_ticket;
end $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.ticket_recurrences enable row level security;
alter table public.recurrence_occurrences enable row level security;

drop policy if exists ticket_recurrences_select on public.ticket_recurrences;
create policy ticket_recurrences_select on public.ticket_recurrences for select to authenticated
  using (public.team_role(public.project_team(project_id)) is not null);
drop policy if exists ticket_recurrences_write on public.ticket_recurrences;
create policy ticket_recurrences_write on public.ticket_recurrences for update to authenticated
  using (public.can_write_team(public.project_team(project_id)))
  with check (public.can_write_team(public.project_team(project_id)));
drop policy if exists ticket_recurrences_delete on public.ticket_recurrences;
create policy ticket_recurrences_delete on public.ticket_recurrences for delete to authenticated
  using (public.is_team_admin(public.project_team(project_id)));
-- INSERT yok: seri yalnız set_ticket_recurrence ile kurulur (kural doğrulaması orada).

drop policy if exists recurrence_occurrences_select on public.recurrence_occurrences;
create policy recurrence_occurrences_select on public.recurrence_occurrences for select to authenticated
  using (exists (select 1 from public.ticket_recurrences r
                  where r.id = recurrence_id
                    and public.team_role(public.project_team(r.project_id)) is not null));

grant select on public.ticket_recurrences, public.recurrence_occurrences to authenticated;
grant update (freq, interval_n, byweekday, bymonthday, at_time, tz, starts_on, ends_on, trigger, reminder_minutes, active)
  on public.ticket_recurrences to authenticated;
revoke insert, delete on public.recurrence_occurrences from authenticated, anon;

revoke all on function public.set_ticket_recurrence(uuid, jsonb) from public, anon;
grant execute on function public.set_ticket_recurrence(uuid, jsonb) to authenticated;
revoke all on function public.clear_ticket_recurrence(uuid) from public, anon;
grant execute on function public.clear_ticket_recurrence(uuid) to authenticated;
revoke all on function public.recurrence_preview(uuid, int) from public, anon;
grant execute on function public.recurrence_preview(uuid, int) to authenticated;
revoke all on function public.fira_next_occurrence(text, int, smallint[], smallint, time, text, date, date, timestamptz) from public, anon;
grant execute on function public.fira_next_occurrence(text, int, smallint[], smallint, time, text, date, date, timestamptz) to authenticated;
revoke all on function public.fira_next_for(public.ticket_recurrences, timestamptz) from public, anon;
grant execute on function public.fira_next_for(public.ticket_recurrences, timestamptz) to authenticated;
