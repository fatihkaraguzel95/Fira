-- Fira migrations 024 -> 038  (part 1/7)
-- Supabase Dashboard -> SQL Editor: bu dosyanin tamamini yapistirip calistirin.
-- Parcalari SIRAYLA calistirin; bir parca hata verirse sonrakine gecmeyin.

-- ========================================
-- 024_project_archive.sql
-- ========================================
-- Add archived column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

-- ========================================
-- 025_tickets_update_all_members.sql
-- ========================================
-- Fix: Allow all team members (not just owners/assignees) to update tickets
-- in projects they belong to.

DROP POLICY IF EXISTS "tickets_update" ON tickets;

CREATE POLICY "tickets_update" ON tickets
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE p.id = tickets.project_id
        AND tm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE p.id = tickets.project_id
        AND tm.user_id = auth.uid()
    )
  );

-- ========================================
-- 026_tickets_archived_at.sql
-- ========================================
-- 026: Ticket archiving (the app already filters/updates tickets.archived_at;
-- this column was never added by a migration, which breaks the list view with
-- "column tickets.archived_at does not exist").
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS tickets_archived_at_idx ON tickets(archived_at) WHERE archived_at IS NULL;

-- ========================================
-- 027_nullable_priority.sql
-- ========================================
-- 027: Priority is optional. New tickets/subtasks start with no priority; the
-- user can also clear a previously chosen one. Existing rows keep their value.
ALTER TABLE tickets ALTER COLUMN priority DROP NOT NULL;
ALTER TABLE tickets ALTER COLUMN priority DROP DEFAULT;

ALTER TABLE ticket_subtasks ALTER COLUMN priority DROP NOT NULL;
ALTER TABLE ticket_subtasks ALTER COLUMN priority DROP DEFAULT;

-- ========================================
-- 028_roles_folders_colors_invites.sql
-- ========================================
-- 028: Team roles (owner/admin/member/viewer), folders, list appearance
--      (icon/logo/colour), team colour palette, e-mail invitations and a
--      role-aware RLS rewrite. Joining a team only happens through
--      SECURITY DEFINER functions, so nobody can insert themselves with a
--      higher role than they were given.

-- ─── Roles ───────────────────────────────────────────────────────────────────
ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
ALTER TABLE team_members
  ADD CONSTRAINT team_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

-- ─── Helpers (SECURITY DEFINER: policies must not recurse into RLS) ──────────
CREATE OR REPLACE FUNCTION public.team_role(t uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM team_members WHERE team_id = t AND user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_team_admin(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.team_role(t) IN ('owner', 'admin'), false)
$$;

CREATE OR REPLACE FUNCTION public.can_write_team(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.team_role(t) IN ('owner', 'admin', 'member'), false)
$$;

CREATE OR REPLACE FUNCTION public.project_team(p uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT team_id FROM projects WHERE id = p
$$;

CREATE OR REPLACE FUNCTION public.ticket_team(tk uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.team_id FROM tickets t JOIN projects p ON p.id = t.project_id WHERE t.id = tk
$$;

-- ─── Team colour palette ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_colors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  hex         TEXT NOT NULL CHECK (hex ~ '^#[0-9a-fA-F]{6}$'),
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_colors_team_idx ON team_colors(team_id);

-- ─── Folders (Team → Folder → List) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color_id    UUID REFERENCES team_colors(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_folders_team_idx ON team_folders(team_id);

-- ─── Lists (table stays "projects"; UI calls them "Liste") ───────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS folder_id   UUID REFERENCES team_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS icon        TEXT,                                   -- preset icon key
  ADD COLUMN IF NOT EXISTS icon_url    TEXT,                                   -- uploaded logo
  ADD COLUMN IF NOT EXISTS color_id    UUID REFERENCES team_colors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS projects_folder_idx ON projects(folder_id);

-- ─── Invitations ─────────────────────────────────────────────────────────────
ALTER TABLE team_invitations
  ADD COLUMN IF NOT EXISTS role        TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'member', 'viewer')),
  ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
-- status: pending | accepted | declined | revoked
CREATE INDEX IF NOT EXISTS team_invitations_email_idx ON team_invitations (lower(email));
CREATE INDEX IF NOT EXISTS team_invitations_team_idx  ON team_invitations (team_id);

-- ─── Membership RPCs (the ONLY way to join a team) ───────────────────────────
CREATE OR REPLACE FUNCTION public.join_team_by_code(p_code text) RETURNS teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t teams;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Oturum bulunamadı'; END IF;
  SELECT * INTO t FROM teams WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN RAISE EXCEPTION 'Geçersiz takım kodu'; END IF;
  IF EXISTS (SELECT 1 FROM team_members WHERE team_id = t.id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Zaten bu takımın üyesisin';
  END IF;
  INSERT INTO team_members (team_id, user_id, role) VALUES (t.id, auth.uid(), 'member');
  RETURN t;
END $$;

-- Accept by token (link) — anyone holding the link joins with the invitation's role
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text) RETURNS teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv team_invitations; t teams;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Önce giriş yapmalısın'; END IF;
  SELECT * INTO inv FROM team_invitations
   WHERE token = p_token AND status = 'pending' AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RAISE EXCEPTION 'Geçersiz veya süresi dolmuş davet linki'; END IF;
  INSERT INTO team_members (team_id, user_id, role) VALUES (inv.team_id, auth.uid(), inv.role)
    ON CONFLICT (team_id, user_id) DO NOTHING;
  UPDATE team_invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   WHERE id = inv.id;
  SELECT * INTO t FROM teams WHERE id = inv.team_id;
  RETURN t;
END $$;

-- Accept an in-app invitation addressed to my e-mail (no link needed)
CREATE OR REPLACE FUNCTION public.accept_invitation_by_id(p_id uuid) RETURNS teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv team_invitations; t teams;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Önce giriş yapmalısın'; END IF;
  SELECT * INTO inv FROM team_invitations
   WHERE id = p_id AND status = 'pending' AND lower(email) = lower(auth.email())
     AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RAISE EXCEPTION 'Davet bulunamadı'; END IF;
  INSERT INTO team_members (team_id, user_id, role) VALUES (inv.team_id, auth.uid(), inv.role)
    ON CONFLICT (team_id, user_id) DO NOTHING;
  UPDATE team_invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   WHERE id = inv.id;
  SELECT * INTO t FROM teams WHERE id = inv.team_id;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE team_invitations SET status = 'declined'
   WHERE id = p_id AND status = 'pending' AND lower(email) = lower(auth.email());
END $$;

-- Admins add an existing user directly by e-mail (no invitation round-trip)
CREATE OR REPLACE FUNCTION public.add_team_member_by_email(p_team uuid, p_email text, p_role text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pr profiles;
BEGIN
  IF NOT public.is_team_admin(p_team) THEN RAISE EXCEPTION 'Bu işlem için yetkiniz yok'; END IF;
  IF p_role NOT IN ('admin', 'member', 'viewer') THEN RAISE EXCEPTION 'Geçersiz rol'; END IF;
  IF p_role = 'admin' AND public.team_role(p_team) <> 'owner' THEN
    RAISE EXCEPTION 'Yönetici atamayı yalnızca takım sahibi yapabilir';
  END IF;
  SELECT * INTO pr FROM profiles WHERE lower(email) = lower(trim(p_email));
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu e-posta ile kayıtlı kullanıcı yok'; END IF;
  IF EXISTS (SELECT 1 FROM team_members WHERE team_id = p_team AND user_id = pr.id) THEN
    RAISE EXCEPTION 'Kullanıcı zaten takımda';
  END IF;
  INSERT INTO team_members (team_id, user_id, role) VALUES (p_team, pr.id, p_role);
  RETURN pr;
END $$;

-- Invitations waiting for me (matched by e-mail), with team + inviter names
CREATE OR REPLACE FUNCTION public.my_pending_invitations()
RETURNS TABLE (id uuid, team_id uuid, team_name text, role text, invited_by_name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.team_id, t.name, i.role, COALESCE(p.full_name, p.email), i.created_at
    FROM team_invitations i
    JOIN teams t ON t.id = i.team_id
    LEFT JOIN profiles p ON p.id = i.invited_by
   WHERE i.status = 'pending'
     AND lower(i.email) = lower(auth.email())
     AND (i.expires_at IS NULL OR i.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = i.team_id AND m.user_id = auth.uid())
   ORDER BY i.created_at DESC
$$;

-- Invitation preview for the /invite/:token page (name only, before joining)
CREATE OR REPLACE FUNCTION public.invitation_preview(p_token text)
RETURNS TABLE (team_name text, role text, valid boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, i.role,
         (i.status = 'pending' AND (i.expires_at IS NULL OR i.expires_at > now()))
    FROM team_invitations i JOIN teams t ON t.id = i.team_id
   WHERE i.token = p_token
$$;

-- ─── RLS: teams / members ────────────────────────────────────────────────────
DROP POLICY IF EXISTS teams_select ON teams;
CREATE POLICY teams_select ON teams FOR SELECT TO authenticated
  USING (public.team_role(id) IS NOT NULL);
DROP POLICY IF EXISTS teams_update_owner ON teams;
CREATE POLICY teams_update_admin ON teams FOR UPDATE TO authenticated
  USING (public.is_team_admin(id)) WITH CHECK (public.is_team_admin(id));
-- teams_delete_owner (created_by = auth.uid()) stays

DROP POLICY IF EXISTS team_members_select ON team_members;
CREATE POLICY team_members_select ON team_members FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL);
DROP POLICY IF EXISTS team_members_insert_self ON team_members;
DROP POLICY IF EXISTS team_members_insert_owner ON team_members;
-- No direct INSERT for users: joining goes through the RPCs above (SECURITY DEFINER).
DROP POLICY IF EXISTS team_members_update ON team_members;
CREATE POLICY team_members_update ON team_members FOR UPDATE TO authenticated
  USING (
    role <> 'owner' AND (
      public.team_role(team_id) = 'owner'
      OR (public.team_role(team_id) = 'admin' AND role IN ('member', 'viewer'))
    )
  )
  WITH CHECK (
    role IN ('admin', 'member', 'viewer') AND (
      public.team_role(team_id) = 'owner'
      OR (public.team_role(team_id) = 'admin' AND role IN ('member', 'viewer'))
    )
  );
DROP POLICY IF EXISTS team_members_delete ON team_members;
CREATE POLICY team_members_delete ON team_members FOR DELETE TO authenticated
  USING (
    role <> 'owner' AND (
      user_id = auth.uid()                                   -- leave the team
      OR public.team_role(team_id) = 'owner'
      OR (public.team_role(team_id) = 'admin' AND role IN ('member', 'viewer'))
    )
  );

-- ─── RLS: invitations ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS team_invitations_select ON team_invitations;
DROP POLICY IF EXISTS team_invitations_insert ON team_invitations;
DROP POLICY IF EXISTS team_invitations_update ON team_invitations;
CREATE POLICY team_invitations_select ON team_invitations FOR SELECT TO authenticated
  USING (public.is_team_admin(team_id) OR lower(email) = lower(auth.email()));
CREATE POLICY team_invitations_insert ON team_invitations FOR INSERT TO authenticated
  WITH CHECK (
    public.is_team_admin(team_id) AND invited_by = auth.uid()
    AND (role <> 'admin' OR public.team_role(team_id) = 'owner')
  );
CREATE POLICY team_invitations_update ON team_invitations FOR UPDATE TO authenticated
  USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
CREATE POLICY team_invitations_delete ON team_invitations FOR DELETE TO authenticated
  USING (public.is_team_admin(team_id));

-- ─── RLS: folders / colours / lists ──────────────────────────────────────────
ALTER TABLE team_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_folders_select ON team_folders FOR SELECT TO authenticated USING (public.team_role(team_id) IS NOT NULL);
CREATE POLICY team_folders_insert ON team_folders FOR INSERT TO authenticated WITH CHECK (public.is_team_admin(team_id) AND created_by = auth.uid());
CREATE POLICY team_folders_update ON team_folders FOR UPDATE TO authenticated USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
CREATE POLICY team_folders_delete ON team_folders FOR DELETE TO authenticated USING (public.is_team_admin(team_id));

ALTER TABLE team_colors ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_colors_select ON team_colors FOR SELECT TO authenticated USING (public.team_role(team_id) IS NOT NULL);
CREATE POLICY team_colors_insert ON team_colors FOR INSERT TO authenticated WITH CHECK (public.is_team_admin(team_id));
CREATE POLICY team_colors_update ON team_colors FOR UPDATE TO authenticated USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
CREATE POLICY team_colors_delete ON team_colors FOR DELETE TO authenticated USING (public.is_team_admin(team_id));

DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;
CREATE POLICY projects_select ON projects FOR SELECT TO authenticated USING (public.team_role(team_id) IS NOT NULL);
CREATE POLICY projects_insert ON projects FOR INSERT TO authenticated WITH CHECK (public.is_team_admin(team_id) AND created_by = auth.uid());
CREATE POLICY projects_update ON projects FOR UPDATE TO authenticated USING (public.is_team_admin(team_id)) WITH CHECK (public.is_team_admin(team_id));
CREATE POLICY projects_delete ON projects FOR DELETE TO authenticated USING (public.is_team_admin(team_id));

-- ─── RLS: statuses / tags (members may manage; viewers read) ─────────────────
DROP POLICY IF EXISTS ticket_statuses_select ON ticket_statuses;
DROP POLICY IF EXISTS ticket_statuses_insert ON ticket_statuses;
DROP POLICY IF EXISTS ticket_statuses_update ON ticket_statuses;
DROP POLICY IF EXISTS ticket_statuses_delete ON ticket_statuses;
CREATE POLICY ticket_statuses_select ON ticket_statuses FOR SELECT TO authenticated USING (public.team_role(public.project_team(project_id)) IS NOT NULL);
CREATE POLICY ticket_statuses_insert ON ticket_statuses FOR INSERT TO authenticated WITH CHECK (public.can_write_team(public.project_team(project_id)));
CREATE POLICY ticket_statuses_update ON ticket_statuses FOR UPDATE TO authenticated USING (public.can_write_team(public.project_team(project_id)));
CREATE POLICY ticket_statuses_delete ON ticket_statuses FOR DELETE TO authenticated USING (public.can_write_team(public.project_team(project_id)));

DROP POLICY IF EXISTS tags_select ON tags;
DROP POLICY IF EXISTS tags_insert ON tags;
DROP POLICY IF EXISTS tags_update ON tags;
DROP POLICY IF EXISTS tags_delete ON tags;
CREATE POLICY tags_select ON tags FOR SELECT TO authenticated USING (public.team_role(public.project_team(project_id)) IS NOT NULL);
CREATE POLICY tags_insert ON tags FOR INSERT TO authenticated WITH CHECK (public.can_write_team(public.project_team(project_id)));
CREATE POLICY tags_update ON tags FOR UPDATE TO authenticated USING (public.can_write_team(public.project_team(project_id)));
CREATE POLICY tags_delete ON tags FOR DELETE TO authenticated USING (public.can_write_team(public.project_team(project_id)));

-- ─── RLS: tickets ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tickets_select_all ON tickets;
DROP POLICY IF EXISTS tickets_insert_own ON tickets;
DROP POLICY IF EXISTS tickets_update ON tickets;
DROP POLICY IF EXISTS tickets_delete ON tickets;
CREATE POLICY tickets_select ON tickets FOR SELECT TO authenticated
  USING (public.team_role(public.project_team(project_id)) IS NOT NULL);
CREATE POLICY tickets_insert ON tickets FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_write_team(public.project_team(project_id)));
CREATE POLICY tickets_update ON tickets FOR UPDATE TO authenticated
  USING (public.can_write_team(public.project_team(project_id)))
  WITH CHECK (public.can_write_team(public.project_team(project_id)));
CREATE POLICY tickets_delete ON tickets FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_team_admin(public.project_team(project_id)));

-- ─── RLS: subtasks / comments / attachments / assignees / tags / deadlines ───
DROP POLICY IF EXISTS subtasks_select_all ON ticket_subtasks;
DROP POLICY IF EXISTS subtasks_insert_own ON ticket_subtasks;
DROP POLICY IF EXISTS subtasks_update_any ON ticket_subtasks;
DROP POLICY IF EXISTS subtasks_delete_own ON ticket_subtasks;
CREATE POLICY subtasks_select ON ticket_subtasks FOR SELECT TO authenticated USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY subtasks_insert ON ticket_subtasks FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY subtasks_update ON ticket_subtasks FOR UPDATE TO authenticated USING (public.can_write_team(public.ticket_team(ticket_id))) WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY subtasks_delete ON ticket_subtasks FOR DELETE TO authenticated USING (created_by = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)));

DROP POLICY IF EXISTS comments_select_all ON ticket_comments;
DROP POLICY IF EXISTS comments_insert_own ON ticket_comments;
DROP POLICY IF EXISTS comments_update_own ON ticket_comments;
DROP POLICY IF EXISTS comments_delete_own ON ticket_comments;
CREATE POLICY comments_select ON ticket_comments FOR SELECT TO authenticated USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY comments_insert ON ticket_comments FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid() AND public.team_role(public.ticket_team(ticket_id)) IS NOT NULL); -- viewers may comment
CREATE POLICY comments_update ON ticket_comments FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY comments_delete ON ticket_comments FOR DELETE TO authenticated USING (author_id = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)));

DROP POLICY IF EXISTS attachments_select_all ON ticket_attachments;
DROP POLICY IF EXISTS attachments_insert_own ON ticket_attachments;
DROP POLICY IF EXISTS attachments_delete_own ON ticket_attachments;
CREATE POLICY attachments_select ON ticket_attachments FOR SELECT TO authenticated USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY attachments_insert ON ticket_attachments FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid() AND public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY attachments_delete ON ticket_attachments FOR DELETE TO authenticated USING (uploaded_by = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)));

DROP POLICY IF EXISTS ticket_assignees_select ON ticket_assignees;
DROP POLICY IF EXISTS ticket_assignees_insert ON ticket_assignees;
DROP POLICY IF EXISTS ticket_assignees_delete ON ticket_assignees;
CREATE POLICY ticket_assignees_select ON ticket_assignees FOR SELECT TO authenticated USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY ticket_assignees_insert ON ticket_assignees FOR INSERT TO authenticated WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY ticket_assignees_delete ON ticket_assignees FOR DELETE TO authenticated USING (public.can_write_team(public.ticket_team(ticket_id)));

DROP POLICY IF EXISTS tag_assignments_select ON ticket_tag_assignments;
DROP POLICY IF EXISTS tag_assignments_insert ON ticket_tag_assignments;
DROP POLICY IF EXISTS tag_assignments_delete ON ticket_tag_assignments;
CREATE POLICY tag_assignments_select ON ticket_tag_assignments FOR SELECT TO authenticated USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY tag_assignments_insert ON ticket_tag_assignments FOR INSERT TO authenticated WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY tag_assignments_delete ON ticket_tag_assignments FOR DELETE TO authenticated USING (public.can_write_team(public.ticket_team(ticket_id)));

DROP POLICY IF EXISTS deadlines_select_all ON ticket_deadlines;
DROP POLICY IF EXISTS deadlines_insert_any ON ticket_deadlines;
DROP POLICY IF EXISTS deadlines_update_any ON ticket_deadlines;
DROP POLICY IF EXISTS deadlines_delete_any ON ticket_deadlines;
CREATE POLICY deadlines_select ON ticket_deadlines FOR SELECT TO authenticated USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY deadlines_insert ON ticket_deadlines FOR INSERT TO authenticated WITH CHECK (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY deadlines_update ON ticket_deadlines FOR UPDATE TO authenticated USING (public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY deadlines_delete ON ticket_deadlines FOR DELETE TO authenticated USING (public.can_write_team(public.ticket_team(ticket_id)));

-- ========================================
-- 029_attachments_rename.sql
-- ========================================
-- 029: allow renaming attachments (file_name only) by the uploader or a team admin.
-- Needed for the "Yeniden adlandır" action in the Dosyalar section.

DROP POLICY IF EXISTS attachments_update ON ticket_attachments;
CREATE POLICY attachments_update ON ticket_attachments
  FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)))
  WITH CHECK (uploaded_by = auth.uid() OR public.is_team_admin(public.ticket_team(ticket_id)));

-- ========================================
-- 030_realtime_publication.sql
-- ========================================
-- 030: publish ticket-related tables over Supabase Realtime so open boards/modals
-- refresh when another tab, user or an external tool (psql) changes data.
-- RLS still applies: clients only receive rows they are allowed to SELECT.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tickets','ticket_subtasks','ticket_comments','ticket_attachments','ticket_assignees','ticket_deadlines']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Deletes must carry the ticket_id so clients know which ticket to refresh.
ALTER TABLE ticket_subtasks    REPLICA IDENTITY FULL;
ALTER TABLE ticket_comments    REPLICA IDENTITY FULL;
ALTER TABLE ticket_attachments REPLICA IDENTITY FULL;
ALTER TABLE ticket_assignees   REPLICA IDENTITY FULL;
ALTER TABLE ticket_deadlines   REPLICA IDENTITY FULL;

-- ========================================
-- 031_linked_subtasks.sql
-- ========================================
-- 031: a subtask row may point at an existing ticket ("linked subtask").
-- Cycles (A → B → … → A), self-links and cross-team links are rejected in a trigger.

ALTER TABLE ticket_subtasks
  ADD COLUMN IF NOT EXISTS linked_ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ticket_subtasks_linked_ticket_id_idx ON ticket_subtasks(linked_ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_subtasks_unique_link ON ticket_subtasks(ticket_id, linked_ticket_id)
  WHERE linked_ticket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_subtask_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.linked_ticket_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.linked_ticket_id = NEW.ticket_id THEN
    RAISE EXCEPTION 'Bir ticket kendisine bağlanamaz' USING ERRCODE = 'check_violation';
  END IF;

  IF public.ticket_team(NEW.linked_ticket_id) IS DISTINCT FROM public.ticket_team(NEW.ticket_id) THEN
    RAISE EXCEPTION 'Yalnızca aynı takımdaki ticketlar bağlanabilir' USING ERRCODE = 'check_violation';
  END IF;

  -- Cycle check: walking DOWN from the target ticket through linked subtasks must never reach the parent.
  IF EXISTS (
    WITH RECURSIVE down AS (
      SELECT s.linked_ticket_id AS id, 1 AS depth
      FROM ticket_subtasks s
      WHERE s.ticket_id = NEW.linked_ticket_id AND s.linked_ticket_id IS NOT NULL
      UNION
      SELECT s.linked_ticket_id, d.depth + 1
      FROM ticket_subtasks s JOIN down d ON s.ticket_id = d.id
      WHERE s.linked_ticket_id IS NOT NULL AND d.depth < 50
    )
    SELECT 1 FROM down WHERE id = NEW.ticket_id
  ) THEN
    RAISE EXCEPTION 'Döngü oluşur: hedef ticket zaten bu ticketı (dolaylı olarak) alt görev olarak içeriyor' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ticket_subtasks_check_link ON ticket_subtasks;
CREATE TRIGGER ticket_subtasks_check_link
  BEFORE INSERT OR UPDATE OF linked_ticket_id, ticket_id ON ticket_subtasks
  FOR EACH ROW EXECUTE FUNCTION public.check_subtask_link();

-- ========================================
-- 032_profile_avatar_full.sql
-- ========================================
-- 032: avatars are stored twice — a small WebP (avatar_url, ~256px, used everywhere)
-- and a bounded "full" copy (avatar_full_url, ≤1024px) for the detail view.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_full_url TEXT;

-- ========================================
-- 033_task_model_categories_parent.sql
-- ========================================
-- 033: one task model (ClickUp-like)
--  * ticket_statuses.category (backlog | active | blocked | done | closed) + is_cancelled
--  * tickets.parent_id — a "subtask" is simply a ticket with a parent (depth ≤ 3, same list, no cycles)
--  * ticket_links — "linked ticket" rows (formerly ticket_subtasks.linked_ticket_id)
--  * data migration: ticket_subtasks → tickets (same ids), then the old table is kept as *_legacy

-- ─── 1. status categories ──────────────────────────────────────────────────
ALTER TABLE ticket_statuses
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'active'
    CHECK (category IN ('backlog', 'active', 'blocked', 'done', 'closed')),
  ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT false;

-- best-effort classification of existing statuses by name
UPDATE ticket_statuses SET category = 'closed'  WHERE lower(name) ~ '(kapat|closed|iptal|cancel)';
UPDATE ticket_statuses SET is_cancelled = true  WHERE lower(name) ~ '(iptal|cancel)';
UPDATE ticket_statuses SET category = 'done'    WHERE category = 'active' AND lower(name) ~ '(tamamlan|done|bitti|complete)';
UPDATE ticket_statuses SET category = 'backlog' WHERE category = 'active' AND lower(name) ~ '(backlog|yapılacak|yapilacak|to ?do|başlanmadı|baslanmadi)';
UPDATE ticket_statuses SET category = 'blocked' WHERE category = 'active' AND lower(name) ~ '(bloke|blocked|beklemede|engel)';
-- every list needs a closed status: promote the last "done" one, else append "Kapatıldı"
UPDATE ticket_statuses s SET category = 'closed'
WHERE s.category = 'done'
  AND NOT EXISTS (SELECT 1 FROM ticket_statuses c WHERE c.project_id = s.project_id AND c.category = 'closed')
  AND s.order_index = (SELECT max(order_index) FROM ticket_statuses d WHERE d.project_id = s.project_id AND d.category = 'done');
INSERT INTO ticket_statuses (project_id, name, color, order_index, category)
SELECT p.id, 'Kapatıldı', '#6b7280', coalesce((SELECT max(order_index) FROM ticket_statuses x WHERE x.project_id = p.id), -1) + 1, 'closed'
FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM ticket_statuses c WHERE c.project_id = p.id AND c.category = 'closed');

-- ─── 2. parent_id ───────────────────────────────────────────────────────────
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tickets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS tickets_parent_id_idx ON tickets(parent_id);

CREATE OR REPLACE FUNCTION public.check_ticket_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur UUID := NEW.parent_id;
  depth INT := 0;
  parent_project UUID;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Bir görev kendi alt görevi olamaz' USING ERRCODE = 'check_violation';
  END IF;
  SELECT project_id INTO parent_project FROM tickets WHERE id = NEW.parent_id;
  IF parent_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'Alt görev üst göreviyle aynı listede olmalı' USING ERRCODE = 'check_violation';
  END IF;
  -- walk up: no cycle, and total depth (ancestors) must stay ≤ 2 (3 levels)
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Döngü oluşur: hedef görev zaten bu görevin altında' USING ERRCODE = 'check_violation';
    END IF;
    depth := depth + 1;
    IF depth > 2 THEN
      RAISE EXCEPTION 'En fazla 3 seviye alt görev olabilir' USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_id INTO cur FROM tickets WHERE id = cur;
  END LOOP;
  -- moving a ticket that already has descendants under a deeper parent could exceed 3 levels
  IF depth = 2 AND EXISTS (SELECT 1 FROM tickets c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'Bu görevin kendi alt görevleri var; 3 seviye sınırı aşılır' USING ERRCODE = 'check_violation';
  END IF;
  IF depth = 1 AND EXISTS (SELECT 1 FROM tickets c JOIN tickets g ON g.parent_id = c.id WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'Bu görevin altında iki seviye var; 3 seviye sınırı aşılır' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tickets_check_parent ON tickets;
CREATE TRIGGER tickets_check_parent
  BEFORE INSERT OR UPDATE OF parent_id, project_id ON tickets
  FOR EACH ROW EXECUTE FUNCTION public.check_ticket_parent();

-- ─── 3. ticket_links ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  linked_ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  order_index INT NOT NULL DEFAULT 0,
  UNIQUE (ticket_id, linked_ticket_id),
  CHECK (ticket_id <> linked_ticket_id)
);
CREATE INDEX IF NOT EXISTS ticket_links_linked_idx ON ticket_links(linked_ticket_id);
ALTER TABLE ticket_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS links_select ON ticket_links;
DROP POLICY IF EXISTS links_insert ON ticket_links;
DROP POLICY IF EXISTS links_delete ON ticket_links;
CREATE POLICY links_select ON ticket_links FOR SELECT TO authenticated USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);
CREATE POLICY links_insert ON ticket_links FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND public.can_write_team(public.ticket_team(ticket_id)));
CREATE POLICY links_delete ON ticket_links FOR DELETE TO authenticated USING (public.can_write_team(public.ticket_team(ticket_id)));

CREATE OR REPLACE FUNCTION public.check_ticket_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.ticket_team(NEW.linked_ticket_id) IS DISTINCT FROM public.ticket_team(NEW.ticket_id) THEN
    RAISE EXCEPTION 'Yalnızca aynı takımdaki görevler bağlanabilir' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    WITH RECURSIVE down AS (
      SELECT l.linked_ticket_id AS id, 1 AS depth FROM ticket_links l WHERE l.ticket_id = NEW.linked_ticket_id
      UNION
      SELECT l.linked_ticket_id, d.depth + 1 FROM ticket_links l JOIN down d ON l.ticket_id = d.id WHERE d.depth < 50
    ) SELECT 1 FROM down WHERE id = NEW.ticket_id
  ) THEN
    RAISE EXCEPTION 'Döngü oluşur: hedef görev zaten bu görevi (dolaylı olarak) bağlıyor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ticket_links_check ON ticket_links;
CREATE TRIGGER ticket_links_check BEFORE INSERT OR UPDATE ON ticket_links FOR EACH ROW EXECUTE FUNCTION public.check_ticket_link();

-- ─── 4. data migration: ticket_subtasks → tickets ──────────────────────────
DO $$
BEGIN
  IF to_regclass('public.ticket_subtasks') IS NOT NULL THEN
    -- plain subtasks become child tickets with the SAME id (links, image paths keep working)
    INSERT INTO tickets (id, title, description, status, status_id, project_id, parent_id, priority, due_date,
                         created_by, updated_by, created_at, updated_at, order_index)
    SELECT s.id, s.title, s.description, st.name, st.id, p.project_id, s.ticket_id,
           CASE WHEN s.priority IN ('low','medium','high','critical') THEN s.priority::ticket_priority ELSE NULL END,
           s.due_date, s.created_by, s.created_by, s.created_at, s.created_at, s.order_index
    FROM ticket_subtasks s
    JOIN tickets p ON p.id = s.ticket_id
    CROSS JOIN LATERAL (
      SELECT x.id, x.name FROM ticket_statuses x
      WHERE x.project_id = p.project_id
      ORDER BY
        CASE
          WHEN s.is_done AND x.category = 'closed' AND NOT x.is_cancelled THEN 0
          WHEN s.is_done AND x.category = 'done' THEN 1
          WHEN NOT s.is_done AND x.category = 'backlog' THEN 0
          WHEN NOT s.is_done AND x.category = 'active' THEN 1
          ELSE 9
        END,
        x.order_index
      LIMIT 1
    ) st
    WHERE s.linked_ticket_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id = s.id);

    -- linked rows become ticket_links
    INSERT INTO ticket_links (ticket_id, linked_ticket_id, created_by, created_at, order_index)
    SELECT s.ticket_id, s.linked_ticket_id, s.created_by, s.created_at, s.order_index
    FROM ticket_subtasks s WHERE s.linked_ticket_id IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- keep the old table around (read-only backup) for one release
    ALTER TABLE ticket_subtasks RENAME TO ticket_subtasks_legacy;
    BEGIN
      ALTER PUBLICATION supabase_realtime DROP TABLE ticket_subtasks_legacy;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

-- realtime for links
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'ticket_links') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_links;
  END IF;
END $$;
ALTER TABLE ticket_links REPLICA IDENTITY FULL;

-- ========================================
-- 034_import_bundle.sql
-- ========================================
-- 034: import_bundle(p_bundle, p_mode, p_target_team) — restore / merge / copy a Fira backup bundle (schema v1)
-- in ONE transaction. Only team admins/owners may import; users are mapped by e-mail, unknown users fall back
-- to the importer. Modes:
--   restore : same ids, existing rows are updated (disaster recovery)
--   skip    : same ids, only missing rows are inserted
--   copy    : every id is regenerated; data goes into p_target_team (must be admin) or a new team

-- plpgsql (not sql): bodies must not be validated at creation — the temp tables only exist inside import_bundle()
CREATE OR REPLACE FUNCTION public.imp_id(p uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_temp, public AS $$
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  RETURN coalesce((SELECT new FROM _ids WHERE old = p), p);
END $$;

CREATE OR REPLACE FUNCTION public.imp_user(p uuid, p_default uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_temp, public AS $$
BEGIN
  RETURN coalesce((SELECT new FROM _users WHERE old = p), p_default);
END $$;

CREATE OR REPLACE FUNCTION public.import_bundle(p_bundle jsonb, p_mode text, p_target_team uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := auth.uid();
  v_bundle_team uuid;
  v_team uuid;
  v_counts jsonb := '{}'::jsonb;
  v_unmapped text[];
  n int;
  has_owner boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Oturum yok'; END IF;
  IF p_mode NOT IN ('restore', 'skip', 'copy') THEN RAISE EXCEPTION 'Geçersiz mod: %', p_mode; END IF;
  IF coalesce((p_bundle->>'schema_version')::int, 0) <> 1 THEN RAISE EXCEPTION 'Desteklenmeyen yedek şeması (v%)', p_bundle->>'schema_version'; END IF;
  v_bundle_team := (p_bundle->'team'->>'id')::uuid;

  CREATE TEMP TABLE _ids (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE _users (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP;

  -- users by e-mail
  INSERT INTO _users
  SELECT (p->>'id')::uuid, pr.id
  FROM jsonb_array_elements(coalesce(p_bundle->'profiles', '[]')) p
  JOIN profiles pr ON lower(pr.email) = lower(p->>'email')
  ON CONFLICT DO NOTHING;
  SELECT coalesce(array_agg(p->>'email'), '{}') INTO v_unmapped
  FROM jsonb_array_elements(coalesce(p_bundle->'profiles', '[]')) p
  WHERE NOT EXISTS (SELECT 1 FROM _users u WHERE u.old = (p->>'id')::uuid);

  -- entity ids
  INSERT INTO _ids
  SELECT (e->>'id')::uuid, CASE WHEN p_mode = 'copy' THEN gen_random_uuid() ELSE (e->>'id')::uuid END
  FROM (
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'team_colors', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'team_folders', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'projects', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_statuses', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'tags', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_comments', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_attachments', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_deadlines', '[]')) e UNION ALL
    SELECT e FROM jsonb_array_elements(coalesce(p_bundle->'ticket_links', '[]')) e
  ) x
  WHERE e ? 'id'
  ON CONFLICT DO NOTHING;

  -- ── team ────────────────────────────────────────────────────────────────
  IF p_mode = 'copy' THEN
    IF p_target_team IS NOT NULL THEN
      IF NOT public.is_team_admin(p_target_team) THEN RAISE EXCEPTION 'Hedef takımda yönetici değilsiniz'; END IF;
      v_team := p_target_team;
    ELSE
      v_team := gen_random_uuid();
      INSERT INTO teams (id, name, code, created_by)
      VALUES (v_team, (p_bundle->'team'->>'name') || ' (kopya)', upper(substr(md5(random()::text), 1, 8)), me);
      INSERT INTO team_members (team_id, user_id, role) VALUES (v_team, me, 'owner') ON CONFLICT DO NOTHING; -- a teams trigger may already add the creator
    END IF;
  ELSE
    v_team := v_bundle_team;
    IF EXISTS (SELECT 1 FROM teams WHERE id = v_team) THEN
      IF NOT public.is_team_admin(v_team) THEN RAISE EXCEPTION 'Bu takımda yönetici değilsiniz'; END IF;
      IF p_mode = 'restore' THEN
        UPDATE teams SET name = p_bundle->'team'->>'name' WHERE id = v_team;
      END IF;
    ELSE
      INSERT INTO teams (id, name, code, created_by, created_at)
      VALUES (v_team, p_bundle->'team'->>'name', coalesce(p_bundle->'team'->>'code', upper(substr(md5(random()::text), 1, 8))), me, coalesce((p_bundle->'team'->>'created_at')::timestamptz, now()));
      INSERT INTO team_members (team_id, user_id, role) VALUES (v_team, me, 'owner') ON CONFLICT DO NOTHING; -- a teams trigger may already add the creator
    END IF;
  END IF;
  INSERT INTO _ids VALUES (v_bundle_team, v_team) ON CONFLICT (old) DO UPDATE SET new = EXCLUDED.new;

  -- ── members (only users that exist here; never demote/replace the owner) ──
  SELECT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_team AND role = 'owner') INTO has_owner;
  INSERT INTO team_members (team_id, user_id, role, joined_at)
  SELECT v_team, u.new,
         CASE WHEN m->>'role' = 'owner' AND has_owner THEN 'admin' ELSE coalesce(m->>'role', 'member') END,
         coalesce((m->>'joined_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'members', '[]')) m
  JOIN _users u ON u.old = (m->>'user_id')::uuid
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('members', n);

  -- ── colours ───────────────────────────────────────────────────────────
  INSERT INTO team_colors (id, team_id, name, hex, order_index, created_at)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', e->>'hex', coalesce((e->>'order_index')::int, 0), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'team_colors', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, hex = EXCLUDED.hex, order_index = EXCLUDED.order_index
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('team_colors', n);

  -- ── folders ───────────────────────────────────────────────────────────
  INSERT INTO team_folders (id, team_id, name, color_id, order_index, created_by, created_at)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', imp_id((e->>'color_id')::uuid), coalesce((e->>'order_index')::int, 0), imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'team_folders', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color_id = EXCLUDED.color_id, order_index = EXCLUDED.order_index
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('team_folders', n);

  -- ── lists (projects) ──────────────────────────────────────────────────
  INSERT INTO projects (id, team_id, name, description, created_by, created_at, archived, folder_id, icon, icon_url, color_id, order_index)
  SELECT imp_id((e->>'id')::uuid), v_team, e->>'name', e->>'description', imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()),
         coalesce((e->>'archived')::boolean, false), imp_id((e->>'folder_id')::uuid), e->>'icon', e->>'icon_url', imp_id((e->>'color_id')::uuid), coalesce((e->>'order_index')::int, 0)
  FROM jsonb_array_elements(coalesce(p_bundle->'projects', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, archived = EXCLUDED.archived, folder_id = EXCLUDED.folder_id,
    icon = EXCLUDED.icon, icon_url = EXCLUDED.icon_url, color_id = EXCLUDED.color_id, order_index = EXCLUDED.order_index
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('projects', n);

  -- ── statuses ──────────────────────────────────────────────────────────
  INSERT INTO ticket_statuses (id, project_id, name, color, order_index, category, is_cancelled)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'project_id')::uuid), e->>'name', coalesce(e->>'color', '#6b7280'), coalesce((e->>'order_index')::int, 0),
         coalesce(e->>'category', 'active'), coalesce((e->>'is_cancelled')::boolean, false)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_statuses', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, order_index = EXCLUDED.order_index, category = EXCLUDED.category, is_cancelled = EXCLUDED.is_cancelled
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_statuses', n);

  -- ── tags ──────────────────────────────────────────────────────────────
  INSERT INTO tags (id, project_id, name, color, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'project_id')::uuid), e->>'name', coalesce(e->>'color', '#6b7280'), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'tags', '[]')) e
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tags', n);

  -- ── tickets (parents first: insert everything without parent_id, then link) ──
  INSERT INTO tickets (id, title, description, status, status_id, priority, assignee_id, due_date, created_by, created_at, updated_at, order_index, project_id, updated_by, archived_at, parent_id)
  SELECT imp_id((e->>'id')::uuid), e->>'title', e->>'description', coalesce(e->>'status', 'todo'), imp_id((e->>'status_id')::uuid),
         CASE WHEN e->>'priority' IN ('low','medium','high','critical') THEN (e->>'priority')::ticket_priority ELSE NULL END,
         (SELECT new FROM _users WHERE old = (e->>'assignee_id')::uuid), (e->>'due_date')::date,
         imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()), coalesce((e->>'updated_at')::timestamptz, now()),
         coalesce((e->>'order_index')::int, 0), imp_id((e->>'project_id')::uuid), (SELECT new FROM _users WHERE old = (e->>'updated_by')::uuid),
         (e->>'archived_at')::timestamptz, NULL
  FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, status_id = EXCLUDED.status_id,
    priority = EXCLUDED.priority, due_date = EXCLUDED.due_date, updated_at = EXCLUDED.updated_at, order_index = EXCLUDED.order_index,
    project_id = EXCLUDED.project_id, archived_at = EXCLUDED.archived_at
  WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tickets', n);

  UPDATE tickets t SET parent_id = imp_id((e->>'parent_id')::uuid)
  FROM jsonb_array_elements(coalesce(p_bundle->'tickets', '[]')) e
  WHERE t.id = imp_id((e->>'id')::uuid) AND e->>'parent_id' IS NOT NULL
    AND (p_mode <> 'skip' OR t.parent_id IS NULL)
    AND EXISTS (SELECT 1 FROM tickets p WHERE p.id = imp_id((e->>'parent_id')::uuid));

  -- ── assignees / tags / deadlines / comments / attachments / links ─────
  INSERT INTO ticket_assignees (ticket_id, user_id)
  SELECT imp_id((e->>'ticket_id')::uuid), u.new
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_assignees', '[]')) e JOIN _users u ON u.old = (e->>'user_id')::uuid
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_assignees', n);

  INSERT INTO ticket_tag_assignments (ticket_id, tag_id)
  SELECT imp_id((e->>'ticket_id')::uuid), imp_id((e->>'tag_id')::uuid)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_tag_assignments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid)) AND EXISTS (SELECT 1 FROM tags g WHERE g.id = imp_id((e->>'tag_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_tag_assignments', n);

  INSERT INTO ticket_deadlines (id, ticket_id, date, description, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), (e->>'date')::date, e->>'description', coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_deadlines', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, description = EXCLUDED.description WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_deadlines', n);

  INSERT INTO ticket_comments (id, ticket_id, author_id, content, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), imp_user((e->>'author_id')::uuid, me), e->>'content', coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_comments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_comments', n);

  INSERT INTO ticket_attachments (id, ticket_id, file_url, file_name, uploaded_by, created_at)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), e->>'file_url', e->>'file_name', imp_user((e->>'uploaded_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_attachments', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid))
  ON CONFLICT (id) DO UPDATE SET file_url = EXCLUDED.file_url, file_name = EXCLUDED.file_name WHERE p_mode = 'restore';
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_attachments', n);

  INSERT INTO ticket_links (id, ticket_id, linked_ticket_id, created_by, created_at, order_index)
  SELECT imp_id((e->>'id')::uuid), imp_id((e->>'ticket_id')::uuid), imp_id((e->>'linked_ticket_id')::uuid), imp_user((e->>'created_by')::uuid, me), coalesce((e->>'created_at')::timestamptz, now()), coalesce((e->>'order_index')::int, 0)
  FROM jsonb_array_elements(coalesce(p_bundle->'ticket_links', '[]')) e
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'ticket_id')::uuid)) AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = imp_id((e->>'linked_ticket_id')::uuid))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticket_links', n);

  RETURN jsonb_build_object(
    'mode', p_mode,
    'team_id', v_team,
    'counts', v_counts,
    'unmapped_users', to_jsonb(v_unmapped),
    'id_map', CASE WHEN p_mode = 'copy' THEN (SELECT coalesce(jsonb_object_agg(old, new), '{}') FROM _ids) ELSE '{}'::jsonb END
  );
END $$;

REVOKE ALL ON FUNCTION public.import_bundle(jsonb, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.import_bundle(jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.imp_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.imp_user(uuid, uuid) TO authenticated;

-- ========================================
-- 035_user_preferences.sql
-- ========================================
-- 035: per-user preferences stored server-side (view mode, filters, last list …), forward compatible.
--  scope: 'global' | 'list:<project_id>' | (future) 'team:<team_id>'
--  merge_user_prefs(scope, patch): prefs = prefs || patch, nested objects (e.g. "filters") are merged key by key,
--  null values delete keys. A client running an OLDER app version therefore never wipes keys it does not know.

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prefs_select ON user_preferences;
DROP POLICY IF EXISTS prefs_insert ON user_preferences;
DROP POLICY IF EXISTS prefs_update ON user_preferences;
DROP POLICY IF EXISTS prefs_delete ON user_preferences;
CREATE POLICY prefs_select ON user_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY prefs_insert ON user_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY prefs_update ON user_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY prefs_delete ON user_preferences FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Deep-ish merge: one level of nested objects is merged key by key; nulls remove keys at both levels.
CREATE OR REPLACE FUNCTION public.merge_user_prefs(p_scope TEXT, p_patch JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  cur JSONB;
  merged JSONB;
  k TEXT;
  v JSONB;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Oturum yok'; END IF;
  IF p_scope IS NULL OR length(p_scope) > 120 THEN RAISE EXCEPTION 'Geçersiz scope'; END IF;
  SELECT prefs INTO cur FROM user_preferences WHERE user_id = me AND scope = p_scope;
  merged := coalesce(cur, '{}'::jsonb);
  FOR k, v IN SELECT * FROM jsonb_each(coalesce(p_patch, '{}'::jsonb)) LOOP
    IF jsonb_typeof(v) = 'object' AND jsonb_typeof(merged->k) = 'object' THEN
      merged := jsonb_set(merged, ARRAY[k], jsonb_strip_nulls((merged->k) || v));
    ELSIF jsonb_typeof(v) = 'null' THEN
      merged := merged - k;
    ELSE
      merged := jsonb_set(merged, ARRAY[k], CASE WHEN jsonb_typeof(v) = 'object' THEN jsonb_strip_nulls(v) ELSE v END);
    END IF;
  END LOOP;
  INSERT INTO user_preferences (user_id, scope, prefs, updated_at) VALUES (me, p_scope, merged, now())
  ON CONFLICT (user_id, scope) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now();
  RETURN merged;
END $$;
GRANT EXECUTE ON FUNCTION public.merge_user_prefs(TEXT, JSONB) TO authenticated;

-- ========================================
-- 036_admin.sql
-- ========================================
-- 036: system admin role + admin page backend
--  profiles.is_admin (set only via SQL), is_system_admin()
--  system_status   — server collector writes a JSON report every 5 min (disk, containers, backups, versions)
--  system_settings — announcement / maintenance flags (readable by everyone, writable by admins)
--  deploy_log      — one row per deploy (written by the deploy step)
--  admin_audit     — who did what in the admin page
--  admin_* RPCs    — overview, metrics, users, ban, purge, orphan files, auth log

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE profiles SET is_admin = true WHERE id IN ('9007cb38-0ef3-4a96-9a5b-14d1e8ba7c63', 'b7b4c570-4b45-492e-9e02-5970c88ee48c');

CREATE OR REPLACE FUNCTION public.is_system_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_admin FROM profiles WHERE id = auth.uid()), false)
$$;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;

-- ── tables ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_status (
  id BIGSERIAL PRIMARY KEY,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL
);
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_status_admin ON system_status;
CREATE POLICY system_status_admin ON system_status FOR SELECT TO authenticated USING (public.is_system_admin());

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_read ON system_settings;
DROP POLICY IF EXISTS settings_write ON system_settings;
CREATE POLICY settings_read ON system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY settings_write ON system_settings FOR ALL TO authenticated USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

CREATE TABLE IF NOT EXISTS deploy_log (
  id BIGSERIAL PRIMARY KEY,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version TEXT,
  bundle TEXT,
  note TEXT
);
ALTER TABLE deploy_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deploy_log_admin ON deploy_log;
CREATE POLICY deploy_log_admin ON deploy_log FOR SELECT TO authenticated USING (public.is_system_admin());

CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  details JSONB
);
ALTER TABLE admin_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_audit_admin ON admin_audit;
CREATE POLICY admin_audit_admin ON admin_audit FOR SELECT TO authenticated USING (public.is_system_admin());

-- admins may delete any storage object (orphan cleanup)
DROP POLICY IF EXISTS storage_delete_admin ON storage.objects;
CREATE POLICY storage_delete_admin ON storage.objects FOR DELETE TO authenticated USING (public.is_system_admin());

-- realtime for settings (announcement / maintenance reach clients live)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'system_settings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_settings;
  END IF;
END $$;

-- ── helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_guard() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_system_admin() THEN RAISE EXCEPTION 'Yalnızca sistem yöneticisi' USING ERRCODE = 'insufficient_privilege'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_log(p_action TEXT, p_target TEXT, p_details JSONB DEFAULT NULL) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO admin_audit (actor, action, target, details) VALUES (auth.uid(), p_action, p_target, p_details)
$$;

-- ── overview ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'teams', (SELECT count(*) FROM teams),
    'lists', (SELECT count(*) FROM projects),
    'users', (SELECT count(*) FROM profiles),
    'tickets', (SELECT count(*) FROM tickets WHERE parent_id IS NULL),
    'subtasks', (SELECT count(*) FROM tickets WHERE parent_id IS NOT NULL),
    'open_tickets', (SELECT count(*) FROM tickets t LEFT JOIN ticket_statuses s ON s.id = t.status_id WHERE t.archived_at IS NULL AND coalesce(s.category, 'active') NOT IN ('closed', 'done')),
    'comments', (SELECT count(*) FROM ticket_comments),
    'attachments', (SELECT count(*) FROM ticket_attachments),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'storage_bytes', (SELECT coalesce(sum((metadata->>'size')::bigint), 0) FROM storage.objects),
    'db_bytes', pg_database_size(current_database()),
    'active_users_7d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '7 days'),
    'active_users_30d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '30 days'),
    'pg_version', current_setting('server_version'),
    'last_status', (SELECT jsonb_build_object('collected_at', collected_at, 'payload', payload) FROM system_status ORDER BY collected_at DESC LIMIT 1),
    'last_deploy', (SELECT jsonb_build_object('deployed_at', deployed_at, 'version', version, 'bundle', bundle, 'note', note) FROM deploy_log ORDER BY deployed_at DESC LIMIT 1),
    'settings', (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM system_settings),
    'realtime_tables', (SELECT coalesce(jsonb_agg(tablename ORDER BY tablename), '[]'::jsonb) FROM pg_publication_tables WHERE pubname = 'supabase_realtime'),
    'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit)), '[]'::jsonb) FROM storage.buckets)
  ) INTO r;
  RETURN r;
END $$;

-- ── metrics ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_metrics(p_days INT DEFAULT 30) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB; since TIMESTAMPTZ := now() - (greatest(p_days, 1) || ' days')::interval;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'days', p_days,
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'created', c.n, 'closed', cl.n, 'comments', cm.n, 'logins', lg.n) ORDER BY d), '[]'::jsonb)
      FROM generate_series(date_trunc('day', since), date_trunc('day', now()), interval '1 day') d
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t WHERE date_trunc('day', t.created_at) = d) c ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id WHERE s.category IN ('closed','done') AND date_trunc('day', t.updated_at) = d) cl ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM ticket_comments x WHERE date_trunc('day', x.created_at) = d) cm ON true
      LEFT JOIN LATERAL (SELECT count(*) n FROM auth.audit_log_entries a WHERE a.payload->>'action' = 'login' AND date_trunc('day', a.created_at) = d) lg ON true
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

-- ── users & teams ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_users() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'email', p.email, 'full_name', p.full_name, 'is_admin', p.is_admin, 'avatar_url', p.avatar_url,
    'created_at', p.created_at, 'last_sign_in_at', u.last_sign_in_at, 'banned_until', u.banned_until,
    'teams', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', m.role)), '[]'::jsonb) FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = p.id)
  ) ORDER BY u.last_sign_in_at DESC NULLS LAST), '[]'::jsonb)
  INTO r FROM profiles p LEFT JOIN auth.users u ON u.id = p.id;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_teams() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'created_at', t.created_at,
    'owner', (SELECT p.email FROM team_members m JOIN profiles p ON p.id = m.user_id WHERE m.team_id = t.id AND m.role = 'owner' LIMIT 1),
    'members', (SELECT count(*) FROM team_members m WHERE m.team_id = t.id),
    'lists', (SELECT count(*) FROM projects p WHERE p.team_id = t.id),
    'tickets', (SELECT count(*) FROM tickets x JOIN projects p ON p.id = x.project_id WHERE p.team_id = t.id),
    'pending_invites', (SELECT count(*) FROM team_invitations i WHERE i.team_id = t.id AND i.status = 'pending')
  ) ORDER BY t.created_at), '[]'::jsonb) INTO r FROM teams t;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_admin(p_user UUID, p_admin BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_guard();
  IF p_user = auth.uid() AND NOT p_admin THEN RAISE EXCEPTION 'Kendi yönetici yetkinizi kaldıramazsınız'; END IF;
  UPDATE profiles SET is_admin = p_admin WHERE id = p_user;
  PERFORM public.admin_log('set_admin', p_user::text, jsonb_build_object('is_admin', p_admin));
END $$;

CREATE OR REPLACE FUNCTION public.admin_ban_user(p_user UUID, p_until TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_guard();
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'Kendinizi devre dışı bırakamazsınız'; END IF;
  UPDATE auth.users SET banned_until = p_until WHERE id = p_user;
  IF p_until IS NOT NULL THEN DELETE FROM auth.sessions WHERE user_id = p_user; END IF;
  PERFORM public.admin_log(CASE WHEN p_until IS NULL THEN 'unban_user' ELSE 'ban_user' END, p_user::text, jsonb_build_object('until', p_until));
END $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_sessions(p_user UUID) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  PERFORM public.admin_guard();
  DELETE FROM auth.sessions WHERE user_id = p_user;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.admin_log('revoke_sessions', p_user::text, jsonb_build_object('count', n));
  RETURN n;
END $$;

-- ── tools ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_purge_archived(p_days INT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  PERFORM public.admin_guard();
  DELETE FROM tickets WHERE archived_at IS NOT NULL AND archived_at < now() - (greatest(p_days, 1) || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.admin_log('purge_archived', NULL, jsonb_build_object('days', p_days, 'deleted', n));
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.admin_orphan_files() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'bucket', o.bucket_id, 'size', (o.metadata->>'size')::bigint, 'created_at', o.created_at) ORDER BY o.created_at), '[]'::jsonb)
  INTO r
  FROM storage.objects o
  WHERE o.bucket_id = 'ticket-attachments'
    AND o.name NOT LIKE '%/'  -- folders
    AND NOT EXISTS (SELECT 1 FROM ticket_attachments a WHERE a.file_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.icon_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.avatar_url LIKE '%/' || o.name || '%' OR p.avatar_full_url LIKE '%/' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.description LIKE '%' || o.name || '%')
    AND NOT EXISTS (SELECT 1 FROM ticket_comments c WHERE c.content LIKE '%' || o.name || '%');
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_largest_files(p_limit INT DEFAULT 20) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('name', o.name, 'size', (o.metadata->>'size')::bigint, 'created_at', o.created_at) x
    FROM storage.objects o WHERE o.bucket_id = 'ticket-attachments' ORDER BY (o.metadata->>'size')::bigint DESC NULLS LAST LIMIT p_limit
  ) q;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_auth_log(p_limit INT DEFAULT 200) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('at', a.created_at, 'action', a.payload->>'action', 'actor', coalesce(a.payload->>'actor_username', a.payload->>'actor_id'), 'ip', a.ip_address, 'traits', a.payload->'traits') x
    FROM auth.audit_log_entries a ORDER BY a.created_at DESC LIMIT p_limit
  ) q;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_audit_log(p_limit INT DEFAULT 200) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('at', l.at, 'actor', p.email, 'action', l.action, 'target', l.target, 'details', l.details) x
    FROM admin_audit l LEFT JOIN profiles p ON p.id = l.actor ORDER BY l.at DESC LIMIT p_limit
  ) q;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_setting(p_key TEXT, p_value JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_guard();
  INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES (p_key, coalesce(p_value, '{}'::jsonb), now(), auth.uid())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
  PERFORM public.admin_log('set_setting', p_key, p_value);
END $$;

CREATE OR REPLACE FUNCTION public.admin_status_history(p_hours INT DEFAULT 24) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(jsonb_build_object('collected_at', collected_at, 'payload', payload) ORDER BY collected_at), '[]'::jsonb)
  INTO r FROM system_status WHERE collected_at > now() - (greatest(p_hours, 1) || ' hours')::interval;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_deploys(p_limit INT DEFAULT 30) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  PERFORM public.admin_guard();
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('deployed_at', deployed_at, 'version', version, 'bundle', bundle, 'note', note) x FROM deploy_log ORDER BY deployed_at DESC LIMIT p_limit
  ) q;
  RETURN r;
END $$;

DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY['admin_overview()', 'admin_metrics(int)', 'admin_users()', 'admin_teams()', 'admin_set_admin(uuid,boolean)', 'admin_ban_user(uuid,timestamptz)',
    'admin_revoke_sessions(uuid)', 'admin_purge_archived(int)', 'admin_orphan_files()', 'admin_largest_files(int)', 'admin_auth_log(int)', 'admin_audit_log(int)',
    'admin_set_setting(text,jsonb)', 'admin_status_history(int)', 'admin_deploys(int)', 'admin_log(text,text,jsonb)', 'admin_guard()']
  LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f); END LOOP;
END $$;

-- ========================================
-- 037_transfer_ownership.sql
-- ========================================
-- 037: transfer team ownership (only the current owner; target must already be a member). Old owner becomes admin.
CREATE OR REPLACE FUNCTION public.transfer_team_ownership(p_team UUID, p_user UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Oturum yok'; END IF;
  IF public.team_role(p_team) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Yalnızca takım sahibi devredebilir' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_user = me THEN RAISE EXCEPTION 'Zaten sahipsiniz'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = p_team AND user_id = p_user) THEN RAISE EXCEPTION 'Hedef kişi bu takımın üyesi değil'; END IF;
  UPDATE team_members SET role = 'admin' WHERE team_id = p_team AND user_id = me;
  UPDATE team_members SET role = 'owner' WHERE team_id = p_team AND user_id = p_user;
END $$;
GRANT EXECUTE ON FUNCTION public.transfer_team_ownership(UUID, UUID) TO authenticated;

-- ========================================
-- 038_ticket_activity.sql
-- ========================================
-- 038 — Görev aktivite günlüğü
--
-- Şimdiye kadar yalnızca "kim oluşturdu / kim en son değiştirdi" tutuluyordu; ne
-- değiştiği kayıtlı değildi. Bu migration her değişikliği tetikleyicilerle
-- (trigger) yazar: durum geçişleri, öncelik, başlık, açıklama, bitiş tarihi,
-- arşiv, üst görev, atamalar, etiketler, ekler, son tarihler, bağlantılar,
-- yorumlar ve alt görev ekleme/silme.
--
-- Neden trigger: kayıt istemciden bağımsız olur (içe aktarma, psql, ileride API)
-- ve hiçbir istemci "loglamayı unutamaz". Değerler o anki *adlarıyla* saklanır,
-- böylece durum yeniden adlandırılsa/silinse bile geçmiş okunabilir kalır.

CREATE TABLE IF NOT EXISTS public.ticket_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind        text NOT NULL,
  from_value  text,
  to_value    text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_activity_ticket_idx ON public.ticket_activity (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_activity_kind_idx ON public.ticket_activity (kind);

ALTER TABLE public.ticket_activity ENABLE ROW LEVEL SECURITY;

-- Görevi görebilen günlüğü de görür. Yazma yalnızca tetikleyicilerden (SECURITY
-- DEFINER) olur; istemcilere INSERT/UPDATE/DELETE politikası verilmez.
DROP POLICY IF EXISTS ticket_activity_select ON public.ticket_activity;
CREATE POLICY ticket_activity_select ON public.ticket_activity
  FOR SELECT TO authenticated
  USING (public.team_role(public.ticket_team(ticket_id)) IS NOT NULL);

GRANT SELECT ON public.ticket_activity TO authenticated;

-- ── Yardımcılar ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_actor() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT p.id FROM public.profiles p WHERE p.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.log_activity(
  p_ticket uuid, p_kind text, p_from text, p_to text, p_meta jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ticket IS NULL THEN RETURN; END IF;
  INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, from_value, to_value, meta)
  VALUES (p_ticket, COALESCE(p_actor, public.activity_actor()), p_kind, p_from, p_to, COALESCE(p_meta, '{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.status_name(p uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT name FROM public.ticket_statuses WHERE id = p
$$;

CREATE OR REPLACE FUNCTION public.person_name(p uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(full_name, ''), email) FROM public.profiles WHERE id = p
$$;

-- ── tickets ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tickets_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := COALESCE(public.activity_actor(), NEW.updated_by, NEW.created_by);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.id, 'created', NULL, NEW.title,
      jsonb_build_object('status', public.status_name(NEW.status_id)), COALESCE(public.activity_actor(), NEW.created_by));
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title,
        jsonb_build_object('child_id', NEW.id), COALESCE(public.activity_actor(), NEW.created_by));
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(OLD.parent_id, 'child_removed', OLD.title, NULL,
        jsonb_build_object('child_id', OLD.id), actor);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    PERFORM public.log_activity(NEW.id, 'status', public.status_name(OLD.status_id), public.status_name(NEW.status_id),
      jsonb_build_object('to_category', (SELECT category FROM public.ticket_statuses WHERE id = NEW.status_id),
                         'to_color', (SELECT color FROM public.ticket_statuses WHERE id = NEW.status_id)), actor);
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM public.log_activity(NEW.id, 'priority', OLD.priority::text, NEW.priority::text, '{}'::jsonb, actor);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    PERFORM public.log_activity(NEW.id, 'title', OLD.title, NEW.title, '{}'::jsonb, actor);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    -- Açıklamanın tamamı saklanmaz (yorum/eki büyütür); uzunluk farkı yeterli ipucu.
    PERFORM public.log_activity(NEW.id, 'description', NULL, NULL,
      jsonb_build_object('from_len', length(COALESCE(OLD.description, '')), 'to_len', length(COALESCE(NEW.description, ''))), actor);
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    PERFORM public.log_activity(NEW.id, 'due_date', OLD.due_date::text, NEW.due_date::text, '{}'::jsonb, actor);
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM public.log_activity(NEW.id, CASE WHEN NEW.archived_at IS NULL THEN 'unarchived' ELSE 'archived' END, NULL, NULL, '{}'::jsonb, actor);
  END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM public.log_activity(NEW.id, 'parent',
      (SELECT title FROM public.tickets WHERE id = OLD.parent_id),
      (SELECT title FROM public.tickets WHERE id = NEW.parent_id), '{}'::jsonb, actor);
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(NEW.parent_id, 'child_added', NULL, NEW.title, jsonb_build_object('child_id', NEW.id), actor);
    END IF;
    IF OLD.parent_id IS NOT NULL THEN
      PERFORM public.log_activity(OLD.parent_id, 'child_removed', OLD.title, NULL, jsonb_build_object('child_id', OLD.id), actor);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tickets_activity_ins ON public.tickets;
CREATE TRIGGER tickets_activity_ins AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_activity();
DROP TRIGGER IF EXISTS tickets_activity_upd ON public.tickets;
CREATE TRIGGER tickets_activity_upd AFTER UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_activity();
DROP TRIGGER IF EXISTS tickets_activity_del ON public.tickets;
CREATE TRIGGER tickets_activity_del AFTER DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_activity();

-- ── Bağlı tablolar ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assignees_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'assignee_added', NULL, public.person_name(NEW.user_id), jsonb_build_object('user_id', NEW.user_id));
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'assignee_removed', public.person_name(OLD.user_id), NULL, jsonb_build_object('user_id', OLD.user_id));
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS assignees_activity ON public.ticket_assignees;
CREATE TRIGGER assignees_activity AFTER INSERT OR DELETE ON public.ticket_assignees
  FOR EACH ROW EXECUTE FUNCTION public.assignees_activity();

CREATE OR REPLACE FUNCTION public.tags_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'tag_added', NULL, (SELECT name FROM public.tags WHERE id = NEW.tag_id),
      jsonb_build_object('color', (SELECT color FROM public.tags WHERE id = NEW.tag_id)));
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'tag_removed', (SELECT name FROM public.tags WHERE id = OLD.tag_id), NULL, '{}'::jsonb);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS tags_activity ON public.ticket_tag_assignments;
CREATE TRIGGER tags_activity AFTER INSERT OR DELETE ON public.ticket_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tags_activity();

CREATE OR REPLACE FUNCTION public.attachments_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'attachment_added', NULL, NEW.file_name, '{}'::jsonb);
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'attachment_removed', OLD.file_name, NULL, '{}'::jsonb);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS attachments_activity ON public.ticket_attachments;
CREATE TRIGGER attachments_activity AFTER INSERT OR DELETE ON public.ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION public.attachments_activity();

CREATE OR REPLACE FUNCTION public.deadlines_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'deadline_added', NULL, NEW.date::text, jsonb_build_object('note', NEW.description));
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'deadline_removed', OLD.date::text, NULL, jsonb_build_object('note', OLD.description));
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS deadlines_activity ON public.ticket_deadlines;
CREATE TRIGGER deadlines_activity AFTER INSERT OR DELETE ON public.ticket_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.deadlines_activity();

CREATE OR REPLACE FUNCTION public.comments_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.ticket_id, 'comment_added', NULL, left(NEW.content, 120), '{}'::jsonb, NEW.author_id);
    RETURN NEW;
  END IF;
  PERFORM public.log_activity(OLD.ticket_id, 'comment_removed', left(OLD.content, 120), NULL, '{}'::jsonb);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS comments_activity ON public.ticket_comments;
CREATE TRIGGER comments_activity AFTER INSERT OR DELETE ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_activity();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_links') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.links_activity() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          PERFORM public.log_activity(NEW.ticket_id, 'link_added', NULL, (SELECT title FROM public.tickets WHERE id = NEW.linked_ticket_id), '{}'::jsonb);
          RETURN NEW;
        END IF;
        PERFORM public.log_activity(OLD.ticket_id, 'link_removed', (SELECT title FROM public.tickets WHERE id = OLD.linked_ticket_id), NULL, '{}'::jsonb);
        RETURN OLD;
      END $b$;
    $f$;
    DROP TRIGGER IF EXISTS links_activity ON public.ticket_links;
    CREATE TRIGGER links_activity AFTER INSERT OR DELETE ON public.ticket_links
      FOR EACH ROW EXECUTE FUNCTION public.links_activity();
  END IF;
END $$;

-- ── Geçmiş için tek seferlik doldurma ────────────────────────────────────────
-- Var olan görevlerin oluşturulma kaydı yazılır; ne zaman hangi duruma geçtikleri
-- kayıtlı olmadığı için o geçişler uydurulmaz (günlük bu migration'dan itibaren dolar).
INSERT INTO public.ticket_activity (ticket_id, actor_id, kind, to_value, meta, created_at)
SELECT t.id, t.created_by, 'created', t.title,
       jsonb_build_object('status', public.status_name(t.status_id), 'backfilled', true), t.created_at
FROM public.tickets t
WHERE NOT EXISTS (SELECT 1 FROM public.ticket_activity a WHERE a.ticket_id = t.id AND a.kind = 'created');

-- Realtime yayını (diğer sekmeler anında görsün)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ticket_activity'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_activity;
    END IF;
  END IF;
END $$;
