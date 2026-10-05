-- 114: Search by kind knows drawings and whiteboards (#570e41ee).
--
-- A drawing and a whiteboard are rows of `pages` (096), and the palette found them as pages:
-- `tür:sayfa` listed text pages, drawings and whiteboards together, and there was no way to ask
-- for only one of them.
--
--   kinds: 'page'        text pages only (before: every row of pages)
--          'drawing'     drawings
--          'whiteboard'  whiteboards
--   no kinds at all      everything, as before
--
-- The result keeps kind = 'page' for all three (an older screen opens every one of them the same
-- way, by its page id, and knows no other kind); which of the three it is comes in `icon`
-- ('drawing' | 'whiteboard', NULL for a text page), a column pages did not use.
--
-- A kind asked for by name without a word ("tür:whiteboard") lists that kind, newest first, up to
-- the whole limit. Before, a search without words listed tasks only, so "tür:sayfa" by itself found
-- nothing.
--
-- Who sees a drawing or a whiteboard is still RLS's word (the beta switch, 096): the function runs
-- as the caller.
--
-- The function below is 111's body with those changes.

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
  v_kinds   text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'kinds') x), array['ticket', 'project', 'page', 'drawing', 'whiteboard']);
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
  -- 098: kesin kapsam (görev penceresindeki bağlama çubuğu). Ad değil kimlik.
  v_project uuid := nullif(btrim(p->>'project_id'), '')::uuid;
  v_team_id uuid := nullif(btrim(p->>'team_id'), '')::uuid;
begin
  if v_status = '{}' or v_status = '{""}' then v_status := null; end if;
  if v_tag = '{}' or v_tag = '{""}' then v_tag := null; end if;
  if v_list = '{}' or v_list = '{""}' then v_list := null; end if;
  if v_team = '{}' or v_team = '{""}' then v_team := null; end if;
  -- Filters that only make sense for tasks: when one is set, lists and pages are not returned.
  v_task_only := v_assignee is not null or v_creator is not null or v_status is not null or v_tag is not null or v_list is not null
    or v_comment is not null or v_state is not null or v_priority is not null or v_due is not null
    or coalesce(array_length(v_has, 1), 0) > 0 or v_on_from is not null or v_cr_from is not null
    or v_project is not null;

  if 'ticket' = any(v_kinds) then
    return query
    with base as (
      select t.id, t.title, (t.search_fold || ' ' || coalesce(imf.fold, '')) as dfold, t.project_id, pr.name as pname, pr.team_id as tid,
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
        -- 111: what was read from the task's pictures counts as its text
        left join ticket_image_folds imf on imf.ticket_id = t.id
       where t.archived_at is null
         and (v_project is null or t.project_id = v_project)
         and (v_team_id is null or pr.team_id = v_team_id)
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

  -- A search without words lists tasks only (the filters are about tasks), unless a kind was asked for by
  -- name (114): "tür:whiteboard" alone lists the whiteboards, newest first.
  if v_task_only or (coalesce(array_length(v_terms, 1), 0) = 0 and coalesce(array_length(v_phrases, 1), 0) = 0 and (p->'kinds') is null) then
    return;
  end if;

  -- Lists carry no activity dates: a date filter leaves them out.
  if 'project' = any(v_kinds) and v_after is null and v_before is null then
    return query
    select 'project'::text, pr.id, pr.name, pr.id, pr.name, pr.team_id, pr.icon, pr.icon_url, null::text, null::text,
           public.fira_all_terms(v_terms, pr.name), null::timestamptz
      from projects pr
     where public.fira_all_terms(v_terms, pr.name) > 0
       and (v_team_id is null or pr.team_id = v_team_id)
       and not exists (select 1 from unnest(v_phrases) x where strpos(public.fira_fold(pr.name), x) = 0)
       and not exists (select 1 from unnest(v_not) x where strpos(public.fira_fold(pr.name), x) > 0)
       and (v_team is null or exists (select 1 from teams tm where tm.id = pr.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
     order by 11 desc, pr.name
     limit least(v_limit, 8);
  end if;

  -- 114: a row of `pages` is a page, a drawing or a whiteboard; each is asked for by its own name
  if v_kinds && array['page', 'drawing', 'whiteboard'] then
    return query
    select x.* from (
      select 'page'::text, pg.id, pg.title, pg.project_id, null::text, pg.team_id,
             case when pg.kind = 'page' then null::text else pg.kind end,   -- which mark to draw (114)
             null::text, null::text, null::text,
             (select case when count(*) = 0 then 1::real when bool_and(q.s >= 0.8) then avg(q.s)::real else 0::real end
                from (select greatest(public.fira_term_score(t, pg.title),
                                      case when length(t) >= 3 and strpos(pg.search_fold, t) > 0 then 0.8 else 0 end) s
                        from unnest(v_terms) t) q) as sc,
             pg.updated_at
        from pages pg
       where pg.archived_at is null
         and pg.kind = any(v_kinds)
         and (v_team_id is null or pg.team_id = v_team_id)
         and (v_team is null or exists (select 1 from teams tm where tm.id = pg.team_id and public.fira_all_terms(v_team, tm.name) >= 0.8))
         and (v_after is null or pg.updated_at >= v_after)
         and (v_before is null or pg.updated_at < v_before)
         and not exists (select 1 from unnest(v_phrases) ph
                          where strpos(public.fira_fold(pg.title), ph) = 0 and strpos(pg.search_fold, ph) = 0)
         and not exists (select 1 from unnest(v_not) n where strpos(public.fira_fold(pg.title), n) > 0)
    ) x
     where x.sc > 0
     order by x.sc desc, x.updated_at desc
     -- asked for by kind, without tasks: the whole page of results is theirs
     limit case when (p->'kinds') is not null and not ('ticket' = any(v_kinds)) then v_limit else least(v_limit, 8) end;
  end if;
end;
$$;

revoke all on function public.palette_search(jsonb) from public, anon;
grant execute on function public.palette_search(jsonb) to authenticated;
