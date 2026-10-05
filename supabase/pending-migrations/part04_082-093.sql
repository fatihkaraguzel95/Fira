-- Fira migrations 082 -> 093  (part 4/7)
-- Supabase Dashboard -> SQL Editor: bu dosyanin tamamini yapistirip calistirin.
-- Parcalari SIRAYLA calistirin; bir parca hata verirse sonrakine gecmeyin.

-- ========================================
-- 082_palette_search.sql
-- ========================================
-- 082: Komut paleti araması — yazım hatasına dayanıklı arama + filtreler (#43a865fb, v0.38.0)
--
-- Paletin araması düz `ilike` idi: "sirala" "Sıralama"yı, "tamanlamdi" "Tamamlandı"yı bulmuyordu.
-- Bu migration üç şey ekler, mevcut hiçbir şeyi değiştirmez (eski istemci etkilenmez):
--
--  fira_fold(text)           küçük harf + Türkçe/Almanca harf katlama (ş→s, ı/İ→i, ğ→g, ç→c, ö→o, ü→u, ä→a, ß→s)
--  fira_term_score(t, txt)   bir terimin metne en iyi benzerliği (0..1): metinde geçiyorsa 1; değilse metnin
--                            kelimelerine (ve kelimelerin terim uzunluğundaki öneklerine, yarım yazılmış kelime
--                            için) Levenshtein benzerliği = 1 - mesafe / uzun olanın boyu. 5 harften kısa terim
--                            yalnız birebir geçerse eşleşir (%80 kuralı kısa kelimede zaten hataya izin vermez).
--  palette_search(p jsonb)   paletin tek arama çağrısı. SECURITY INVOKER: RLS neyi göreceğine karar verir.
--                            Terimler görev başlığında bulanık (her terim ≥ 0,8), açıklamada birebir aranır;
--                            "tam ifade"ler başlık/açıklamada birebir; -terim başlıkta geçenleri eler; filtreler
--                            (atanan, oluşturan, durum, öncelik, etiket, liste, takım, yorum, has:, tarihler)
--                            istemcide çözülüp yapı olarak gelir (src/lib/paletteQuery.ts).
--
-- Levenshtein için fuzzystrmatch (Supabase'in `extensions` şemasına). Ölçüm (1.455 görev): terim başına ~65 ms.

create extension if not exists fuzzystrmatch with schema extensions;

create or replace function public.fira_fold(t text)
returns text
language sql immutable parallel safe
as $$
  select lower(translate(coalesce(t, ''), 'ÇĞİIÖŞÜÂÎÛÄßçğıöşüâîûä', 'cgiiosuaiuascgiosuaiua'))
$$;

create or replace function public.fira_term_score(term text, txt text)
returns real
language sql immutable parallel safe
set search_path = public, extensions
as $$
  select case
    when term is null or term = '' then 1::real
    when strpos(public.fira_fold(txt), term) > 0 then 1::real
    when length(term) < 5 then 0::real
    else coalesce((
      select max(greatest(
               1 - extensions.levenshtein(term, w)::real / greatest(length(term), length(w)),
               case when length(w) > length(term)
                    then 1 - extensions.levenshtein(term, left(w, length(term)))::real / length(term)
                    else 0 end))
        from regexp_split_to_table(public.fira_fold(txt), '[^a-z0-9]+') w
       where w <> ''), 0)::real
  end
$$;

-- Every word of `words` must score >= 0.8 against txt; returns their average, 0 when one fails.
create or replace function public.fira_all_terms(words text[], txt text)
returns real
language sql immutable parallel safe
as $$
  select case
    when coalesce(array_length(words, 1), 0) = 0 then 1::real
    else coalesce((select case when bool_and(s >= 0.8) then avg(s) else 0 end
                     from (select public.fira_term_score(w, txt) s from unnest(words) w where w <> '') q), 1)::real
  end
$$;

create or replace function public.palette_search(p jsonb)
returns table (
  kind text, id uuid, title text, project_id uuid, project_name text, team_id uuid,
  icon text, icon_url text, status_name text, status_color text, score real, activity_at timestamptz
)
language plpgsql stable
security invoker
set search_path = public, extensions
as $$
declare
  split constant text := '\s+';
  v_terms   text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'terms') x where btrim(x) <> ''), '{}');
  v_not     text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'not') x where btrim(x) <> ''), '{}');
  v_phrases text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'phrases') x where btrim(x) <> ''), '{}');
  v_kinds   text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'kinds') x), array['ticket', 'project', 'page']);
  v_has     text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'has') x), '{}');
  v_assignee text := nullif(btrim(p->>'assignee'), '');
  v_creator  text := nullif(btrim(p->>'creator'), '');
  v_status  text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'status'), '')), split);
  v_tag     text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'tag'), '')), split);
  v_list    text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'list'), '')), split);
  v_team    text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'team'), '')), split);
  v_comment text := nullif(public.fira_fold(btrim(p->>'comment')), '');
  v_state    text := p->>'state';          -- open | done
  v_priority text := p->>'priority';       -- critical | high | medium | low | none
  v_due      text := p->>'due';            -- overdue | today | week | none
  v_after    timestamptz := (p->>'after')::timestamptz;       -- last activity at or after
  v_before   timestamptz := (p->>'before')::timestamptz;      -- last activity before
  v_on_from  timestamptz := (p->>'on_from')::timestamptz;     -- any activity in [on_from, on_to)
  v_on_to    timestamptz := (p->>'on_to')::timestamptz;
  v_cr_from  timestamptz := (p->>'created_from')::timestamptz;
  v_cr_to    timestamptz := (p->>'created_to')::timestamptz;
  v_limit    int := least(greatest(coalesce((p->>'limit')::int, 20), 1), 50);
  v_task_only boolean;
  v_uid uuid := auth.uid();
begin
  if v_status = '{}' or v_status = '{""}' then v_status := null; end if;
  if v_tag = '{}' or v_tag = '{""}' then v_tag := null; end if;
  if v_list = '{}' or v_list = '{""}' then v_list := null; end if;
  if v_team = '{}' or v_team = '{""}' then v_team := null; end if;
  -- Filters that only make sense for tasks: when one is set, lists and pages are not returned.
  v_task_only := v_assignee is not null or v_creator is not null or v_status is not null or v_tag is not null or v_list is not null
    or v_comment is not null or v_state is not null or v_priority is not null or v_due is not null
    or coalesce(array_length(v_has, 1), 0) > 0 or v_on_from is not null or v_cr_from is not null;

  if 'ticket' = any(v_kinds) then
    return query
    with base as (
      select t.id, t.title, t.description, t.project_id, pr.name as pname, pr.team_id as tid,
             s.name as sname, s.color as scolor, s.category as scat,
             greatest(t.updated_at, (select max(c.created_at) from ticket_comments c where c.ticket_id = t.id)) as act,
             t.created_at, t.created_by, t.priority, t.due_date
        from tickets t
        join projects pr on pr.id = t.project_id
        left join ticket_statuses s on s.id = t.status_id
       where t.archived_at is null
         and (v_list is null or public.fira_all_terms(v_list, pr.name) >= 0.8)
         and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_status is null or public.fira_all_terms(v_status, s.name) >= 0.8)
         and (v_state is null
              or (v_state = 'open' and coalesce(s.category, 'active') not in ('done', 'closed'))
              or (v_state = 'done' and s.category in ('done', 'closed')))
         and (v_priority is null or (v_priority = 'none' and t.priority is null) or t.priority::text = v_priority)
         and (v_due is null
              or (v_due = 'none' and t.due_date is null)
              or (v_due = 'overdue' and t.due_date < current_date and coalesce(s.category, 'active') not in ('done', 'closed'))
              or (v_due = 'today' and t.due_date = current_date)
              or (v_due = 'week' and t.due_date between current_date and current_date + 7))
         and (v_tag is null or exists (select 1 from ticket_tag_assignments a join tags g on g.id = a.tag_id
                                        where a.ticket_id = t.id and public.fira_all_terms(v_tag, g.name) >= 0.8))
         and (v_assignee is null
              or (v_assignee = '@me' and exists (select 1 from ticket_assignees a where a.ticket_id = t.id and a.user_id = v_uid))
              or (v_assignee = '@none' and not exists (select 1 from ticket_assignees a where a.ticket_id = t.id))
              or (v_assignee not in ('@me', '@none') and exists (
                    select 1 from ticket_assignees a join profiles pf on pf.id = a.user_id
                     where a.ticket_id = t.id
                       and public.fira_all_terms(regexp_split_to_array(public.fira_fold(v_assignee), split),
                                                 coalesce(pf.full_name, '') || ' ' || coalesce(pf.email, '')) >= 0.8)))
         and (v_creator is null
              or (v_creator = '@me' and t.created_by = v_uid)
              or (v_creator <> '@me' and exists (
                    select 1 from profiles pf where pf.id = t.created_by
                       and public.fira_all_terms(regexp_split_to_array(public.fira_fold(v_creator), split),
                                                 coalesce(pf.full_name, '') || ' ' || coalesce(pf.email, '')) >= 0.8)))
         and (v_comment is null or exists (select 1 from ticket_comments c where c.ticket_id = t.id
                                              and strpos(public.fira_fold(c.content), v_comment) > 0))
         and (not ('file' = any(v_has)) or exists (select 1 from ticket_attachments x where x.ticket_id = t.id))
         and (not ('comment' = any(v_has)) or exists (select 1 from ticket_comments x where x.ticket_id = t.id))
         and (not ('subtask' = any(v_has)) or exists (select 1 from tickets x where x.parent_id = t.id and x.archived_at is null))
         and (not ('link' = any(v_has)) or exists (select 1 from ticket_links x where x.ticket_id = t.id or x.linked_ticket_id = t.id))
         and (not ('due' = any(v_has)) or t.due_date is not null)
         and (not ('desc' = any(v_has)) or coalesce(btrim(t.description), '') <> '')
         and (v_cr_from is null or (t.created_at >= v_cr_from and t.created_at < v_cr_to))
         and (v_on_from is null
              or (t.created_at >= v_on_from and t.created_at < v_on_to)
              or exists (select 1 from ticket_activity a where a.ticket_id = t.id and a.created_at >= v_on_from and a.created_at < v_on_to)
              or exists (select 1 from ticket_comments c where c.ticket_id = t.id and c.created_at >= v_on_from and c.created_at < v_on_to))
    ), scored as (
      select b.*,
             (select case when count(*) = 0 then 1::real
                          when bool_and(q.s >= 0.8) then avg(q.s)::real
                          else 0::real end
                from (select greatest(public.fira_term_score(x, b.title),
                                      case when length(x) >= 3 and strpos(public.fira_fold(b.description), x) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) x) q) as sc
        from base b
       where (v_after is null or b.act >= v_after)
         and (v_before is null or b.act < v_before)
         and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(b.title), x) > 0)
         and not exists (select 1 from unnest(v_phrases) x
                          where strpos(public.fira_fold(b.title), x) = 0 and strpos(public.fira_fold(b.description), x) = 0)
    )
    select 'ticket'::text, s.id, s.title, s.project_id, s.pname, s.tid, null::text, null::text, s.sname, s.scolor, s.sc, s.act
      from scored s
     where s.sc > 0
     order by s.sc desc, s.act desc nulls last
     limit v_limit;
  end if;

  if v_task_only or (coalesce(array_length(v_terms, 1), 0) = 0 and coalesce(array_length(v_phrases, 1), 0) = 0) then
    return;
  end if;

  -- Lists carry no activity dates: a date filter leaves them out.
  if 'project' = any(v_kinds) and v_after is null and v_before is null then
    return query
    select 'project'::text, pr.id, pr.name, pr.id, pr.name, pr.team_id, pr.icon, pr.icon_url, null::text, null::text,
           public.fira_all_terms(v_terms, pr.name), null::timestamptz
      from projects pr
     where public.fira_all_terms(v_terms, pr.name) > 0
       and not exists (select 1 from unnest(v_phrases) x where strpos(public.fira_fold(pr.name), x) = 0)
       and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(pr.name), x) > 0)
       and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
     order by 11 desc, pr.name
     limit least(v_limit, 8);
  end if;

  if 'page' = any(v_kinds) then
    return query
    select x.* from (
      select 'page'::text, pg.id, pg.title, pg.project_id, null::text, pg.team_id, null::text, null::text, null::text, null::text,
             (select case when count(*) = 0 then 1::real when bool_and(q.s >= 0.8) then avg(q.s)::real else 0::real end
                from (select greatest(public.fira_term_score(t, pg.title),
                                      case when length(t) >= 3 and strpos(public.fira_fold(pg.content), t) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) t) q) as sc,
             pg.updated_at
        from pages pg
       where pg.archived_at is null
         and (v_team is null or exists (select 1 from teams tm where tm.id = pg.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_after is null or pg.updated_at >= v_after)
         and (v_before is null or pg.updated_at < v_before)
         and not exists (select 1 from unnest(v_phrases) ph
                          where strpos(public.fira_fold(pg.title), ph) = 0 and strpos(public.fira_fold(pg.content), ph) = 0)
         and not exists (select 1 from unnest(v_not) n where strpos(public.fira_fold(pg.title), n) > 0)
    ) x
     where x.sc > 0
     order by x.sc desc, x.updated_at desc
     limit least(v_limit, 8);
  end if;
end;
$$;

revoke all on function public.palette_search(jsonb) from public, anon;
grant execute on function public.palette_search(jsonb) to authenticated;
revoke all on function public.fira_term_score(text, text) from public, anon;
grant execute on function public.fira_term_score(text, text) to authenticated;
revoke all on function public.fira_all_terms(text[], text) from public, anon;
grant execute on function public.fira_all_terms(text[], text) to authenticated;
revoke all on function public.fira_fold(text) from public, anon;
grant execute on function public.fira_fold(text) to authenticated;

-- ========================================
-- 083_palette_search_speed.sql
-- ========================================
-- 083: Palet aramasını hızlandır (#43a865fb, v0.39.1)
--
-- Sorun: `palette_search` her çağrıda her satırın **tüm metnini** katlıyordu
-- (`fira_fold(pages.content)`, `fira_fold(tickets.description)`) — 821 sayfa,
-- ortalama 3,9 KB, en büyüğü 355 KB. Ölçüm (gerçek kullanıcı, QA): sayfalar
-- ~1000 ms, görevler ~290 ms, toplam 1,3 sn; iki terimle 2,5 sn. Yoğun sunucuda
-- kullanıcı 18 sn bekledi.
--
-- Çözüm, ekleme-only:
--   1) Katlanmış metin satırda saklanır (generated stored sütun) — `fira_fold`
--      immutable olduğu için Postgres bunu kendi tutar, tetikleyici gerekmez.
--      Sütunu bilmeyen eski istemci etkilenmez (yazmaz, okumaz).
--   2) `palette_search` bu sütunu okur; başlık katlaması satır içinde kalır
--      (başlıklar kısa, bulanık eşleşme orada yapılıyor).
--   3) Son etkinlik (`act` = updated_at ile son yorum tarihinin büyüğü) artık
--      yalnız sonuca giren satırlar için hesaplanır; tarih filtresi varsa
--      (o zaman süzmek için lazım) eskisi gibi adaylar için hesaplanır.
--
-- Sıralama ve eşleşme kuralları aynı: tek fark, tarih filtresi yokken sıralama
-- önce puan + `updated_at` ile kısa listeye iner, sonra kısa liste `act` ile
-- sıralanır (son yorum yalnız ilk sayfayı yeniden dizer).

alter table pages   add column if not exists search_fold text
  generated always as (public.fira_fold(coalesce(content, ''))) stored;
alter table tickets add column if not exists search_fold text
  generated always as (public.fira_fold(coalesce(description, ''))) stored;

comment on column pages.search_fold is 'fira_fold(content) — palet aramasının okuduğu katlanmış metin (083).';
comment on column tickets.search_fold is 'fira_fold(description) — palet aramasının okuduğu katlanmış metin (083).';

create or replace function public.palette_search(p jsonb)
returns table (
  kind text, id uuid, title text, project_id uuid, project_name text, team_id uuid,
  icon text, icon_url text, status_name text, status_color text, score real, activity_at timestamptz
)
language plpgsql stable
security invoker
set search_path = public, extensions
as $$
declare
  split constant text := '\s+';
  v_terms   text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'terms') x where btrim(x) <> ''), '{}');
  v_not     text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'not') x where btrim(x) <> ''), '{}');
  v_phrases text[] := coalesce((select array_agg(public.fira_fold(x)) from jsonb_array_elements_text(p->'phrases') x where btrim(x) <> ''), '{}');
  v_kinds   text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'kinds') x), array['ticket', 'project', 'page']);
  v_has     text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'has') x), '{}');
  v_assignee text := nullif(btrim(p->>'assignee'), '');
  v_creator  text := nullif(btrim(p->>'creator'), '');
  v_status  text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'status'), '')), split);
  v_tag     text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'tag'), '')), split);
  v_list    text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'list'), '')), split);
  v_team    text[] := regexp_split_to_array(public.fira_fold(nullif(btrim(p->>'team'), '')), split);
  v_comment text := nullif(public.fira_fold(btrim(p->>'comment')), '');
  v_state    text := p->>'state';          -- open | done
  v_priority text := p->>'priority';       -- critical | high | medium | low | none
  v_due      text := p->>'due';            -- overdue | today | week | none
  v_after    timestamptz := (p->>'after')::timestamptz;       -- last activity at or after
  v_before   timestamptz := (p->>'before')::timestamptz;      -- last activity before
  v_on_from  timestamptz := (p->>'on_from')::timestamptz;     -- any activity in [on_from, on_to)
  v_on_to    timestamptz := (p->>'on_to')::timestamptz;
  v_cr_from  timestamptz := (p->>'created_from')::timestamptz;
  v_cr_to    timestamptz := (p->>'created_to')::timestamptz;
  v_limit    int := least(greatest(coalesce((p->>'limit')::int, 20), 1), 50);
  v_task_only boolean;
  v_dated    boolean := (p->>'after') is not null or (p->>'before') is not null;
  v_uid uuid := auth.uid();
begin
  if v_status = '{}' or v_status = '{""}' then v_status := null; end if;
  if v_tag = '{}' or v_tag = '{""}' then v_tag := null; end if;
  if v_list = '{}' or v_list = '{""}' then v_list := null; end if;
  if v_team = '{}' or v_team = '{""}' then v_team := null; end if;
  -- Filters that only make sense for tasks: when one is set, lists and pages are not returned.
  v_task_only := v_assignee is not null or v_creator is not null or v_status is not null or v_tag is not null or v_list is not null
    or v_comment is not null or v_state is not null or v_priority is not null or v_due is not null
    or coalesce(array_length(v_has, 1), 0) > 0 or v_on_from is not null or v_cr_from is not null;

  if 'ticket' = any(v_kinds) then
    return query
    with base as (
      select t.id, t.title, t.search_fold as dfold, t.project_id, pr.name as pname, pr.team_id as tid,
             s.name as sname, s.color as scolor, s.category as scat, t.updated_at,
             -- The last comment matters only when a date filter uses it; otherwise it is
             -- looked up for the handful of rows that make the list (see below).
             case when v_dated
                  then greatest(t.updated_at, (select max(c.created_at) from ticket_comments c where c.ticket_id = t.id))
                  else t.updated_at end as act,
             t.created_at, t.created_by, t.priority, t.due_date
        from tickets t
        join projects pr on pr.id = t.project_id
        left join ticket_statuses s on s.id = t.status_id
       where t.archived_at is null
         and (v_list is null or public.fira_all_terms(v_list, pr.name) >= 0.8)
         and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_status is null or public.fira_all_terms(v_status, s.name) >= 0.8)
         and (v_state is null
              or (v_state = 'open' and coalesce(s.category, 'active') not in ('done', 'closed'))
              or (v_state = 'done' and s.category in ('done', 'closed')))
         and (v_priority is null or (v_priority = 'none' and t.priority is null) or t.priority::text = v_priority)
         and (v_due is null
              or (v_due = 'none' and t.due_date is null)
              or (v_due = 'overdue' and t.due_date < current_date and coalesce(s.category, 'active') not in ('done', 'closed'))
              or (v_due = 'today' and t.due_date = current_date)
              or (v_due = 'week' and t.due_date between current_date and current_date + 7))
         and (v_tag is null or exists (select 1 from ticket_tag_assignments a join tags g on g.id = a.tag_id
                                        where a.ticket_id = t.id and public.fira_all_terms(v_tag, g.name) >= 0.8))
         and (v_assignee is null
              or (v_assignee = '@me' and exists (select 1 from ticket_assignees a where a.ticket_id = t.id and a.user_id = v_uid))
              or (v_assignee = '@none' and not exists (select 1 from ticket_assignees a where a.ticket_id = t.id))
              or (v_assignee not in ('@me', '@none') and exists (
                    select 1 from ticket_assignees a join profiles pf on pf.id = a.user_id
                     where a.ticket_id = t.id
                       and public.fira_all_terms(regexp_split_to_array(public.fira_fold(v_assignee), split),
                                                 coalesce(pf.full_name, '') || ' ' || coalesce(pf.email, '')) >= 0.8)))
         and (v_creator is null
              or (v_creator = '@me' and t.created_by = v_uid)
              or (v_creator <> '@me' and exists (
                    select 1 from profiles pf where pf.id = t.created_by
                       and public.fira_all_terms(regexp_split_to_array(public.fira_fold(v_creator), split),
                                                 coalesce(pf.full_name, '') || ' ' || coalesce(pf.email, '')) >= 0.8)))
         and (v_comment is null or exists (select 1 from ticket_comments c where c.ticket_id = t.id
                                              and strpos(public.fira_fold(c.content), v_comment) > 0))
         and (not ('file' = any(v_has)) or exists (select 1 from ticket_attachments x where x.ticket_id = t.id))
         and (not ('comment' = any(v_has)) or exists (select 1 from ticket_comments x where x.ticket_id = t.id))
         and (not ('subtask' = any(v_has)) or exists (select 1 from tickets x where x.parent_id = t.id and x.archived_at is null))
         and (not ('link' = any(v_has)) or exists (select 1 from ticket_links x where x.ticket_id = t.id or x.linked_ticket_id = t.id))
         and (not ('due' = any(v_has)) or t.due_date is not null)
         and (not ('desc' = any(v_has)) or coalesce(btrim(t.description), '') <> '')
         and (v_cr_from is null or (t.created_at >= v_cr_from and t.created_at < v_cr_to))
         and (v_on_from is null
              or (t.created_at >= v_on_from and t.created_at < v_on_to)
              or exists (select 1 from ticket_activity a where a.ticket_id = t.id and a.created_at >= v_on_from and a.created_at < v_on_to)
              or exists (select 1 from ticket_comments c where c.ticket_id = t.id and c.created_at >= v_on_from and c.created_at < v_on_to))
    ), scored as (
      select b.*,
             (select case when count(*) = 0 then 1::real
                          when bool_and(q.s >= 0.8) then avg(q.s)::real
                          else 0::real end
                from (select greatest(public.fira_term_score(x, b.title),
                                      case when length(x) >= 3 and strpos(b.dfold, x) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) x) q) as sc
        from base b
       where (v_after is null or b.act >= v_after)
         and (v_before is null or b.act < v_before)
         and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(b.title), x) > 0)
         and not exists (select 1 from unnest(v_phrases) x
                          where strpos(public.fira_fold(b.title), x) = 0 and strpos(b.dfold, x) = 0)
    ), top as (
      select s.id, s.title, s.project_id, s.pname, s.tid, s.sname, s.scolor, s.sc, s.act, s.updated_at
        from scored s
       where s.sc > 0
       order by s.sc desc, s.act desc nulls last, s.updated_at desc nulls last
       limit v_limit
    )
    select 'ticket'::text, x.id, x.title, x.project_id, x.pname, x.tid, null::text, null::text, x.sname, x.scolor, x.sc,
           case when v_dated then x.act
                else greatest(x.updated_at, (select max(c.created_at) from ticket_comments c where c.ticket_id = x.id)) end
      from top x
     order by x.sc desc, 12 desc nulls last;
  end if;

  if v_task_only or (coalesce(array_length(v_terms, 1), 0) = 0 and coalesce(array_length(v_phrases, 1), 0) = 0) then
    return;
  end if;

  -- Lists carry no activity dates: a date filter leaves them out.
  if 'project' = any(v_kinds) and v_after is null and v_before is null then
    return query
    select 'project'::text, pr.id, pr.name, pr.id, pr.name, pr.team_id, pr.icon, pr.icon_url, null::text, null::text,
           public.fira_all_terms(v_terms, pr.name), null::timestamptz
      from projects pr
     where public.fira_all_terms(v_terms, pr.name) > 0
       and not exists (select 1 from unnest(v_phrases) x where strpos(public.fira_fold(pr.name), x) = 0)
       and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(pr.name), x) > 0)
       and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
     order by 11 desc, pr.name
     limit least(v_limit, 8);
  end if;

  if 'page' = any(v_kinds) then
    return query
    select x.* from (
      select 'page'::text, pg.id, pg.title, pg.project_id, null::text, pg.team_id, null::text, null::text, null::text, null::text,
             (select case when count(*) = 0 then 1::real when bool_and(q.s >= 0.8) then avg(q.s)::real else 0::real end
                from (select greatest(public.fira_term_score(t, pg.title),
                                      case when length(t) >= 3 and strpos(pg.search_fold, t) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) t) q) as sc,
             pg.updated_at
        from pages pg
       where pg.archived_at is null
         and (v_team is null or exists (select 1 from teams tm where tm.id = pg.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_after is null or pg.updated_at >= v_after)
         and (v_before is null or pg.updated_at < v_before)
         and not exists (select 1 from unnest(v_phrases) ph
                          where strpos(public.fira_fold(pg.title), ph) = 0 and strpos(pg.search_fold, ph) = 0)
         and not exists (select 1 from unnest(v_not) n where strpos(public.fira_fold(pg.title), n) > 0)
    ) x
     where x.sc > 0
     order by x.sc desc, x.updated_at desc
     limit least(v_limit, 8);
  end if;
end;
$$;

revoke all on function public.palette_search(jsonb) from public, anon;
grant execute on function public.palette_search(jsonb) to authenticated;

-- ========================================
-- 084_recurring_tickets.sql
-- ========================================
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

-- ========================================
-- 085_recurrence_engine.sql
-- ========================================
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

-- ========================================
-- 086_default_status_categories.sql
-- ========================================
-- 086: Yeni listenin varsayılan durumları kategorisiz açılıyordu (#59e0b75e sırasında bulundu)
--
-- 033 `ticket_statuses.category`yi ekledi ve mevcut satırları doldurdu, ama dört
-- varsayılan durumu üreten `create_default_statuses()` tetikleyicisi güncellenmedi.
-- Sonuç: 033'ten sonra açılan her listede "Tamamlandı" da dahil dört durum da
-- `active` kategorisinde kalıyordu. Etkisi: görev tamamlandı sayılmıyor (kutlama
-- yok, "kapatılanları göster" süzgeci boş, `durum:tamamlandı` araması tutmuyor,
-- tekrarlayan görev serisi hep "açık görev var" görüyor).
--
-- Kategoriler 033'teki adlandırma kurallarıyla aynı: Yapılacak → backlog,
-- Devam Ediyor / İncelemede → active, Tamamlandı → closed (mevcut listelerin
-- tamamı böyle; StatusManager de listede bir `closed` durum bekliyor).

create or replace function public.create_default_statuses() returns trigger as $$
begin
  insert into public.ticket_statuses (project_id, name, color, order_index, category) values
    (new.id, 'Yapılacak',    '#6b7280', 0, 'backlog'),
    (new.id, 'Devam Ediyor', '#3b82f6', 1, 'active'),
    (new.id, 'İncelemede',   '#f59e0b', 2, 'active'),
    (new.id, 'Tamamlandı',   '#10b981', 3, 'closed');
  return new;
end;
$$ language plpgsql;

-- 033'ten sonra açılmış listelerdeki yanlış kategorileri düzelt: yalnız adı
-- kalıbı tutan ve hâlâ `active` olan satırlara dokunur (elle verilmiş kategori
-- ya da yeniden adlandırılmış durum olduğu gibi kalır).
update public.ticket_statuses set category = 'closed'
 where category = 'active' and lower(name) ~ '(kapat|closed|iptal|cancel)';
update public.ticket_statuses s set category = 'closed'
 where s.category = 'active' and lower(s.name) ~ '(tamamlan|done|bitti|complete)'
   and not exists (select 1 from public.ticket_statuses c
                    where c.project_id = s.project_id and c.category in ('done', 'closed'));
update public.ticket_statuses set category = 'done'
 where category = 'active' and lower(name) ~ '(tamamlan|done|bitti|complete)';
update public.ticket_statuses set category = 'backlog'
 where category = 'active' and lower(name) ~ '(backlog|yapılacak|yapilacak|to ?do|başlanmadı|baslanmadi|planlan)';
update public.ticket_statuses set category = 'blocked'
 where category = 'active' and lower(name) ~ '(bloke|blocked|beklemede|engel)';

-- ========================================
-- 087_activity_actor_setting.sql
-- ========================================
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

-- ========================================
-- 088_materialize_occurrence.sql
-- ========================================
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

-- ========================================
-- 089_fanout_coalesce_restore.sql
-- ========================================
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

-- ========================================
-- 090_member_joined_notification.sql
-- ========================================
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

-- ========================================
-- 091_admin_user_delete_usage.sql
-- ========================================
-- 091: Yönetici paneli — kullanıcı silme, "bugün" metrikleri, özellik ısı haritası (#7AB2D9F6)
--
-- İstek (üç veritabanı parçası):
--   • "kullanıcı silme. Hans Bilal'i sehven yarattık, silemiyoruz."
--   • "Metriklere bugün eklensin"
--   • "bir heat map eklemek ne kadar zor? Hiç kullanılmayan özellikler ve çok
--      kullanılan özellikler gibi"

-- ── 1) Kullanıcının izi ──────────────────────────────────────────────────────
-- Silmeden önce ne bıraktığını göstermek şart: `profiles`e bakan yabancı
-- anahtarların çoğu CASCADE — kullanıcıyı öylece silmek onun açtığı görevleri,
-- yorumları, listeleri ve takımları da götürürdü. Panel önce bu sayıları
-- gösteriyor, içerik varsa silme devretmeden çalışmıyor.
CREATE OR REPLACE FUNCTION public.admin_user_footprint(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'is_admin', coalesce(p.is_admin, false),
    'source', p.source,
    'tickets',     (SELECT count(*) FROM tickets t WHERE t.created_by = p_user),
    'comments',    (SELECT count(*) FROM ticket_comments c WHERE c.author_id = p_user),
    'projects',    (SELECT count(*) FROM projects x WHERE x.created_by = p_user),
    'pages',       (SELECT count(*) FROM pages g WHERE g.created_by = p_user),
    'teams',       (SELECT count(*) FROM teams tm WHERE tm.created_by = p_user),
    'attachments', (SELECT count(*) FROM ticket_attachments a WHERE a.uploaded_by = p_user),
    'assigned',    (SELECT count(*) FROM ticket_assignees a WHERE a.user_id = p_user),
    'memberships', (SELECT count(*) FROM team_members m WHERE m.user_id = p_user),
    'owner_of',    (SELECT coalesce(jsonb_agg(tm.name ORDER BY tm.name), '[]'::jsonb)
                      FROM team_members m JOIN teams tm ON tm.id = m.team_id
                     WHERE m.user_id = p_user AND m.role = 'owner')
  ) INTO r
  FROM profiles p WHERE p.id = p_user;
  IF r IS NULL THEN RAISE EXCEPTION 'Kullanıcı bulunamadı'; END IF;
  -- Devretmeden silinebilir mi: yalnız kişisel satırları kalmışsa evet.
  r := r || jsonb_build_object('content',
    (r->>'tickets')::int + (r->>'comments')::int + (r->>'projects')::int +
    (r->>'pages')::int + (r->>'teams')::int + (r->>'attachments')::int);
  RETURN r;
END $$;

-- ── 2) Kullanıcıyı sil ───────────────────────────────────────────────────────
-- `p_reassign_to` verilirse kullanıcının **yarattığı** her şey o kişiye geçer
-- (görev, yorum, liste, sayfa, takım, ek…); kişisel satırlar (üyelik, atama,
-- favori, tercih, bildirim, Telegram bağı) silinir. Sonra `auth.users` satırı
-- silinir; `profiles` oradan CASCADE ile düşer.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user uuid, p_reassign_to uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f jsonb;
  v_name text;
BEGIN
  PERFORM public.admin_guard();
  IF p_user IS NULL THEN RAISE EXCEPTION 'Kullanıcı seçilmedi'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'Kendi hesabını silemezsin'; END IF;
  IF p_reassign_to = p_user THEN RAISE EXCEPTION 'İçerik silinen kişiye devredilemez'; END IF;

  f := public.admin_user_footprint(p_user);
  v_name := coalesce(f->>'full_name', f->>'email', p_user::text);
  IF (f->>'is_admin')::boolean THEN
    RAISE EXCEPTION 'Sistem yöneticisi silinemez; önce yönetici yetkisini kaldır';
  END IF;
  IF (f->>'content')::int > 0 AND p_reassign_to IS NULL THEN
    RAISE EXCEPTION 'Bu kullanıcının içeriği var (% görev, % yorum, % liste, % sayfa, % takım); silmeden önce devredilecek kişiyi seç',
      f->>'tickets', f->>'comments', f->>'projects', f->>'pages', f->>'teams';
  END IF;
  IF p_reassign_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_reassign_to) THEN
    RAISE EXCEPTION 'Devredilecek kullanıcı bulunamadı';
  END IF;

  IF p_reassign_to IS NOT NULL THEN
    -- Yarattıkları yeni sahibine geçer.
    UPDATE tickets            SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE tickets            SET updated_by = p_reassign_to WHERE updated_by = p_user;
    UPDATE ticket_comments    SET author_id  = p_reassign_to WHERE author_id  = p_user;
    UPDATE ticket_attachments SET uploaded_by = p_reassign_to WHERE uploaded_by = p_user;
    UPDATE ticket_links       SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE ticket_recurrences SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE projects           SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE team_folders       SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE teams              SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE pages              SET created_by = p_reassign_to WHERE created_by = p_user;
    UPDATE pages              SET updated_by = p_reassign_to WHERE updated_by = p_user;
    UPDATE pages              SET archived_by = p_reassign_to WHERE archived_by = p_user;
    UPDATE page_versions      SET author_id  = p_reassign_to WHERE author_id  = p_user;
    UPDATE list_views         SET owner_id   = p_reassign_to WHERE owner_id   = p_user;
    UPDATE team_invitations   SET invited_by = p_reassign_to WHERE invited_by = p_user;
    -- Silinen kişi bir takımın sahibiyse, devralan o takımın sahibi olur.
    INSERT INTO team_members (team_id, user_id, role)
    SELECT m.team_id, p_reassign_to, 'owner' FROM team_members m
     WHERE m.user_id = p_user AND m.role = 'owner'
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'owner';
  END IF;

  -- Kişisel satırlar: devredilmez, silinir. (Çoğu zaten CASCADE ama sayıyı
  -- denetim kaydına yazabilmek için burada açıkça siliniyor.)
  DELETE FROM ticket_assignees  WHERE user_id = p_user;
  DELETE FROM team_members      WHERE user_id = p_user;
  DELETE FROM user_favorites    WHERE user_id = p_user;
  DELETE FROM user_preferences  WHERE user_id = p_user;
  DELETE FROM user_notifications WHERE user_id = p_user;
  DELETE FROM ticket_mutes      WHERE user_id = p_user;

  PERFORM public.admin_log('delete_user', v_name, f || jsonb_build_object('reassigned_to', p_reassign_to));

  -- Hesabı olan kullanıcı auth tarafından, içe aktarmayla açılmış profil
  -- doğrudan silinir (onun auth.users satırı yok).
  IF f->>'source' = 'account' THEN
    DELETE FROM auth.users WHERE id = p_user;
  END IF;
  DELETE FROM profiles WHERE id = p_user;

  RETURN jsonb_build_object('deleted', v_name, 'reassigned_to', p_reassign_to, 'footprint', f);
END $$;

-- ── 3) Metrikler: "bugün" ve yerel gün sınırı ────────────────────────────────
-- `p_days = 0` bugünü verir (yerel gece yarısından beri). Gün kovaları da artık
-- yerel saat diliminde — sunucu UTC olduğu için günler 03:00'te bölünüyordu.
-- Eski tek argümanlı sürüm kalırsa PostgREST adlandırılmış çağrıda iki aday
-- arasında kalıyor ("function admin_metrics(integer) is not unique").
DROP FUNCTION IF EXISTS public.admin_metrics(INT);
CREATE OR REPLACE FUNCTION public.admin_metrics(p_days INT DEFAULT 30, p_tz TEXT DEFAULT 'Europe/Istanbul') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r JSONB;
  tz TEXT := coalesce(nullif(p_tz, ''), 'Europe/Istanbul');
  since TIMESTAMPTZ;
BEGIN
  PERFORM public.admin_guard();
  BEGIN
    PERFORM now() AT TIME ZONE tz;
  EXCEPTION WHEN OTHERS THEN tz := 'Europe/Istanbul';
  END;
  since := CASE WHEN coalesce(p_days, 30) <= 0
    THEN date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz
    ELSE now() - (p_days || ' days')::interval END;

  SELECT jsonb_build_object(
    'days', p_days,
    'tz', tz,
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'created', c.n, 'closed', cl.n, 'comments', cm.n, 'logins', lg.n) ORDER BY d), '[]'::jsonb)
      FROM generate_series(date_trunc('day', since AT TIME ZONE tz)::date, date_trunc('day', now() AT TIME ZONE tz)::date, interval '1 day') d
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t WHERE (t.created_at AT TIME ZONE tz)::date = d::date) c ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id WHERE s.category IN ('closed','done') AND (t.updated_at AT TIME ZONE tz)::date = d::date) cl ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM ticket_comments x WHERE (x.created_at AT TIME ZONE tz)::date = d::date) cm ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM auth.audit_log_entries a WHERE a.payload->>'action' = 'login' AND (a.created_at AT TIME ZONE tz)::date = d::date) lg ON true
    ),
    'status_categories', (
      SELECT coalesce(jsonb_object_agg(cat, n), '{}'::jsonb) FROM (
        SELECT coalesce(s.category, 'active') cat, count(*) n FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.archived_at IS NULL GROUP BY 1
      ) x
    ),
    'top_users', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('email', email, 'name', full_name, 'tickets', tk, 'comments', cm) ORDER BY tk + cm DESC), '[]'::jsonb) FROM (
        SELECT p.email, p.full_name,
          (SELECT count(*) FROM tickets t WHERE t.created_by = p.id AND t.created_at > since) tk,
          (SELECT count(*) FROM ticket_comments c WHERE c.author_id = p.id AND c.created_at > since) cm
        FROM profiles p
      ) u WHERE tk + cm > 0 LIMIT 10
    ),
    'avg_close_hours', (
      SELECT round(coalesce(avg(extract(epoch FROM (t.updated_at - t.created_at)) / 3600), 0)::numeric, 1)
      FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id WHERE s.category IN ('closed','done') AND t.updated_at > since
    ),
    'archived', (SELECT count(*) FROM tickets WHERE archived_at IS NOT NULL),
    'per_list', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('list', p.name, 'team', tm.name, 'open', o.n, 'total', tt.n) ORDER BY tt.n DESC), '[]'::jsonb)
      FROM projects p JOIN teams tm ON tm.id = p.team_id
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.project_id = p.id AND t.archived_at IS NULL AND coalesce(s.category,'active') NOT IN ('closed','done')) o ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t WHERE t.project_id = p.id) tt ON true
    )
  ) INTO r;
  RETURN r;
END $$;

-- ── 4) Özellik ısı haritası ──────────────────────────────────────────────────
-- Fira'da ayrı bir kullanım telemetrisi yok; ama her özelliğin kendi tablosu
-- ve zaman damgası var. Burada her özellik için gün gün sayım, toplam ve son
-- kullanım çıkarılıyor: ısı haritası bunu çiziyor, "hiç kullanılmayan" da
-- toplamı sıfır olan satır oluyor. Uyarı: bu **yazma** izi; yalnız okunan
-- özellikler (pano açma, arama) burada görünmez.
CREATE OR REPLACE FUNCTION public.admin_feature_usage(p_days INT DEFAULT 30, p_tz TEXT DEFAULT 'Europe/Istanbul') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r JSONB;
  tz TEXT := coalesce(nullif(p_tz, ''), 'Europe/Istanbul');
  days INT := greatest(1, least(coalesce(p_days, 30), 180));
  since TIMESTAMPTZ;
BEGIN
  PERFORM public.admin_guard();
  BEGIN
    PERFORM now() AT TIME ZONE tz;
  EXCEPTION WHEN OTHERS THEN tz := 'Europe/Istanbul';
  END;
  since := (date_trunc('day', now() AT TIME ZONE tz) - ((days - 1) || ' days')::interval) AT TIME ZONE tz;

  WITH f(key, grp, at) AS (
    SELECT 'ticket',      'gorev',   created_at FROM tickets
    UNION ALL SELECT 'subtask',    'gorev',   created_at FROM tickets WHERE parent_id IS NOT NULL
    UNION ALL SELECT 'comment',    'gorev',   created_at FROM ticket_comments
    UNION ALL SELECT 'attachment', 'gorev',   created_at FROM ticket_attachments
    UNION ALL SELECT 'tag',        'gorev',   created_at FROM tags   -- atama satirinda zaman damgasi yok, etiket tanimi sayiliyor
    UNION ALL SELECT 'link',       'gorev',   created_at FROM ticket_links
    UNION ALL SELECT 'recurrence', 'gorev',   created_at FROM ticket_recurrences
    UNION ALL SELECT 'reminder',   'bildirim', created_at FROM ticket_activity WHERE kind = 'reminder'
    UNION ALL SELECT 'mention',    'bildirim', created_at FROM ticket_activity WHERE kind = 'mentioned'
    UNION ALL SELECT 'mute',       'bildirim', created_at FROM ticket_mutes
    UNION ALL SELECT 'page',       'sayfa',   created_at FROM pages
    UNION ALL SELECT 'page_version', 'sayfa', created_at FROM page_versions
    UNION ALL SELECT 'list',       'yapi',    created_at FROM projects
    UNION ALL SELECT 'folder',     'yapi',    created_at FROM team_folders
    UNION ALL SELECT 'saved_view', 'yapi',    created_at FROM list_views
    UNION ALL SELECT 'favorite',   'yapi',    created_at FROM user_favorites
    UNION ALL SELECT 'invite',     'takim',   created_at FROM team_invitations
    UNION ALL SELECT 'team',       'takim',   created_at FROM teams
    UNION ALL SELECT 'ai_request', 'yapayzeka', created_at FROM ai_work_requests
  ), days AS (
    SELECT generate_series(date_trunc('day', since AT TIME ZONE tz)::date,
                           date_trunc('day', now() AT TIME ZONE tz)::date, interval '1 day')::date AS d
  ), keys(key, grp) AS (
    -- Sabit liste: hiç satırı olmayan özellik de ısı haritasında görünsün
    -- ("hiç kullanılmayan" sorusunun cevabı tam olarak bu satırlar).
    VALUES ('ticket','gorev'), ('subtask','gorev'), ('comment','gorev'), ('attachment','gorev'),
           ('tag','gorev'), ('link','gorev'), ('recurrence','gorev'),
           ('reminder','bildirim'), ('mention','bildirim'), ('mute','bildirim'),
           ('page','sayfa'), ('page_version','sayfa'),
           ('list','yapi'), ('folder','yapi'), ('saved_view','yapi'), ('favorite','yapi'),
           ('invite','takim'), ('team','takim'), ('ai_request','yapayzeka')
  ), cells AS (
    SELECT k.key, k.grp, d.d,
           (SELECT count(*) FROM f WHERE f.key = k.key AND (f.at AT TIME ZONE tz)::date = d.d) AS n
      FROM keys k CROSS JOIN days d
  )
  SELECT jsonb_build_object(
    'days', days, 'tz', tz,
    'dates', (SELECT coalesce(jsonb_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d), '[]'::jsonb) FROM days),
    'features', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'key'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'key', c.key,
          'group', min(c.grp),
          'counts', jsonb_agg(c.n ORDER BY c.d),
          'window_total', sum(c.n),
          'total', (SELECT count(*) FROM f WHERE f.key = c.key),
          'last_at', (SELECT max(at) FROM f WHERE f.key = c.key)
        ) AS x
        FROM cells c GROUP BY c.key
      ) y
    )
  ) INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.admin_user_footprint(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_feature_usage(int, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_metrics(int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_footprint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_feature_usage(int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metrics(int, text) TO authenticated;

-- ========================================
-- 092_comment_edit.sql
-- ========================================
-- 092: yorum düzenleme (#5d077b0e)
--
-- Yorum yazıldıktan sonra düzeltilemiyordu; RLS zaten yazarına UPDATE izni
-- veriyordu (028 `comments_update`), eksik olan iki şey vardı:
--   1) düzenlendiğini gösterecek bir damga,
--   2) düzenlemeyle EKLENEN @bahsetmelerin bildirilmesi — tetikleyici yalnız
--      INSERT ve DELETE'te çalışıyordu, yani sonradan anılan kişi haberdar
--      olmuyordu (CLAUDE.md: bahsetme üreten her metin yolu log_mentions'ı
--      çağırmalı).
-- Düzenlemenin kendisi aktiviteye yazılmaz: gelen kutusu aynı yorum için
-- ikinci bir satır görmesin; okunan metin zaten yorumun kendisi.

ALTER TABLE public.ticket_comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.comments_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'comment_added', NULL, left(NEW.content, 120), '{}'::jsonb, NEW.author_id);
    PERFORM public.log_mentions(NEW.ticket_id, NEW.content, NULL, jsonb_build_object('comment_id', NEW.id), NEW.author_id);
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Yalnız yeni eklenen bahsetmeler: log_mentions eski metni de alıp farkı buluyor.
    IF NEW.content IS DISTINCT FROM OLD.content THEN
      PERFORM public.log_mentions(NEW.ticket_id, NEW.content, OLD.content, jsonb_build_object('comment_id', NEW.id), NEW.author_id);
    END IF;
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'comment_removed', left(OLD.content, 120), NULL, '{}'::jsonb);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS comments_activity ON public.ticket_comments;
CREATE TRIGGER comments_activity AFTER INSERT OR UPDATE OF content OR DELETE ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_activity();

-- ========================================
-- 093_move_ticket_cross_team.sql
-- ========================================
-- 093: görevi başka takımın listesine taşıma (#4e8dc8f1)
--
-- 078'de taşıma aynı takımla sınırlıydı. İstek: "kişi iki takımda da yöneticiyse
-- görevi diğer takımdaki bir listeye de taşıyabilsin". Kural buna göre ikiye
-- ayrıldı:
--   • aynı takım  → eskisi gibi yazma yetkisi (`can_write_team`) yeter,
--   • başka takım → **hem kaynakta hem hedefte** yönetici olmak şart.
--
-- Takım değişince göreve bağlı bazı satırların karşılığı kalmıyor:
--   • Etiketler zaten listeye ait; 078'deki ada göre eşleme aynen çalışıyor.
--   • Atamalar: hedef takımın üyesi olmayan kişiler düşürülüyor. Aksi hâlde
--     göremeyeceği bir görevin üstünde adı kalır, bildirim akışı da onu
--     hedeflemeye devam ederdi. Kaç kişinin düştüğü aktivite satırına yazılır.
-- Alt görevler özyinelemeyle birlikte taşınır (078), yetki her adımda
-- yeniden kontrol edilir.

CREATE OR REPLACE FUNCTION public.move_ticket(p_ticket uuid, p_project uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  src       public.tickets%ROWTYPE;
  v_me      uuid := auth.uid();
  v_status  uuid;
  v_min     integer;
  v_from    text;
  v_to      text;
  v_child   uuid;
  v_src_team uuid;
  v_dst_team uuid;
  v_dropped  integer := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'oturum yok'; END IF;
  SELECT * INTO src FROM public.tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'görev bulunamadı'; END IF;
  IF src.project_id = p_project THEN RETURN; END IF;

  v_src_team := public.project_team(src.project_id);
  v_dst_team := public.project_team(p_project);
  IF v_dst_team IS NULL THEN RAISE EXCEPTION 'hedef liste bulunamadı'; END IF;

  IF v_dst_team = v_src_team THEN
    IF NOT public.can_write_team(v_dst_team) THEN RAISE EXCEPTION 'yetki yok'; END IF;
  ELSE
    IF NOT (public.is_team_admin(v_src_team) AND public.is_team_admin(v_dst_team)) THEN
      RAISE EXCEPTION 'başka takıma taşımak için iki takımda da yönetici olmalısın';
    END IF;
  END IF;

  SELECT name INTO v_from FROM public.projects WHERE id = src.project_id;
  SELECT name INTO v_to FROM public.projects WHERE id = p_project;
  v_status := public.target_status(p_project, src.status_id, src.status);
  SELECT coalesce(min(order_index), 0) - 1 INTO v_min FROM public.tickets WHERE status_id = v_status;

  PERFORM set_config('fira.manual_reorder', '1', true);
  UPDATE public.tickets
     SET project_id = p_project,
         status_id = v_status,
         status = (SELECT name FROM public.ticket_statuses WHERE id = v_status),
         order_index = v_min,
         parent_id = CASE WHEN parent_id IS NOT NULL AND (SELECT project_id FROM public.tickets x WHERE x.id = src.parent_id) <> p_project THEN NULL ELSE parent_id END,
         updated_by = v_me,
         updated_at = now()
   WHERE id = p_ticket;

  -- Tags belong to a list: keep the ones the new list also has (by name), drop the rest.
  INSERT INTO public.ticket_tag_assignments (ticket_id, tag_id)
  SELECT DISTINCT p_ticket, t2.id
  FROM public.ticket_tag_assignments ta
  JOIN public.tags t1 ON t1.id = ta.tag_id AND t1.project_id = src.project_id
  JOIN public.tags t2 ON t2.project_id = p_project AND t2.name = t1.name
  WHERE ta.ticket_id = p_ticket
  ON CONFLICT DO NOTHING;
  DELETE FROM public.ticket_tag_assignments ta USING public.tags t
   WHERE ta.ticket_id = p_ticket AND t.id = ta.tag_id AND t.project_id <> p_project;

  -- Başka takıma geçtiyse: hedef takımın üyesi olmayan atamalar düşer.
  IF v_dst_team <> v_src_team THEN
    WITH gone AS (
      DELETE FROM public.ticket_assignees a
       WHERE a.ticket_id = p_ticket
         AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = v_dst_team AND tm.user_id = a.user_id)
      RETURNING 1
    ) SELECT count(*) INTO v_dropped FROM gone;
  END IF;

  PERFORM public.log_activity(p_ticket, 'project', v_from, v_to,
    jsonb_build_object('from_project', src.project_id, 'to_project', p_project)
      || CASE WHEN v_dst_team <> v_src_team
              THEN jsonb_build_object('from_team', v_src_team, 'to_team', v_dst_team, 'dropped_assignees', v_dropped)
              ELSE '{}'::jsonb END,
    v_me);

  FOR v_child IN SELECT id FROM public.tickets WHERE parent_id = p_ticket LOOP
    PERFORM public.move_ticket(v_child, p_project);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.move_ticket(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_ticket(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
