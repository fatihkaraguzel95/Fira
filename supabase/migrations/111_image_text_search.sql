-- 111: The text read from pictures is found by search (#4c4b0344; phase 4, #0fc67dbb).
--
-- 110 keeps what was read from a picture beside the file (file_texts). A task is found by the words
-- in its pictures when that text counts as part of the task's own text for the palette.
--
-- The palette reads tickets.search_fold (the folded description, a generated column). The pictures'
-- text is NOT written into the ticket row: updating a ticket moves its updated_at, tells every open
-- client, and would look like "somebody changed this task" to a person who is editing it. It lives in
-- a table of its own, one row per task, kept by triggers:
--
--   ticket_image_folds(ticket_id, team_id, fold)   fold = the folded text + description of every read
--                                                  picture among the task's files
--
-- and palette_search joins it. The function below is 098's body with those two lines added.

ALTER TABLE public.file_texts ADD COLUMN IF NOT EXISTS search_fold text
  GENERATED ALWAYS AS (public.fira_fold(coalesce(text, '') || ' ' || coalesce(description, ''))) STORED;

CREATE TABLE IF NOT EXISTS public.ticket_image_folds (
  ticket_id UUID PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
  team_id   UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  fold      TEXT NOT NULL
);
ALTER TABLE public.ticket_image_folds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_image_folds_select ON public.ticket_image_folds;
CREATE POLICY ticket_image_folds_select ON public.ticket_image_folds FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL OR public.is_system_admin());
REVOKE ALL ON public.ticket_image_folds FROM anon, authenticated;
GRANT SELECT ON public.ticket_image_folds TO authenticated;

-- One task's row, from its files as they are now. A task with no read picture has no row.
CREATE OR REPLACE FUNCTION public.refresh_ticket_image_fold(p_ticket uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  v_fold text;
BEGIN
  SELECT public.project_team(t.project_id) INTO v_team FROM tickets t WHERE t.id = p_ticket;
  IF v_team IS NULL THEN RETURN; END IF;   -- the task is gone (its row goes with it)
  SELECT btrim(string_agg(DISTINCT ft.search_fold, ' ')) INTO v_fold
    FROM ticket_attachments a JOIN file_texts ft ON ft.file_url = a.file_url AND ft.status = 'done'
   WHERE a.ticket_id = p_ticket;
  IF coalesce(v_fold, '') = '' THEN
    DELETE FROM ticket_image_folds WHERE ticket_id = p_ticket;
  ELSE
    INSERT INTO ticket_image_folds (ticket_id, team_id, fold) VALUES (p_ticket, v_team, v_fold)
    ON CONFLICT (ticket_id) DO UPDATE SET fold = EXCLUDED.fold, team_id = EXCLUDED.team_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.refresh_ticket_image_fold(uuid) FROM public, anon, authenticated;

-- A picture was read (or its result changed): every task that has the file gets its row again.
CREATE OR REPLACE FUNCTION public.file_texts_refresh_folds() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r     record;
  v_url text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_url := OLD.file_url; ELSE v_url := NEW.file_url; END IF;
  FOR r IN SELECT DISTINCT a.ticket_id FROM ticket_attachments a WHERE a.file_url = v_url LOOP
    PERFORM public.refresh_ticket_image_fold(r.ticket_id);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS file_texts_refresh_folds ON public.file_texts;
CREATE TRIGGER file_texts_refresh_folds AFTER INSERT OR UPDATE OF status, text, description OR DELETE ON public.file_texts
  FOR EACH ROW EXECUTE FUNCTION public.file_texts_refresh_folds();
REVOKE ALL ON FUNCTION public.file_texts_refresh_folds() FROM public, anon, authenticated;

-- A file was added to a task or taken off it.
CREATE OR REPLACE FUNCTION public.ticket_attachments_refresh_fold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_ticket_image_fold(OLD.ticket_id);
  ELSIF EXISTS (SELECT 1 FROM file_texts ft WHERE ft.file_url = NEW.file_url AND ft.status = 'done') THEN
    PERFORM public.refresh_ticket_image_fold(NEW.ticket_id);   -- a copy of a file that was read before
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ticket_attachments_refresh_fold ON public.ticket_attachments;
CREATE TRIGGER ticket_attachments_refresh_fold AFTER INSERT OR DELETE ON public.ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION public.ticket_attachments_refresh_fold();
REVOKE ALL ON FUNCTION public.ticket_attachments_refresh_fold() FROM public, anon, authenticated;

-- What was read before this migration.
SELECT public.refresh_ticket_image_fold(x.ticket_id)
  FROM (SELECT DISTINCT a.ticket_id FROM ticket_attachments a JOIN file_texts ft ON ft.file_url = a.file_url AND ft.status = 'done') x;

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
       and (v_team_id is null or pr.team_id = v_team_id)
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
     limit least(v_limit, 8);
  end if;
end;
$$;

revoke all on function public.palette_search(jsonb) from public, anon;
grant execute on function public.palette_search(jsonb) to authenticated;
