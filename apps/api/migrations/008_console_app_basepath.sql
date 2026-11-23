ALTER TABLE oidc_login_attempts DROP CONSTRAINT oidc_login_attempts_return_path_check;
ALTER TABLE oidc_login_attempts
  ALTER COLUMN return_path SET DEFAULT '/app',
  ADD CONSTRAINT oidc_login_attempts_return_path_check
  CHECK (return_path IN ('/', '/invite', '/app', '/app/invite'));
