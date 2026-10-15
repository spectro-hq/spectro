#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --host postgres --username spectro_api --dbname spectro <<'SQL'
GRANT SELECT ON project_write_keys TO spectro_ingest;
SQL
