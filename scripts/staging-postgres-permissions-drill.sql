-- Execute ONLY against the isolated spectro_restore database as its administrator.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'spectro_restore' OR current_user <> 'spectro_restore' THEN
    RAISE EXCEPTION 'Refusing non-drill database or administrator';
  END IF;
END $$;
CREATE ROLE spectro_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE spectro_ingest NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON DATABASE spectro_restore FROM PUBLIC;
GRANT CONNECT ON DATABASE spectro_restore TO spectro_api, spectro_ingest;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO spectro_api;
GRANT USAGE ON SCHEMA public TO spectro_ingest;
SELECT format('ALTER TABLE %I.%I OWNER TO spectro_api;', schemaname, tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\gexec
GRANT SELECT ON public.project_write_keys TO spectro_ingest;
ALTER ROLE spectro_ingest SET default_transaction_read_only = on;
COMMIT;

-- Use actual role execution, not privilege metadata alone. No row values printed.
BEGIN;
SET LOCAL ROLE spectro_ingest;
SELECT 'PASS: ingestion key read', count(*) AS key_count FROM public.project_write_keys;
DO $$
DECLARE statement text; denied boolean;
BEGIN
  FOREACH statement IN ARRAY ARRAY[
    'SELECT 1 FROM public.console_users LIMIT 0',
    'SELECT 1 FROM public.console_sessions LIMIT 0',
    'SELECT 1 FROM public.organizations LIMIT 0',
    'SELECT 1 FROM public.projects LIMIT 0',
    'UPDATE public.project_write_keys SET label=label WHERE false',
    'DELETE FROM public.project_write_keys WHERE false',
    'CREATE TABLE public.spectro_acl_forbidden_probe(id integer)'
  ] LOOP
    denied := false;
    BEGIN
      EXECUTE statement;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'Unexpectedly permitted: %', statement; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: seven prohibited ingestion operations denied';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE spectro_api;
SELECT 'PASS: API restored-table reads', count(*) FROM public.projects;
-- No-op write checks authorization without modifying records; rollback regardless.
UPDATE public.projects SET name=name WHERE false;
UPDATE public.issue_lifecycle SET status=status WHERE false;
CREATE TABLE public.spectro_acl_api_probe(id integer);
ROLLBACK;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('spectro_api','spectro_ingest')
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unexpected privileged or login-enabled drill role';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole
    WHERE r.rolname='spectro_ingest' AND 'default_transaction_read_only=on'=ANY(s.setconfig)) THEN
    RAISE EXCEPTION 'Missing ingestion read-only role default';
  END IF;
  RAISE NOTICE 'PASS: NOLOGIN/non-privileged roles and configured read-only default';
END $$;
SELECT 'PASS: isolated role authorization drill; login authentication NOT tested';
