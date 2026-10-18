#!/bin/sh
# Invoked over SSH by the operator-side encrypted export script.
set -eu
umask 077
cd /opt/spectro-staging
export_directory=$(mktemp -d /tmp/spectro-ch-export-XXXXXX)
cleanup() {
  rm -f "$export_directory/schema.sql" "$export_directory/events.native" "$export_directory/MANIFEST.txt"
  rmdir "$export_directory"
}
trap cleanup EXIT HUP INT TERM
query() {
  docker compose -f infra/staging/compose.yaml exec -T clickhouse sh -c \
    'exec clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "$1"' sh "$1"
}
# Deliberately export only the known table; fail rather than silently omit new ones.
tables=$(query "SELECT arrayStringConcat(arraySort(groupArray(name)), ',') FROM system.tables WHERE database='spectro' FORMAT TSVRaw")
[ "$tables" = events_v1 ] || { printf '%s\n' 'Unexpected table inventory; review export scope first.' >&2; exit 1; }
query 'SHOW CREATE TABLE spectro.events_v1 FORMAT TSVRaw' > "$export_directory/schema.sql"
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Explicitly exclude computed columns; preserve stored versions, not FINAL results.
query 'SELECT event_id,event_version,event_type,event_name,timestamp_ms,envelope_sent_at_ms,processed_at_ms,processing_version,project_id,environment,sdk_name,sdk_version,session_id,user_id,anonymous_id,page_id,page_url,page_path,release_version,trace_id,tags,error_fingerprint,context_json,payload_json FROM spectro.events_v1 FORMAT Native' > "$export_directory/events.native"
test -s "$export_directory/events.native"
printf '%s\n' 'Scope: spectro.events_v1 only; logical Native export, not native BACKUP.' \
  "Source version: $(query 'SELECT version() FORMAT TSVRaw')" \
  "Export started: $started_at" "Export completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  'Schema captured before data; no DDL changes should run during export.' \
  'Materialized columns excluded and recomputed on restore; physical part layout not preserved.' \
  'Excludes users/grants, server configuration, PostgreSQL and JetStream. No coordinated recovery checkpoint.' \
  'Source snapshot row-count/checksum baseline not captured; do not claim row-exact source comparison.' \
  > "$export_directory/MANIFEST.txt"
tar -C "$export_directory" -cf - schema.sql events.native MANIFEST.txt
