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
