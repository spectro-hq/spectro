#!/usr/bin/env bash
# Deploy a staging release to the single ARM64 host over SSH. Operator-side:
# run from any checkout of this repository. Uploads the tracked tree of the
# requested commit (never the working tree), builds release-tagged images on
# the host, applies pending control-plane migrations, and rolls the four
# application containers. Data services (postgres/nats/clickhouse) are only
# depended on, never recreated; named volumes are never touched. ADR-054.
set -euo pipefail
umask 077

host=${STAGING_SSH_HOST:-spe}
compose='docker compose -f infra/staging/compose.yaml'
app_services='api ingest processor web'
data_services='spectro-staging-postgres-1 spectro-staging-nats-1 spectro-staging-clickhouse-1'

usage() {
  printf '%s\n' \
    'Usage: bash scripts/deploy-staging.sh [<sha>]   deploy <sha> (default HEAD)' \
    '       bash scripts/deploy-staging.sh --verify-only [<sha>]   re-run acceptance' \
    'Host is $STAGING_SSH_HOST (default: spe). Only tracked files are uploaded.' >&2
}

verify_only=false
sha=
for arg in "$@"; do
  case "$arg" in
    --verify-only) verify_only=true ;;
    --help | -h) usage; exit 0 ;;
    -*) printf 'Unknown option: %s\n' "$arg" >&2; usage; exit 2 ;;
    *) [ -z "$sha" ] && sha=$arg || { usage; exit 2; } ;;
  esac
done
sha=${sha:-HEAD}
sha=$(git rev-parse --verify "$sha^{commit}")
short=${sha:0:7}
release_dir=/opt/spectro-releases/$sha

remote() { ssh -o BatchMode=yes "$host" "$@"; }
remote_script() { ssh -o BatchMode=yes "$host" bash -s "$@"; }

require_curl() { curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$1"; }

acceptance() {
  console_host=$(remote "grep '^CONSOLE_HOST=' '$release_dir/infra/staging/.env' | cut -d= -f2 | tr -d '\"'")
  ingest_host=$(remote "grep '^INGEST_HOST=' '$release_dir/infra/staging/.env' | cut -d= -f2 | tr -d '\"'")
  [ -n "$console_host" ] && [ -n "$ingest_host" ] || {
    printf 'Could not read hosts from %s/infra/staging/.env\n' "$release_dir" >&2
    exit 1
  }
  printf 'Acceptance against %s / %s\n' "$console_host" "$ingest_host"
  status=$(require_curl "https://$console_host/health")
  [ "$status" = 200 ] || { printf 'console /health: %s\n' "$status" >&2; exit 1; }
  status=$(require_curl "https://$ingest_host/health")
  [ "$status" = 200 ] || { printf 'ingest /health: %s\n' "$status" >&2; exit 1; }
  status=$(require_curl "https://$console_host/v1/auth/session")
  [ "$status" = 401 ] || { printf 'auth session must be 401 unauthenticated, got %s\n' "$status" >&2; exit 1; }
  root_title=$(curl -fsS --max-time 20 "https://$console_host/" | grep -o '<title>[^<]*</title>' | head -1)
  app_title=$(curl -fsS --max-time 20 "https://$console_host/app/" | grep -o '<title>[^<]*</title>' | head -1)
  printf '/      %s\n/app/   %s\n' "$root_title" "$app_title"
  case $root_title in *Spectro*) ;; *) printf 'root did not serve the landing document\n' >&2; exit 1 ;; esac
  case $app_title in *Observatory*) ;; *) printf '/app/ did not serve the console document\n' >&2; exit 1 ;; esac
  printf '%s\n' 'Acceptance passed. Interactive Auth0 login and live SDK delivery remain manual checks.'
}

if $verify_only; then
  acceptance
  exit 0
fi

if ! git branch -r --contains "$sha" 2>/dev/null | grep -q .; then
  printf 'warning: %s is not on any remote-tracking branch\n' "$sha" >&2
fi

# Upload the exact tracked tree; a repeat run on the same sha is idempotent.
printf 'Uploading %s to %s:%s\n' "$short" "$host" "$release_dir"
git archive "$sha" | remote "mkdir -p '$release_dir' && tar -x -C '$release_dir'"

# Server-only env: reuse the most recent release's file, never print it.
remote_script -- "$release_dir" <<'EOS'
set -e
release_dir=$1
src=$(ls -t /opt/spectro-releases/*/infra/staging/.env 2>/dev/null | grep -v "^$release_dir" | head -1)
[ -n "$src" ] || { echo 'No prior infra/staging/.env on host; create it manually first.' >&2; exit 1; }
cp -a "$src" "$release_dir/infra/staging/.env"
chmod 600 "$release_dir/infra/staging/.env"
[ "$(sha256sum "$src" | cut -d' ' -f1)" = "$(sha256sum "$release_dir/infra/staging/.env" | cut -d' ' -f1)" ]
EOS

printf 'Building images on %s (this can take several minutes on ARM64)\n' "$host"
remote "cd '$release_dir' && $compose build"

remote "docker tag spectro-staging-runtime:local spectro-staging-runtime:release-$short && docker tag spectro-staging-web:local spectro-staging-web:release-$short"
printf 'Tagged release-%s\n' "$short"

# Record data-service container identities; they must be identical afterwards.
remote_script -- "$data_services" <<'EOS'
set -e
for name in $1; do docker ps -q --filter "name=^${name}$"; done | sort > /tmp/spectro-deploy-data-ids
EOS

# Idempotent migration ledger; safe to run when nothing is pending.
remote "cd '$release_dir' && $compose run --rm migrate"

printf 'Rolling %s\n' "$app_services"
remote "cd '$release_dir' && timeout 300 $compose up -d --no-deps --no-build --wait --wait-timeout 120 $app_services"

remote_script -- "$data_services" <<'EOS'
set -e
for name in $1; do docker ps -q --filter "name=^${name}$"; done | sort > /tmp/spectro-deploy-data-ids-after
if ! diff /tmp/spectro-deploy-data-ids /tmp/spectro-deploy-data-ids-after >/dev/null; then
  echo 'DATA SERVICE CONTAINER IDS CHANGED — inspect before trusting this rollout' >&2
  exit 1
fi
echo 'Data services unchanged.'
EOS

acceptance

printf '%s\n' \
  "Deployed $sha to $host." \
  'Rollback: retag the previous spectro-staging-{runtime,web}:release-* or *-rollback-* image' \
  'to :local and rerun the rolling update from that release directory.'
