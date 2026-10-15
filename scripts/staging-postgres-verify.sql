-- Read-only metadata and aggregates; never selects credentials or user records.
BEGIN READ ONLY;
SELECT 'columns_md5', md5(string_agg(
  concat_ws('|', table_name, column_name, ordinal_position::text, data_type,
    udt_name, is_nullable, coalesce(column_default, '')),
  E'\n' ORDER BY table_name, ordinal_position))
FROM information_schema.columns WHERE table_schema = 'public';
SELECT 'constraints_md5', md5(string_agg(
  c.conrelid::regclass::text || '|' || c.conname || '|' || pg_get_constraintdef(c.oid),
  E'\n' ORDER BY c.conrelid::regclass::text, c.conname))
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public';
SELECT 'migrations', string_agg(name, ',' ORDER BY name) FROM control_plane_migrations;
SELECT 'counts', json_build_object(
  'organizations', (SELECT count(*) FROM organizations),
  'projects', (SELECT count(*) FROM projects),
  'environments', (SELECT count(*) FROM project_environments),
  'memberships', (SELECT count(*) FROM organization_memberships),
  'users', (SELECT count(*) FROM console_users),
  'keys', (SELECT count(*) FROM project_write_keys));
SELECT 'orphans', json_build_object(
  'project_organization', (SELECT count(*) FROM projects p LEFT JOIN organizations o ON o.id=p.organization_id WHERE o.id IS NULL),
  'membership_user', (SELECT count(*) FROM organization_memberships m LEFT JOIN console_users u ON u.id=m.user_id WHERE u.id IS NULL),
  'key_environment', (SELECT count(*) FROM project_write_keys k LEFT JOIN project_environments e ON e.project_id=k.project_id AND e.name=k.environment WHERE e.project_id IS NULL));
SELECT 'app_roles', count(*) FROM pg_roles WHERE rolname IN ('spectro_api', 'spectro_ingest');
COMMIT;
