ALTER TABLE console_users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE oidc_login_attempts ADD COLUMN return_path varchar(16) NOT NULL DEFAULT '/'
  CHECK (return_path IN ('/', '/invite'));

CREATE TABLE organization_invitations (
  id varchar(128) PRIMARY KEY CHECK (id ~ '^inv_[A-Za-z0-9_-]{1,120}$'),
  organization_id varchar(128) NOT NULL REFERENCES organizations (id),
  email varchar(320) NOT NULL CHECK (email = lower(email) AND length(email) > 0),
  role varchar(16) NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  token_hash bytea UNIQUE NOT NULL CHECK (octet_length(token_hash) = 32),
  created_by varchar(128) NOT NULL REFERENCES console_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by varchar(128) REFERENCES console_users (id),
  CHECK (expires_at > created_at),
  CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX organization_invitations_pending_email_idx
  ON organization_invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX organization_invitations_list_idx ON organization_invitations (organization_id, id);

ALTER TABLE workspace_audit_log DROP CONSTRAINT workspace_audit_log_action_check;
ALTER TABLE workspace_audit_log ADD CHECK (action IN (
  'organization.created', 'project.created', 'api_key.created', 'api_key.revoked',
  'invitation.created', 'invitation.revoked', 'invitation.accepted',
  'member.role_changed', 'member.removed'
));
ALTER TABLE workspace_audit_log DROP CONSTRAINT workspace_audit_log_resource_id_check;
ALTER TABLE workspace_audit_log ADD CHECK (resource_id ~ '^(org|prj|key|inv|usr)_[A-Za-z0-9_-]{1,120}$');
ALTER TABLE workspace_audit_log ADD COLUMN previous_role varchar(16)
  CHECK (previous_role IN ('owner', 'admin', 'member', 'viewer'));
ALTER TABLE workspace_audit_log ADD COLUMN next_role varchar(16)
  CHECK (next_role IN ('owner', 'admin', 'member', 'viewer'));
