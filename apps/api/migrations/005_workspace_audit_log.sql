CREATE TABLE workspace_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id varchar(128) NOT NULL REFERENCES organizations (id),
  actor_id varchar(128) NOT NULL REFERENCES console_users (id),
  action varchar(32) NOT NULL CHECK (action IN (
    'organization.created', 'project.created', 'api_key.created', 'api_key.revoked'
  )),
  resource_id varchar(128) NOT NULL CHECK (resource_id ~ '^(org|prj|key)_[A-Za-z0-9_-]{1,120}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_audit_log_organization_idx ON workspace_audit_log (organization_id, id);
