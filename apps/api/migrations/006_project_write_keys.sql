CREATE TABLE project_write_keys (
  id varchar(128) PRIMARY KEY CHECK (id ~ '^key_[A-Za-z0-9_-]{1,120}$'),
  project_id varchar(128) NOT NULL,
  environment varchar(64) NOT NULL,
  label varchar(120) NOT NULL CHECK (char_length(trim(label)) > 0),
  verifier bytea NOT NULL UNIQUE CHECK (octet_length(verifier) = 32),
  key_hint varchar(64) NOT NULL,
  allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(allowed_origins) = 'array' AND jsonb_array_length(allowed_origins) <= 20),
  created_by varchar(128) NOT NULL REFERENCES console_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (project_id, environment)
    REFERENCES project_environments (project_id, name)
);

CREATE INDEX project_write_keys_active_scope_idx
  ON project_write_keys (project_id, environment, created_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE workspace_audit_log
  DROP CONSTRAINT workspace_audit_log_action_check,
  ADD CONSTRAINT workspace_audit_log_action_check
    CHECK (action IN (
      'organization.created', 'project.created', 'api_key.created', 'api_key.revoked'
    )),
  DROP CONSTRAINT workspace_audit_log_resource_id_check,
  ADD CONSTRAINT workspace_audit_log_resource_id_check
    CHECK (resource_id ~ '^(org|prj|key)_[A-Za-z0-9_-]{1,120}$');
