#!/usr/bin/env bash
# Operator-run only. Passphrase stays in the operator's terminal.
set -euo pipefail
umask 077
usage() {
  printf '%s\n' 'Usage: bash scripts/staging-postgres-restore-drill.sh /absolute/completed-backup-directory' \
    'Creates a new isolated local PostgreSQL 18.6 container; never contacts staging.'
}
if [[ "${1:-}" == --help ]]; then usage; exit 0; fi
if [[ $# != 1 || "$1" != /* || "$1" == / ]]; then usage >&2; exit 2; fi
for dependency in docker age shasum mktemp; do
  command -v "$dependency" >/dev/null || { printf 'Missing tool: %s\n' "$dependency" >&2; exit 2; }
done
if [[ ! -t 0 || ! -t 2 || -n "${AGE_PASSPHRASE:-}" ]]; then
  printf '%s\n' 'Run in your own interactive terminal without AGE_PASSPHRASE or tracing.' >&2; exit 2
fi
backup_directory=$1
test -f "$backup_directory/SUCCESS"
test -s "$backup_directory/postgres.dump.age"
# Do not execute an operator-editable checksum file or arbitrary paths within it.
expected_hash=$(awk '$2 == "postgres.dump.age" && length($1) == 64 { print $1 }' "$backup_directory/SHA256SUMS")
actual_hash=$(shasum -a 256 "$backup_directory/postgres.dump.age" | awk '{print $1}')
[[ -n "$expected_hash" && "$expected_hash" == "$actual_hash" ]] || { printf '%s\n' 'Checksum mismatch.' >&2; exit 1; }
if [[ -n "${DOCKER_HOST:-}" || -n "${DOCKER_CONTEXT:-}" ]]; then
  printf '%s\n' 'Unset Docker endpoint overrides and select the local OrbStack context first.' >&2; exit 2
fi
docker_endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
[[ "$docker_endpoint" == unix://* ]] || { printf '%s\n' 'Refusing non-local Docker endpoint.' >&2; exit 2; }
docker info >/dev/null
docker image inspect postgres:18.6-alpine >/dev/null || { printf '%s\n' 'First run: docker pull postgres:18.6-alpine' >&2; exit 2; }
report_directory=$(mktemp -d "$backup_directory/restore-drill-XXXXXX")
drill_suffix=${report_directory##*/}
drill_container="spectro-pg-${drill_suffix}"
drill_volume="spectro-pg-${drill_suffix}-data"
printf 'Report directory: %s\nContainer: %s\nVolume: %s\n' "$report_directory" "$drill_container" "$drill_volume"
printf '%s\n' "$drill_container" > "$report_directory/container-name"
printf '%s\n' "$drill_volume" > "$report_directory/volume-name"
printf '%s\n' 'INCOMPLETE - local data/schema restore only, grants excluded' > "$report_directory/STATUS"
docker volume create --label spectro.purpose=postgres-restore-drill "$drill_volume" >/dev/null
docker run -d --name "$drill_container" --network none --restart no \
  --memory 1g --cpus 1 --label spectro.purpose=postgres-restore-drill \
  -e POSTGRES_USER=spectro_restore -e POSTGRES_DB=spectro_restore \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "$drill_volume:/var/lib/postgresql" postgres:18.6-alpine >/dev/null
# Only stop the exact newly created drill container. Keep its volume for review.
trap 'docker stop "$drill_container" >/dev/null 2>&1 || true' EXIT
ready=false
for attempt in {1..30}; do
  if docker exec "$drill_container" pg_isready -h 127.0.0.1 -U spectro_restore -d spectro_restore >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { printf '%s\n' 'Isolated PostgreSQL did not become ready.' >&2; exit 1; }
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# No plaintext host dump. Isolated DB volume DOES contain restored sensitive data.
# No --clean, no original database name/URL, no published ports, no live broker.
if ! age --decrypt "$backup_directory/postgres.dump.age" | \
  docker exec -i "$drill_container" pg_restore --username=spectro_restore \
    --dbname=spectro_restore --no-owner --no-acl --exit-on-error --single-transaction \
    > "$report_directory/restore.stdout" 2> "$report_directory/restore.stderr"; then
  printf '%s\n' 'Restore failed; inspect local report privately. Isolated container will stop; volume retained.' >&2
  exit 1
fi
docker exec -i "$drill_container" psql -X -v ON_ERROR_STOP=1 -U spectro_restore -d spectro_restore \
  > "$report_directory/validation.txt" <<'SQL'
SELECT version();
SELECT name FROM control_plane_migrations ORDER BY name;
SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
SELECT count(*) AS unvalidated_foreign_keys FROM pg_constraint WHERE contype = 'f' AND NOT convalidated;
SQL
printf '%s\n' "Started: $started_at" "Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "Ciphertext SHA256: $actual_hash" \
  'PASS: decryption and transactional schema/data restore completed.' \
  'NOT VERIFIED: comparison against source snapshot counts, role/grant recovery, application auth, other services or end-to-end disaster recovery.' \
  'Local isolated volume contains plaintext restored DB data; keep protected and arrange explicit cleanup after review.' \
  > "$report_directory/STATUS"
printf '%s\n' 'Local restore completed. Container will stop; no port was published.' \
  'Report only success/failure and report-directory path. Do not paste database contents or logs.'
