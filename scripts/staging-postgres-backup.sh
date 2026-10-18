#!/usr/bin/env bash
# PostgreSQL-only, encrypted off-host drill input. Run in your own Mac terminal.
set -euo pipefail
umask 077

usage() {
  printf '%s\n' 'Usage: bash scripts/staging-postgres-backup.sh /absolute/backup-directory' \
    'Streams a live pg_dump over SSH into age passphrase encryption on this Mac.' \
    'No plaintext dump is written. Not a complete Spectro disaster-recovery backup.'
}
if [[ "${1:-}" == '--help' ]]; then usage; exit 0; fi
if [[ $# != 1 || "$1" != /* || "$1" == / ]]; then usage >&2; exit 2; fi
for dependency in ssh age shasum mktemp; do
  command -v "$dependency" >/dev/null || { printf 'Missing tool: %s\n' "$dependency" >&2; exit 2; }
done
if [[ ! -t 0 || ! -t 2 ]]; then
  printf '%s\n' 'Run interactively in your own terminal; never pipe or log the passphrase.' >&2
  exit 2
fi
if [[ -n "${AGE_PASSPHRASE:-}" ]]; then
  printf '%s\n' 'Unset AGE_PASSPHRASE; enter the passphrase only at the age prompt.' >&2
  exit 2
fi
backup_parent=$1
mkdir -p "$backup_parent"
backup_directory=$(mktemp -d "$backup_parent/postgres-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
printf 'Backup directory: %s\n' "$backup_directory"
printf '%s\n' 'INCOMPLETE - do not use until SUCCESS exists' > "$backup_directory/STATUS"

# SSH transport encryption protects the stream in transit. age authenticates and
# encrypts it before disk output. pipefail prevents a failed pg_dump from passing.
if ! ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=15 \
  -o IdentitiesOnly=yes -i /Users/roshan/.ssh/spectro_hetzner \
  root@91.98.41.235 \
  'cd /opt/spectro-staging && docker compose -f infra/staging/compose.yaml exec -T postgres pg_dump -U spectro_admin -d spectro --format=custom' \
  </dev/null | age --passphrase --output "$backup_directory/postgres.dump.age.partial"; then
  printf '%s\n' 'Backup failed. Any partial ciphertext is retained, marked INCOMPLETE; do not restore it.' >&2
  exit 1
fi
test -s "$backup_directory/postgres.dump.age.partial"
mv "$backup_directory/postgres.dump.age.partial" "$backup_directory/postgres.dump.age"
(
  cd "$backup_directory"
  shasum -a 256 postgres.dump.age > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
)
printf '%s\n' \
  'Scope: PostgreSQL database spectro only; pg_dump custom format.' \
  'Source: spectro-staging, 91.98.41.235; snapshot taken during pg_dump.' \
  'Excludes cluster-global role definitions/passwords, ClickHouse, JetStream, deployment secrets and certificates.' \
  'Owners/grants refer to source role names; isolated restore must recreate roles or explicitly skip owner/ACL and validate grants separately.' \
  'Not a coordinated cross-service recovery checkpoint; not yet restore-verified.' \
  "Completed at: $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$backup_directory/MANIFEST.txt"
printf '%s\n' 'Encrypted transfer complete; restore verification pending.' > "$backup_directory/SUCCESS"
printf '%s\n' 'COMPLETE encrypted PostgreSQL transfer; RESTORE NOT YET VERIFIED' > "$backup_directory/STATUS"
printf '%s\n' 'Save the passphrase in your password app and an independent offline location.' \
  'Do not send the passphrase, dump, or decrypted contents to chat.' \
  'Report only that the command succeeded; next step is isolated decryption and restore.'
