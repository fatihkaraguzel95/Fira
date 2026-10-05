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
