-- 001: Create enums
CREATE TYPE ticket_status AS ENUM ('todo', 'in_progress', 'review', 'done');
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');
