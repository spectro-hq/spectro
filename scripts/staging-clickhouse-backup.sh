#!/usr/bin/env bash
# Run in the operator's Mac terminal, never through an agent-controlled prompt.
set -euo pipefail
umask 077
if [[ "${1:-}" == --help ]]; then
  printf '%s\n' 'Usage: bash scripts/staging-clickhouse-backup.sh /absolute/backup-parent' \
    'Encrypted logical export of events_v1 plus actual schema. Restore NOT yet verified.'; exit 0
fi
[[ $# == 1 && "$1" == /* && "$1" != / ]] || { printf '%s\n' 'Supply an absolute backup-parent directory.' >&2; exit 2; }
for dependency in age ssh shasum mktemp; do command -v "$dependency" >/dev/null || exit 2; done
[[ -t 0 && -t 2 && -z "${AGE_PASSPHRASE:-}" ]] || { printf '%s\n' 'Use your own terminal, without passphrase environment variables or tracing.' >&2; exit 2; }
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$1"
backup_directory=$(mktemp -d "$1/clickhouse-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
printf 'Backup directory: %s\n' "$backup_directory"
printf '%s\n' 'INCOMPLETE' > "$backup_directory/STATUS"
if ! ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=15 -o IdentitiesOnly=yes \
  -i /Users/roshan/.ssh/spectro_hetzner root@91.98.41.235 sh -s \
  < "$script_directory/staging-clickhouse-export-remote.sh" \
  | age --passphrase -o "$backup_directory/clickhouse.tar.age.partial"; then
  printf '%s\n' 'Export failed; incomplete ciphertext retained. Do not restore.' >&2; exit 1
fi
test -s "$backup_directory/clickhouse.tar.age.partial"
mv "$backup_directory/clickhouse.tar.age.partial" "$backup_directory/clickhouse.tar.age"
(cd "$backup_directory" && shasum -a 256 clickhouse.tar.age > SHA256SUMS && shasum -a 256 -c SHA256SUMS)
printf '%s\n' 'Encrypted logical export transferred; decryption/restore not yet verified.' > "$backup_directory/SUCCESS"
printf '%s\n' 'COMPLETE transfer, RESTORE PENDING. events_v1 only, not full disaster recovery.' > "$backup_directory/STATUS"
printf '%s\n' 'Save the passphrase independently. Report only success/failure and backup-directory path.'
