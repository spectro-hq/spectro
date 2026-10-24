# Coordinated checkpoint component restore: 2026-10-24

Operator confirmed staging business acceptance before this drill. All recovery
operations were local to OrbStack; no SSH, public ingress, published ports or
connection to live databases, broker or Auth0 was used.

## Input and successful run

- Encrypted checkpoint: `checkpoint-20261018T052707Z-aQpYBb`.
- Operator unseal report: `unseal-zHKFZU`; outer ciphertext and expected internal
  file checksums passed. Original input volume mounted read-only for recovery.
- Script: `scripts/staging-checkpoint-local-restore.mjs`.
- Passing result: `.local/checkpoint-restore-75a3b5b7/result.json` (ignored).
- Resource inventory: that report directory's `resources.json`.
- Four fresh, uniquely named containers, all network `none`, no published ports.
  Original input volume was not changed. Restored volumes and private helper work
  volume remain protected for explicit cleanup; all four containers stopped.

The helper extracts archived configuration only into a new local volume. It does
not source `.env` or run archived Compose. Generated hexadecimal database/broker
passwords are validated and consumed inside containers, not printed in reports.
Captured command errors are suppressed rather than exposing private SQL/data.

## Verified boundaries

### PostgreSQL 18.6

Cluster-global roles restored into a new cluster with a separate drill bootstrap
administrator, then the custom database dump restored with ownership/ACL intact.
Database-level CONNECT/PUBLIC restrictions were recreated explicitly because the
original database-only dump does not restore database creation/ACL semantics.

- Seven migration ledger entries; zero unvalidated foreign keys.
- Real loopback TCP login succeeds with recovered admin/API/ingestion passwords.
- Bootstrap explicitly uses SCRAM for TCP; incorrect API password rejected.
- Ingestion key reads succeed; private console-user reads and no-op key writes
  denied. These are actual login/statement checks, not only role metadata.
- Restored project/environment identifiers used to check ClickHouse scope links.

### ClickHouse 26.3.33.24

- Actual checkpoint DDL and all 24 stored columns restored from Native format.
- Latest-version selection uses the ReplacingMergeTree key; same-key/same-version
  conflicting content is rejected rather than choosing an arbitrary winner.
- Restored FINAL count is 770, matching both the checkpoint count and the
  Native reference's version-selected count.
- Sorted canonical tuples of exported stored columns match byte-for-byte via
  SHA256: `3591eb279e5b1debf564d904363988570424cd80ff21da111968540f1767d58b`.
- Every event project/environment scope exists in the restored PostgreSQL data.
- API SELECT and processor credentials verified after recreating documented
  grants from checkpoint passwords. Bad API password rejected; processor SELECT
  and API INSERT denied. ClickHouse users/grants themselves were not exported.

### NATS 2.14.6

- Cold archive loaded into a new volume before starting the broker with recovered
  configuration and private environment values. No application worker attached.
- `SPECTRO_ADMITTED` and durable `spectro-processor-v1` are present.
- Stored, pending and ack-pending messages are zero; last/acknowledged stream
  position remains 289, matching checkpoint metadata.
- Both recovered ingestion and processor passwords authenticate using loopback
  CONNECT/PING probes; an incorrect password is rejected. No messages published.
- Monitoring queried only through container exec on its loopback address, as
  described by the [official monitoring documentation](https://docs.nats.io/learn/monitoring/monitoring-endpoints).

## Failed attempts retained

Earlier report directories `e866149b`, `9a6cfe47` and `221f64af` under
`.local/checkpoint-restore-*` remain FAIL, not retroactively rewritten.
The first stopped during authentication validation; the final bootstrap explicitly
enforces TCP password authentication. A subsequent ClickHouse startup exhausted
the initial local PID/thread budget (confirmed through classified error logs).
The next reached content comparison but the canonical reference still used the
unbounded default local thread-pool settings. Final code raises the local PID
budget and bounds the reference background pool. Successful run used fresh
volumes. Failed-run containers were stopped and retained; no source data altered.

## Result and limits

PASS for this checkpoint's component restore, stored-event content, recovered
credential/grant boundaries, cross-database project/environment linkage and empty
broker cold-state recovery. This is not full application disaster recovery:

- No restored API/processor application startup, real Auth0 flow, fresh event
  processing or issue/session aggregation through the application query layer.
- No nonempty cold-broker recovery; previous synthetic pending/in-flight and
  write-before-ack drills remain separate evidence, not substitutes for this case.
- No exact PostgreSQL source-cutoff row checksum baseline was captured.
- Materialized-column equivalence and all permissions/constraints are not fully
  exhaustively compared. Configuration copying is not proof of certificate or
  external identity-provider recovery.
- No complete application RPO/RTO measurement or automated backup/retention policy.

Next: commit the bounded recovery helpers/records independently of frontend work;
decide the remaining application-level recovery scope before deleting protected
server exports or any local sensitive volumes. Cleanup requires exact targets and
explicit approval, preserving encrypted checkpoints and independent key custody.
