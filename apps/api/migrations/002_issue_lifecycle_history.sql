CREATE TABLE IF NOT EXISTS issue_lifecycle_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id varchar(128) NOT NULL,
  environment varchar(64) NOT NULL,
  fingerprint char(32) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{32}$'),
  previous_status varchar(16) CHECK (previous_status IN ('open', 'resolved', 'ignored')),
  status varchar(16) NOT NULL CHECK (status IN ('open', 'resolved', 'ignored')),
  actor_id varchar(128),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_lifecycle_history_lookup_idx
  ON issue_lifecycle_history (project_id, environment, fingerprint, changed_at DESC, id DESC);
