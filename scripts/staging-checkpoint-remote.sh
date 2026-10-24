#!/usr/bin/env bash
# Operator-approved staging maintenance only. Run under an outer timeout.
set -euo pipefail
umask 077
if [[ ${1:-} == --help ]]; then
  printf '%s\n' 'Usage: bash staging-checkpoint-remote.sh --execute checkpoint-<UTC>-<suffix>'
  exit 0
fi
[[ $# == 2 && $1 == --execute && $2 =~ ^checkpoint-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{8}$ ]] || exit 2
[[ $(id -u) == 0 && -d /opt/spectro-staging ]] || exit 2
for tool in docker systemd-run systemctl flock timeout tar sha256sum; do command -v "$tool" >/dev/null; done
cd /opt/spectro-staging
exec 9>/run/lock/spectro-checkpoint.lock
flock -n 9 || { printf '%s\n' 'Another checkpoint is running.' >&2; exit 1; }
dc() { timeout 35 docker compose -f infra/staging/compose.yaml "$@"; }
dc config --quiet
for service in api ingest web processor nats postgres clickhouse; do
  [[ -n $(dc ps -q --status running "$service") ]] || { printf 'Not running: %s\n' "$service" >&2; exit 1; }
done
mkdir -p /opt/spectro-checkpoints
chmod 700 /opt/spectro-checkpoints
destination=/opt/spectro-checkpoints/$2
mkdir -m 700 "$destination"
printf '%s\n' INCOMPLETE > "$destination/STATUS"
unit=spectro-resume-$2
# Independent systemd timer survives SSH loss or shell termination. Do not stop
# it until services have actually been started by the normal cleanup path.
systemd-run --quiet --unit "$unit" --on-active=180s \
  /usr/bin/docker compose -f /opt/spectro-staging/infra/staging/compose.yaml \
  start nats processor api ingest web
resume() {
  local result=$?
  trap - EXIT
  if dc start nats processor api ingest web >&2; then
    systemctl stop "$unit.timer" || true
    printf '%s\n' 'Service start requested; independent health verification required.' >&2
  else
    printf '%s\n' 'Resume failed; watchdog remains armed. Inspect staging immediately.' >&2
    result=1
  fi
  exit "$result"
}
trap resume EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
dc stop -t 10 web api ingest >&2
empty=false
for attempt in {1..15}; do
  dc exec -T processor node services/processor/dist/status.js > "$destination/pipeline.json"
  if dc exec -T processor node --input-type=module -e '
    let s="";for await(const c of process.stdin)s+=c;
    const v=JSON.parse(s),q=v.jetstream;
    process.exit(v.status==="ok"&&v.clickhouseAvailable&&q&&
      [q.streamStoredMessages,q.streamBytes,q.consumerPending,q.consumerAckPending,q.lostBytes].every(x=>x===0)&&
      q.consumerDeliveredSequence===q.consumerAcknowledgedSequence?0:1);
  ' < "$destination/pipeline.json"; then empty=true; break; fi
  sleep 1
done
[[ $empty == true ]] || { printf '%s\n' 'Queue did not drain; no checkpoint claimed.' >&2; exit 1; }
dc stop -t 10 processor nats >&2
date -u +%Y-%m-%dT%H:%M:%SZ > "$destination/quiesced-at.txt"
# No public application writers or queue consumers are running from here until
# the EXIT trap resumes them. Databases remain running for database-aware export.
dc exec -T postgres pg_dump -U spectro_admin -d spectro --format=custom > "$destination/postgres.dump"
dc exec -T postgres pg_dumpall -U spectro_admin --globals-only > "$destination/postgres-globals.sql"
query() {
  dc exec -T clickhouse sh -c 'exec clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "$1"' sh "$1"
}
[[ $(query "SELECT arrayStringConcat(arraySort(groupArray(name)), ',') FROM system.tables WHERE database='spectro' FORMAT TSVRaw") == events_v1 ]] || exit 1
query 'SHOW CREATE TABLE spectro.events_v1 FORMAT TSVRaw' > "$destination/clickhouse-schema.sql"
query 'SELECT event_id,event_version,event_type,event_name,timestamp_ms,envelope_sent_at_ms,processed_at_ms,processing_version,project_id,environment,sdk_name,sdk_version,session_id,user_id,anonymous_id,page_id,page_url,page_path,release_version,trace_id,tags,error_fingerprint,context_json,payload_json FROM spectro.events_v1 FORMAT Native' > "$destination/events.native"
query 'SELECT count() FROM spectro.events_v1 FINAL FORMAT TSVRaw' > "$destination/clickhouse-final-count.txt"
nats_id=$(dc ps -a -q nats)
[[ $(docker inspect --format '{{.State.Running}}' "$nats_id") == false ]] || exit 1
# Cold broker data only: never archive a changing live JetStream directory.
timeout 30 docker run --rm --network none --volumes-from "$nats_id:ro" \
  --entrypoint tar nats:2.14.6-alpine -C /data -cf - . > "$destination/nats-cold-data.tar"
tar -cf "$destination/deployment-config.tar" infra/staging infra/docker/clickhouse/init
dc images --format json > "$destination/images.json"
printf '%s\n' \
  'Quiesced staging component checkpoint; off-host encryption/transfer and restore verification pending.' \
  'Includes credentials in globals/config archives: protect the directory and encrypted recipient identity.' \
  'Broker archive was taken stopped, after an empty-queue assertion; cold restore is NOT yet verified.' \
  'No complete disaster-recovery guarantee; certificates and external Auth0 configuration excluded.' \
  > "$destination/MANIFEST.txt"
(cd "$destination"; sha256sum postgres.dump postgres-globals.sql clickhouse-schema.sql events.native clickhouse-final-count.txt nats-cold-data.tar deployment-config.tar images.json pipeline.json quiesced-at.txt MANIFEST.txt > SHA256SUMS; sha256sum -c SHA256SUMS >/dev/null)
printf '%s\n' 'COMPLETE server export; off-host encryption and restore PENDING' > "$destination/STATUS"
printf '%s\n' "$destination"
