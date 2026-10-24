#!/usr/bin/env bash
# Operator terminal only: private identity and passphrase never enter agent tools.
set -euo pipefail
umask 077
usage() {
  printf '%s\n' 'Usage: bash staging-checkpoint-unseal.sh /absolute/backup-directory /absolute/encrypted-identity.age' \
    'Decrypts a trusted operator checkpoint only into a new isolated local Docker volume.' \
    'Does not start restored databases or source deployment configuration.'
}
if [[ ${1:-} == --help ]]; then usage; exit 0; fi
[[ $# == 2 && $1 == /* && $1 != / && $2 == /* ]] || { usage >&2; exit 2; }
[[ -t 0 && -t 2 && -z ${AGE_PASSPHRASE:-} ]] || { printf '%s\n' 'Use your own terminal; never provide passphrases through chat, arguments or environment.' >&2; exit 2; }
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} ]] || { printf '%s\n' 'Unset Docker endpoint overrides.' >&2; exit 2; }
for tool in docker age shasum mktemp; do command -v "$tool" >/dev/null || exit 2; done
[[ $(docker context show) == orbstack ]] || { printf '%s\n' 'Select the local OrbStack context first.' >&2; exit 2; }
[[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') == unix://* ]] || exit 2
docker info >/dev/null
image=nats:2.14.6-alpine
docker image inspect "$image" >/dev/null || { printf 'Pull the helper image first: docker pull %s\n' "$image" >&2; exit 2; }
backup_directory=$1
identity=$2
[[ -f $identity && ! -L $identity && -f $backup_directory/checkpoint.tar.age && ! -L $backup_directory/checkpoint.tar.age ]] || exit 2
expected=$(awk '$2 == "checkpoint.tar.age" {print $1}' "$backup_directory/SHA256SUMS")
[[ $expected =~ ^[[:xdigit:]]{64}$ ]] || { printf '%s\n' 'Invalid ciphertext checksum record.' >&2; exit 1; }
actual=$(shasum -a 256 "$backup_directory/checkpoint.tar.age" | awk '{print $1}')
[[ $actual == "$expected" ]] || { printf '%s\n' 'Ciphertext checksum mismatch.' >&2; exit 1; }
report=$(mktemp -d "$backup_directory/unseal-XXXXXX")
suffix=${report##*/}
container=spectro-checkpoint-$suffix
volume=$container-input
printf '%s\n' "$container" > "$report/container-name"
printf '%s\n' "$volume" > "$report/volume-name"
printf '%s\n' INCOMPLETE > "$report/STATUS"
printf 'Report directory: %s\n' "$report"
docker volume create --label spectro.purpose=checkpoint-unseal "$volume" >/dev/null
docker run -d --name "$container" --hostname localhost --network none --restart no \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m --cpus 1 --pids-limit 32 \
  --label spectro.purpose=checkpoint-unseal \
  -v "$volume:/backup" --entrypoint sh "$image" \
  -c 'chmod 700 /backup; exec sleep 86400' >/dev/null
cleanup() {
  result=$?
  trap - EXIT
  if ! docker stop "$container" >/dev/null 2>&1; then
    printf 'Could not stop isolated helper; inspect %s\n' "$container" >&2
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
[[ $(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container") == none ]] || exit 1
[[ $(docker port "$container") == '' ]] || exit 1
if ! age --decrypt "$identity" | age --decrypt -i - "$backup_directory/checkpoint.tar.age" \
  | docker exec -i "$container" tar --no-same-owner -xf - -C /backup; then
  printf '%s\n' 'Decryption/extraction failed; protected incomplete volume retained, helper will stop.' >&2
  exit 1
fi
# No arbitrary checksum paths, SQL, shell configuration or archived Compose runs.
# Verify every expected export file without printing any private contents.
docker exec "$container" sh -c '
  set -eu
  cd /backup
  test -f SHA256SUMS; test ! -L SHA256SUMS
  test -f STATUS; test ! -L STATUS
  grep -q "^COMPLETE server export" STATUS
  for f in postgres.dump postgres-globals.sql clickhouse-schema.sql events.native clickhouse-final-count.txt nats-cold-data.tar deployment-config.tar images.json pipeline.json quiesced-at.txt MANIFEST.txt; do
    test -f "$f"; test ! -L "$f"; test -s "$f"
    expected=$(awk -v name="$f" '\''$2 == name {print $1}'\'' SHA256SUMS)
    test "${#expected}" = 64
    actual=$(sha256sum "$f"); actual=${actual%% *}
    test "$actual" = "$expected"
  done
' > "$report/verification.stdout" 2> "$report/verification.stderr"
printf '%s\n' 'PASS: recipient identity decrypted checkpoint; expected exported files match internal checksums.' \
  'NOT VERIFIED: database/broker restore, recovered permissions or application behavior.' \
  'Named input volume contains sensitive plaintext including credentials; keep protected until explicit cleanup.' \
  'Helper will stop. Never launch archived deployment configuration directly.' > "$report/STATUS"
printf '%s\n' 'PASS: isolated unseal and internal checksums. Helper will stop; no ports were published.' \
  'Report only success/failure and report-directory path. Do not send keys, files or logs.'
