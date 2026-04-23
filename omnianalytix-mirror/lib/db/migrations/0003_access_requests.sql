-- Task #23: in-app access requests inbox.
--
-- Records requests from team members who hit an RBAC wall (e.g. a viewer
-- trying to approve a budget shift) so workspace admins can grant or
-- dismiss them from settings → Access requests.

CREATE TABLE IF NOT EXISTS access_requests (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  workspace_id INTEGER,
  requester_id INTEGER,
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  requester_role TEXT NOT NULL,
  action_label TEXT NOT NULL,
  action_context TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_by_id INTEGER,
  resolved_by_name TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_requests_org_id_idx ON access_requests(organization_id);
CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests(status);
