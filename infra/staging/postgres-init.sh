#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v api_password="$POSTGRES_API_PASSWORD" -v ingest_password="$POSTGRES_INGEST_PASSWORD" <<'SQL'
CREATE ROLE spectro_api LOGIN PASSWORD :'api_password';
CREATE ROLE spectro_ingest LOGIN PASSWORD :'ingest_password';
REVOKE ALL ON DATABASE spectro FROM PUBLIC;
GRANT CONNECT ON DATABASE spectro TO spectro_api, spectro_ingest;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO spectro_api;
GRANT USAGE ON SCHEMA public TO spectro_ingest;
ALTER ROLE spectro_ingest SET default_transaction_read_only = on;
SQL
