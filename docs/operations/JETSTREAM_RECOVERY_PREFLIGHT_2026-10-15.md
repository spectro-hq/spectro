# JetStream recovery preflight: 2026-10-15

Read-only live observation at 09:49:51 UTC. This is not a backup or restore test.
No messages published, consumed manually, acknowledged, purged or deleted; no
service paused or configuration changed.

## Observed state

- Stream `SPECTRO_ADMITTED`, subject `spectro.admitted.v1`.
- File storage, workqueue retention, one replica, discard new at capacity.
- Limit 10 GiB per stream, 1 MiB per message; configured max age zero.
- Publish duplicate window: 120 seconds.
- Consumer `spectro-processor-v1`: explicit ack, deliver all, max delivery 10,
  max ack pending 100. Backoff: 1s, 5s, 30s, 120s, 600s. Reported ack wait is
  1s; do not describe the source's 30s initial constant as the effective setting.
- Stored messages/bytes, pending, ack pending and redelivered: all zero.
- Delivered stream sequence and acknowledgement floor: 239. These are envelope
  delivery positions, not event counts.
- Processor status `ok`, ClickHouse available, no reported diagnostic codes.
- Monitoring reports sync interval 120s, single replica. Neither health nor a
  publish acknowledgement alone establishes tested host/power-loss durability.

## Source behavior

`packages/pipeline/src/jetstream.ts` waits for publish acknowledgement, uses an
envelope identity as message ID, and acknowledges explicitly. The processor's
`worker.ts` awaits processing/storage before ack. Failed processing calls delayed
NAK with 1s; the configured consumer backoff is not a guarantee that this explicit
NAK follows all of the timeout backoff intervals. Admission decode errors terminate
the delivery. Exhausted deliveries and terminated messages require investigation;
do not assume an automatic DLQ or automatic later recovery.

## Critical recovery boundary

Workqueue-retained messages are removed after successful acknowledgement. They
are not a replay archive of all historical events. The existing earlier
ClickHouse export and a later empty queue cannot recover events processed and
acknowledged between those snapshots if the live host is lost.

The individual PostgreSQL and ClickHouse drills therefore remain component
recovery evidence only. They do not establish a coordinated recovery point or
that all previously accepted envelopes can be recovered. Publish deduplication
has a bounded window; replay must also verify logical event identity and
ClickHouse version selection, not claim globally exactly-once delivery.

## Next drill and authority boundary

1. In a new isolated local NATS environment, use synthetic envelopes to exercise
   both stored-but-undelivered and delivered-but-unacknowledged states.
2. Use supported stream snapshot/restore APIs with consumer state included;
   preserve sequence/configuration metadata. Never copy changing live storage
   directories as an unverified snapshot substitute.
3. Restore into independent local volumes/network, assert pending envelope IDs
   and redelivery behavior, then process into an isolated ClickHouse. Verify
   logical event uniqueness after replay and after simulated write-before-ack
   failure. Test limits/exhaustion separately from a successful happy path.
4. Only after local validation, prepare an operator-approved coordinated live
   checkpoint: brief explicit maintenance window, stop admission and control-plane
   mutations, drain processor and verify zero pending/ack-pending with stable
   stream positions, then take a new matching PostgreSQL/ClickHouse/stream-state
   backup set and manifest while mutations remain blocked. Any nonzero backlog
   or failed drain means stop and investigate, not discard. Specify recovery of
   failure during the window, timeouts and guaranteed service-resume cleanup
   before executing. This window is NOT approved or executed by this report.
5. Encrypt and transfer the set off-host, restore together, verify references,
   roles and cutoffs; document measured RPO/RTO. A periodic backup necessarily
   has a recovery gap; do not promise zero loss for later accepted events.

Changing retention, identity/ack semantics, storage topology or recovery
architecture requires reading the constitutional architecture documents and an
ADR before implementation. This report does not make those changes.

References:

- https://docs.nats.io/using-nats/jetstream/model_deep_dive
- https://docs.nats.io/nats-concepts/jetstream/consumers

## Supplemental local snapshot/restore drill

Executed `node scripts/jetstream-local-restore-drill.mjs` against two independent
local `nats:2.14.6-alpine` containers. Ports were bound only to 127.0.0.1;
neither instance had a staging URL, credentials or route/cluster configuration.
Only synthetic JSON markers were published, not customer envelopes.

- Three markers: already acknowledged, delivered without ack, not delivered.
- Before snapshot: pending=1, ack-pending=1. The already-acked message was absent
  under workqueue retention.
- Used official stream SNAPSHOT and RESTORE request APIs, message checksum
  validation enabled, consumer state included. Snapshot archive was 1507 bytes.
- After restore: pending=1, ack-pending=1, matching the source snapshot.
- Received the previously undelivered marker at stream sequence 3, delivery 1;
  received in-flight marker at stream sequence 2, delivery 2. No acknowledged
  marker was replayed. Explicit confirmed acknowledgements left zero messages.
- Both local containers stopped on exit and remain available for deliberate
  cleanup. The synthetic archive and result are in ignored
  `.local/jetstream-drill-4f3f903b`; no real queue snapshot was created.

Result: PASS for bounded broker-level pending/in-flight snapshot recovery.
This does not validate ClickHouse write-before-ack failure, full event processor
replay, live backup privileges, encrypted real snapshots, cross-service cutoff,
retry exhaustion, host/power failure, or coordinated disaster recovery.

The local test intentionally uses a 2s acknowledgement wait to observe redelivery
quickly. It is not an exact copy of the production consumer backoff configuration
and must not be used to justify changing that configuration.
