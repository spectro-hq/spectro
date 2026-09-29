CREATE TABLE IF NOT EXISTS console_users (
  id varchar(128) PRIMARY KEY CHECK (id ~ '^usr_[A-Za-z0-9_-]{1,120}$'),
  email varchar(320),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_identities (
  issuer text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  user_id varchar(128) NOT NULL REFERENCES console_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

CREATE INDEX IF NOT EXISTS external_identities_user_idx ON external_identities (user_id);

CREATE TABLE IF NOT EXISTS organizations (
  id varchar(128) PRIMARY KEY CHECK (id ~ '^org_[A-Za-z0-9_-]{1,120}$'),
  name varchar(120) NOT NULL CHECK (char_length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id varchar(128) NOT NULL REFERENCES organizations (id),
  user_id varchar(128) NOT NULL REFERENCES console_users (id),
  role varchar(16) NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
  ON organization_memberships (user_id, organization_id);

CREATE TABLE IF NOT EXISTS projects (
  id varchar(128) PRIMARY KEY CHECK (id ~ '^prj_[A-Za-z0-9_-]{1,120}$'),
  organization_id varchar(128) NOT NULL REFERENCES organizations (id),
  name varchar(120) NOT NULL CHECK (char_length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_organization_idx ON projects (organization_id);

CREATE TABLE IF NOT EXISTS project_environments (
  project_id varchar(128) NOT NULL REFERENCES projects (id),
  name varchar(64) NOT NULL CHECK (char_length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS console_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  user_id varchar(128) NOT NULL REFERENCES console_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS console_sessions_user_idx ON console_sessions (user_id, expires_at);
