# Staging backup and restore preparation

Status: original preparation plan; partial drills have since been completed.
See `POSTGRES_DRILL_2026-10-15.md`, `CLICKHOUSE_DRILL_2026-10-15.md`,
`JETSTREAM_RECOVERY_PREFLIGHT_2026-10-15.md` and
`PIPELINE_ACK_LOSS_DRILL_2026-10-15.md` for evidence and remaining limits.
No automated backup scheduler or coordinated live recovery checkpoint is in place.
Implements the existing operational gate in ADR-054; does not select a new storage
technology or change topology.

## Decisions required before execution

1. Select an independent destination: encrypted download to the operator's Mac
   for a first drill, or an existing S3-compatible store. Do not provision paid
   storage without explicit operator approval. A Mac copy is not an automated
   production backup policy.
2. Select encryption and key custody. The recovery key must be available without
   the original VPS, and must not be committed or sent in chat. Use separate
   least-privilege backup credentials, never application credentials in logs.
3. Agree a backup schedule, retention, recovery-point target and recovery-time
   target. Initial observed timings do not constitute an availability promise.
4. Approve an isolated restore runtime and its resource budget. Restoring on the
   existing 8 GB host risks memory/disk contention; inspect headroom first.

## Inventory and consistency boundaries

| Asset        | Recovery requirement                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL   | Consistent logical dump plus schema/migration ledger, organization/project/key/lifecycle records, required role/grant recreation; preserve credentials securely |
| ClickHouse   | Version-compatible backup of event data and schema, with a manifest and explicit recovery cutoff; a successful SQL export alone is not a tested backup strategy |
| JetStream    | Stream/consumer configuration and pending durable events require a recovery policy; independently timed DB backups are not a coordinated pipeline checkpoint    |
| Deployment   | Exact source/image versions, Compose and Caddy configuration, migrations and service grants                                                                     |
| Secrets      | Encrypted, separate recovery material for server-only configuration and encryption key custody; never print expanded Compose config                             |
| Certificates | Document reissuance or protected certificate-volume recovery; prevent an isolated clone from answering real public traffic                                      |

Do not tar live database directories as a substitute for database-aware backups.
Do not claim lossless recovery from independent snapshots. Before choosing the
JetStream procedure, establish admission and processing watermarks, replay and
deduplication behavior. If a consistent checkpoint needs a brief ingestion pause,
obtain approval for that interruption before execution. Do not silently discard
queued accepted events or purge streams to simplify the drill.

## First drill sequence

1. Read-only preflight: current service/image versions, health, disk/memory,
   table counts, migration ledger, JetStream backlog. Record only non-sensitive
   aggregates and scope-specific synthetic reference event IDs.
2. Finalize version-supported database/broker backup commands and coordinated
   recovery semantics. Review commands before running; do not infer them from
   container tag names alone.
3. Create owner-only staging files, checksums and a versioned manifest. Encrypt
   before off-host transfer. Check temporary capacity and exclude backup files
   from source archives, static hosting and container build contexts.
4. Transfer encrypted output to the approved independent destination. Verify
   checksums there and prove the decryption key is retrievable separately.
5. Restore into a uniquely named isolated environment, new volumes and private
   network. No published DB ports, real DNS, public ingress, outbound email or
   connection to the live broker. Do not reuse the `spectro-staging` Compose
   project or existing volume names. Never run `down --volumes` against staging.
6. Verify PostgreSQL migrations and role boundaries; query restored ClickHouse
   for reference IDs and compare counts to the manifest cutoff. Check event,
   session and issue linkage, not only database health. Verify that queued
   recovery/replay respects the chosen cutoff without unexplained loss or
   duplicated logical events. Use synthetic auth adapters or an explicitly
   configured isolated Auth0 client; do not weaken live authentication.
7. Record bytes, source cutoff, backup/restore duration, checksum/decryption
   results, validation queries, discrepancies and achieved recovery gap. Failed
   or incomplete verification means the gate remains open.
8. Obtain cleanup approval identifying the exact temporary resources. Delete
   only those resources, preserving encrypted backups and the drill record.

## Completion criteria

- A backup exists outside the original host, encrypted and checksum-verified.
- Restore succeeds without depending on the original live data volumes.
- Schema, permissions, control-plane records and event/query linkage pass.
- The accepted-but-not-processed event recovery policy has been exercised.
- Recovery time and recovery-point gap are measured, not assumed.
- Key custody, schedule/retention owner and failure notification are documented.

Until those conditions are met, staging remains a single-host acceptance system,
not a production-ready service with demonstrated disaster recovery.
