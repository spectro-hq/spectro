CREATE TABLE IF NOT EXISTS issue_lifecycle (
  project_id varchar(128) NOT NULL,
  environment varchar(64) NOT NULL,
  fingerprint char(32) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{32}$'),
  status varchar(16) NOT NULL CHECK (status IN ('open', 'resolved', 'ignored')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment, fingerprint)
);

CREATE INDEX IF NOT EXISTS issue_lifecycle_project_status_idx
  ON issue_lifecycle (project_id, environment, status, updated_at DESC);
