#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "${1:-}" == --help ]]; then
  printf '%s\n' 'Usage: bash scripts/staging-clickhouse-restore-drill.sh /absolute/completed-backup-directory'; exit 0
fi
[[ $# == 1 && "$1" == /* && "$1" != / ]] || exit 2
for dependency in docker age shasum mktemp; do command -v "$dependency" >/dev/null || exit 2; done
[[ -t 0 && -t 2 && -z "${AGE_PASSPHRASE:-}" ]] || { printf '%s\n' 'Use your own terminal without passphrase environment variables or tracing.' >&2; exit 2; }
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || exit 2
[[ "$(docker context inspect --format '{{.Endpoints.docker.Host}}')" == unix://* ]] || exit 2
backup_directory=$1
test -f "$backup_directory/SUCCESS"
expected_hash=$(awk '$2 == "clickhouse.tar.age" && length($1) == 64 { print $1 }' "$backup_directory/SHA256SUMS")
actual_hash=$(shasum -a 256 "$backup_directory/clickhouse.tar.age" | awk '{print $1}')
[[ -n "$expected_hash" && "$expected_hash" == "$actual_hash" ]] || { printf '%s\n' 'Checksum mismatch.' >&2; exit 1; }
image=clickhouse/clickhouse-server:26.3.33.24-alpine
docker image inspect "$image" >/dev/null
report_directory=$(mktemp -d "$backup_directory/restore-drill-XXXXXX")
drill_container="spectro-ch-${report_directory##*/}"
drill_volume="${drill_container}-data"
printf 'Report directory: %s\nContainer: %s\nVolume: %s\n' "$report_directory" "$drill_container" "$drill_volume"
printf '%s\n' "$drill_container" > "$report_directory/container-name"
printf '%s\n' "$drill_volume" > "$report_directory/volume-name"
printf '%s\n' 'INCOMPLETE' > "$report_directory/STATUS"
docker volume create --label spectro.purpose=clickhouse-restore-drill "$drill_volume" >/dev/null
docker run -d --name "$drill_container" --hostname localhost --network none --restart no \
  --memory 2g --cpus 2 --label spectro.purpose=clickhouse-restore-drill \
  -v "$drill_volume:/var/lib/clickhouse" "$image" >/dev/null
trap 'docker stop "$drill_container" >/dev/null 2>&1 || true' EXIT
ready=false
for attempt in {1..40}; do
  if docker exec "$drill_container" clickhouse-client --query 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { printf '%s\n' 'Isolated ClickHouse not ready.' >&2; exit 1; }
docker exec "$drill_container" mkdir -m 700 /tmp/spectro-restore-input
# Trusted operator-created archive only; extracted inside the network-isolated
# disposable container, never onto the Mac filesystem.
if ! age --decrypt "$backup_directory/clickhouse.tar.age" | docker exec -i "$drill_container" \
  tar -xf - -C /tmp/spectro-restore-input; then
  printf '%s\n' 'Decryption/extraction failed; isolated container will stop.' >&2; exit 1
fi
docker exec "$drill_container" sh -c 'set -eu; for f in schema.sql events.native MANIFEST.txt; do test -f "/tmp/spectro-restore-input/$f"; test ! -L "/tmp/spectro-restore-input/$f"; done'
columns='event_id,event_version,event_type,event_name,timestamp_ms,envelope_sent_at_ms,processed_at_ms,processing_version,project_id,environment,sdk_name,sdk_version,session_id,user_id,anonymous_id,page_id,page_url,page_path,release_version,trace_id,tags,error_fingerprint,context_json,payload_json'
docker exec "$drill_container" clickhouse-client --query 'CREATE DATABASE spectro'
docker exec "$drill_container" sh -c 'clickhouse-client --multiquery < /tmp/spectro-restore-input/schema.sql' \
  > "$report_directory/schema.stdout" 2> "$report_directory/schema.stderr"
# Stop background replacement merges so the exported physical row multiset can
# be compared before logical FINAL/deduplication semantics are evaluated.
docker exec "$drill_container" clickhouse-client --query 'SYSTEM STOP MERGES spectro.events_v1'
docker exec "$drill_container" sh -c 'clickhouse-client --query "$1" < /tmp/spectro-restore-input/events.native' sh \
  "INSERT INTO spectro.events_v1 ($columns) FORMAT Native" \
  > "$report_directory/restore.stdout" 2> "$report_directory/restore.stderr"
physical_source_count=$(docker exec "$drill_container" clickhouse local --file /tmp/spectro-restore-input/events.native --input-format Native --query 'SELECT count() FROM table FORMAT TSVRaw')
sort_key='project_id,environment,toDate(fromUnixTimestamp64Milli(timestamp_ms)),event_type,event_name,event_id'
# Native exports can contain older processing versions. ReplacingMergeTree may
# collapse them during INSERT or merges, so physical row counts need not match.
# Reject ambiguous same-key/same-version contents rather than inventing a winner.
ambiguous_versions=$(docker exec "$drill_container" clickhouse local --file /tmp/spectro-restore-input/events.native --input-format Native --query "SELECT count() FROM (SELECT $sort_key,processed_at_ms FROM table GROUP BY $sort_key,processed_at_ms HAVING uniqExact(tuple($columns)) > 1) FORMAT TSVRaw")
[[ "$ambiguous_versions" == 0 ]] || { printf '%s\n' 'Ambiguous same-key/same-version export; manual review required.' >&2; exit 1; }
source_relation="(SELECT * FROM table ORDER BY processed_at_ms DESC LIMIT 1 BY $sort_key)"
source_count=$(docker exec "$drill_container" clickhouse local --file /tmp/spectro-restore-input/events.native --input-format Native --query "SELECT count() FROM $source_relation FORMAT TSVRaw")
restored_count=$(docker exec "$drill_container" clickhouse-client --query 'SELECT count() FROM spectro.events_v1 FINAL FORMAT TSVRaw')
[[ "$source_count" == "$restored_count" ]] || { printf '%s\n' 'Export/restore logical event count mismatch.' >&2; exit 1; }
row_query="SELECT toJSONString(tuple($columns)) AS row FROM"
source_digest=$(docker exec "$drill_container" sh -c 'set -eu; clickhouse local --file /tmp/spectro-restore-input/events.native --input-format Native --query "$1" > /tmp/spectro-restore-input/source-canonical; sha256sum /tmp/spectro-restore-input/source-canonical' sh "$row_query $source_relation ORDER BY row FORMAT TSVRaw" | awk '{print $1}')
restored_digest=$(docker exec "$drill_container" sh -c 'set -eu; clickhouse-client --query "$1" > /tmp/spectro-restore-input/restored-canonical; sha256sum /tmp/spectro-restore-input/restored-canonical' sh "$row_query spectro.events_v1 FINAL ORDER BY row FORMAT TSVRaw" | awk '{print $1}')
[[ "$source_digest" == "$restored_digest" ]] || { printf '%s\n' 'Export/restore canonical content mismatch.' >&2; exit 1; }
docker exec "$drill_container" clickhouse-client --query \
  'SELECT count() AS logical_events, uniqExact(session_id) AS session_ids FROM spectro.events_v1 FINAL FORMAT TSVWithNames' > "$report_directory/logical-summary.tsv"
printf '%s\n' "Export physical rows: $physical_source_count" "Export logical events: $source_count" "Restored FINAL events: $restored_count" \
  "Export canonical SHA256: $source_digest" "Restored canonical SHA256: $restored_digest" \
  'PASS: decrypted archive restored; canonical stored columns of final logical events match version-selected Native export.' \
  'NOT VERIFIED: export versus source cutoff baseline, source physical parts, materialized-column equivalence, users/grants, cross-service consistency or full disaster recovery.' \
  'Isolated container holds plaintext events and will stop. Keep its volume and container protected until explicit cleanup.' \
  > "$report_directory/STATUS"
printf '%s\n' 'Local ClickHouse restore completed. Container will stop; no port published.' \
  'Report only success/failure and report-directory path; do not paste payloads, archive contents or logs.'
