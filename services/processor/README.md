# Processor service

Owns server-side normalization, final error fingerprinting, enrichment, and writes to the durable event plane.

The current slice implements the deterministic processing core, the JetStream admitted-envelope source, and a ClickHouse `ProcessedEventWriter`. A writer resolves `append()` only after the full batch is durably committed; the worker acknowledges the JetStream message afterward and requests delayed redelivery on failure.

ClickHouse starts with one `events_v1` table containing typed common query dimensions and bounded context/payload JSON. Event-type tables, projections, materialized views, TTLs, and larger streaming infrastructure remain deferred until query, retention, throughput, and recovery evidence justify them.

## Pipeline operations

After `pnpm build`, run `pnpm pipeline:status` from the repository root. The command reads the existing JetStream stream and durable consumer and checks ClickHouse with `SELECT 1`; it does not modify either system. It writes one JSON object with `status`, machine-readable `codes`, and a snapshot of stored messages, pending acknowledgements, redeliveries, oldest stored message, and stream capacity. Exit codes are `0` for `ok`, `1` for `degraded`, and `2` for `unavailable`. An external monitor can poll this command without parsing service logs.

The default warning thresholds are 1,000 stored messages, five minutes for the oldest stored message, 10 currently redelivered messages, or 90% of the stream byte limit. Override the first three with `SPECTRO_OPS_MAX_STORED_MESSAGES`, `SPECTRO_OPS_MAX_OLDEST_MESSAGE_AGE_MS`, and `SPECTRO_OPS_MAX_REDELIVERED`; each accepts a non-negative integer. Thresholds are operational defaults, not product sampling or retention policy.

The processor logs a redacted `admission_delivery_failed` record when JetStream emits a max-deliver or terminated advisory for its stream and consumer. Only the stream, consumer, and stream sequence are logged; never copy message payloads into operations logs. These live advisories are not a durable history. A message that reaches `max_deliver` remains in JetStream, so a growing or aging stored-message count is still visible in the snapshot. Investigate the failing dependency and the stream sequence before manually retrying or deleting anything. Do not purge the stream as an automated recovery action.

Ingestion returns HTTP `503` with code `admission_unavailable` if durable append fails; it does not acknowledge the envelope. The browser SDK can then retry the same event IDs. The processor negatively acknowledges failed ClickHouse writes for broker redelivery and emits a redacted `processing_retry_scheduled` record containing only the envelope ID and retry delay. The real-boundary integration test exercises browser acknowledgement loss and deduplication; `pnpm test:integration` also runs the operational smoke tests against local NATS and ClickHouse, including simulated connection failures. Unit tests cover append failure, retry diagnostics, status assessment, and advisory redaction.
