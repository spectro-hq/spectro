# ADR-035: ClickHouse event storage V1

Status: accepted  
Date: 2026-09-14

## Context

V1 needs one queryable event plane across custom, session, page, error, performance, network, and interaction signals. The system has no production query or retention evidence that justifies separate physical tables per product screen or event type. At-least-once delivery means the same immutable event can be written more than once.

## Decision

Start with one `spectro.events_v1` table using `ReplacingMergeTree(processed_at_ms)`.

- Partition monthly by event time.
- Order by project, environment, event day, event type, event name, and event ID.
- Store event ID as `UUID` and timestamps as epoch-millisecond `UInt64` values with materialized `DateTime64(3, 'UTC')` columns.
- Promote stable, commonly filtered context to typed columns: project, environment, event type/name, SDK, session, user, anonymous user, page, release, trace, tags, and final error fingerprint.
- Preserve the bounded protocol context and event-specific payload as JSON strings for faithful V1 retrieval and later migrations.
- Use one row per processed event, not one row per transport envelope.
- Query paths requiring duplicate-free correctness use `FINAL` initially. Performance-sensitive paths may later use tested `argMax` queries or projections.
- Do not add event-type tables, materialized views, projections, or a TTL until real query and retention evidence exists.
- Processor inserts may use ClickHouse asynchronous inserts only with `wait_for_async_insert = 1`, so a successful writer result means the batch has reached durable storage.

`ReplacingMergeTree` is a replay-convergence mechanism, not an exactly-once claim. Background merging is asynchronous and broker deduplication windows are finite.

## Alternatives considered

### Separate tables by event type

Rejected for V1 because it duplicates common context, couples storage to current navigation, and makes the unified event explorer harder before query evidence exists.

### Raw JSON-only table

Rejected because common filters would repeatedly parse JSON and lose type-specific storage and pruning advantages.

### Fully flattened payload columns

Rejected because event payloads evolve independently and a universal table with dozens of sparse optional fields would reproduce the protocol anti-pattern forbidden by ADR-003.

### Rely only on insert deduplication tokens

Rejected as the permanent idempotency boundary because deduplication history is finite and retries can occur after its window.

## Compatibility and consequences

- The public protocol remains the source of truth and is preserved in `context_json` and `payload_json`.
- Stable columns can serve the first event explorer and issue queries without defining final product-specific aggregates.
- `FINAL` has a query cost; it is accepted for the initial correctness-first slice and must be measured before scale work.
- Replays with the same event identity and immutable event dimensions converge during merges or at query time.
- A conflicting payload that reuses an event ID is invalid producer behavior; future admission conflict detection may quarantine it if evidence requires that protection.

## Migration and rollback

Schema changes are additive where possible. A replacement table is introduced as `events_v2`, backfilled from the preserved JSON and typed columns, dual-written during verification, then selected by the query layer. Rollback switches queries and the writer back to `events_v1`; the JetStream source retains unacknowledged work during writer failure.

## References

- [ClickHouse guidance for ReplacingMergeTree and `FINAL`](https://clickhouse.com/resources/engineering/clickhouse-optimize-table-final)
- [ClickHouse asynchronous insert durability](https://clickhouse.com/docs/optimize/asynchronous-inserts)
