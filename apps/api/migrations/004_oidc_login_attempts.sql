CREATE TABLE IF NOT EXISTS oidc_login_attempts (
  state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  code_verifier varchar(128) NOT NULL,
  nonce varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oidc_login_attempts_expiry_idx ON oidc_login_attempts (expires_at);
