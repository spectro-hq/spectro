#!/bin/sh
set -eu
# Generated passwords are prefixed hexadecimal, safe as SQL string literals.
for value in "$CLICKHOUSE_API_PASSWORD" "$CLICKHOUSE_PROCESSOR_PASSWORD"; do
  case "$value" in *[!a-f0-9s]*) exit 1 ;; esac
  [ "${#value}" -eq 65 ] || exit 1
done
clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<SQL
CREATE USER spectro_api IDENTIFIED WITH sha256_password BY '$CLICKHOUSE_API_PASSWORD';
GRANT SELECT ON spectro.events_v1 TO spectro_api;
CREATE USER spectro_processor IDENTIFIED WITH sha256_password BY '$CLICKHOUSE_PROCESSOR_PASSWORD';
GRANT INSERT ON spectro.events_v1 TO spectro_processor;
SQL
