# ADR-041: Event query API V1

Status: accepted  
Date: 2026-09-15

## Context

The first console slice needs a bounded, authorized read path over the event plane. The product API currently exposes only health status, while processed events already converge in the ClickHouse `spectro.events_v1` table. Query semantics must preserve project isolation, avoid unbounded scans, and remain compatible with the accepted protocol and storage decisions without prematurely choosing the production identity provider.

## Decision

Add `GET /v1/projects/:projectId/events` to the independently deployable product API.

- Require an environment and an inclusive epoch-millisecond `from`/`to` window. Limit a request to 31 days.
- Support exact filters for event type, event name, release version, session ID, and page ID.
- Return at most 100 events per page, with a default of 50.
- Order pages by `(timestamp_ms DESC, event_id DESC)` and use an opaque cursor containing both values. Offset pagination is not exposed.
- Query `spectro.events_v1 FINAL` so at-least-once replays are duplicate-free at this correctness-first stage.
- Parameterize every caller-controlled value passed to ClickHouse. SQL structure remains application-owned and static.
- Reconstruct the public event from `context_json`, `payload_json`, and typed identity columns, then validate it against the protocol JSON Schema before returning it. Invalid stored rows fail closed.
- Validate TypeScript-owned HTTP inputs with Zod, consistent with ADR-032. JSON Schema remains the event protocol source of truth.
- Put project authorization behind an injected product-API port. Missing authorization configuration denies every request. A static bearer-token adapter may be used for local development, but does not define the future production identity provider or control-plane schema.
- Return stable, machine-readable HTTP errors without echoing credentials, raw queries, stored payloads, or private validation data.

The response includes each validated event plus bounded processing metadata: processing version, envelope sent time, processed time, and the server-computed error fingerprint when present.

## Alternatives considered

### Offset pagination

Rejected because inserts and replays can shift offsets between requests, producing skipped or duplicated rows, while large offsets become increasingly expensive.

### Query ClickHouse directly from the console

Rejected because it exposes storage credentials and schema, bypasses authorization, and couples the browser application to event-plane topology.

### Reuse ingestion API keys as console identity

Rejected because write admission and human/product authorization are distinct security boundaries. The production identity and membership model remains a control-plane decision.

### Add projections or materialized views now

Rejected until real event-explorer query shapes and volumes demonstrate that the correctness-first `FINAL` query is insufficient.

### Return stored JSON without protocol validation

Rejected because the product API would then silently publish data that violates the shared Event Protocol contract.

## Compatibility and consequences

- No event protocol or ClickHouse schema change is required.
- Clients receive stable cursor semantics but must treat cursor contents as opaque.
- The mandatory time window, maximum range, and page cap bound accidental query cost.
- `FINAL` has a known performance cost. Query latency and examined rows should guide later projections or alternate deduplication queries.
- Local development needs an explicit project/token pair. An absent pair intentionally makes the event route unavailable to callers while health remains available.
- Production authentication can replace the local adapter without changing the store, route contract, or console query shape.

## Migration and rollback

The endpoint is additive. A replacement storage strategy can implement the same query port and cursor contract, with versioned endpoints introduced only if external response semantics change. Rollback removes or disables the route; ingestion and processing continue unaffected because they do not depend on the product API.

## References

- [ADR-016: Keep ingestion independent from the product/query API](./SPECTRO_ADR_V1.md)
- [ADR-032: Use Zod for TypeScript-owned application DTOs](./SPECTRO_ADR_V1.md)
- [ADR-035: ClickHouse event storage V1](./ADR-035_CLICKHOUSE_EVENT_STORAGE_V1.md)
