-- 012: Custom ticket statuses per project

CREATE TABLE ticket_statuses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6b7280',
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ticket_statuses_project_idx ON ticket_statuses(project_id);

-- Auto-create 4 default statuses when a project is created
CREATE OR REPLACE FUNCTION create_default_statuses() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ticket_statuses (project_id, name, color, order_index) VALUES
    (NEW.id, 'Yapılacak',      '#6b7280', 0),
    (NEW.id, 'Devam Ediyor',   '#3b82f6', 1),
    (NEW.id, 'İncelemede',     '#f59e0b', 2),
    (NEW.id, 'Tamamlandı',     '#10b981', 3);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_project_created
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION create_default_statuses();
