# ADR-042: Error issues query V1

Status: accepted  
Date: 2026-09-15

## Context

Spectro already captures privacy-bounded browser errors, assigns their final fingerprint in server-side processing, stores that fingerprint as a typed ClickHouse column, and exposes individual events through an authorized query API. The next product slice needs to turn repeated error events into investigation units without introducing a second identity model or storage topology before real query evidence exists.

## Decision

Add an authorized error-issue list query to the product API and extend event queries with an exact fingerprint filter.

- An issue is the set of error events sharing one non-empty server-generated `error_fingerprint` inside a project, environment, and requested time window.
- The fingerprint is the issue identifier. Client fingerprint hints never become issue identity directly; processor output remains authoritative.
- Require an environment and inclusive epoch-millisecond `from`/`to` window capped at 31 days. Support optional exact release and event-name filters.
- Return issue summary data: fingerprint, latest error name and message, occurrence count, affected session and user counts, first and last seen timestamps, and the latest event, page, and release identifiers when available.
- Order by `(last_seen DESC, fingerprint DESC)` and paginate with an opaque cursor containing both values. The caller keeps `to` fixed while walking pages.
- Query `spectro.events_v1 FINAL`, restrict to `event_type = 'error'` and non-empty fingerprints, and parameterize every caller-controlled value.
- Add an optional exact `fingerprint` filter to `GET /v1/projects/:projectId/events` so the Console can inspect occurrences through the existing validated event response.
- Keep project authorization at the existing API boundary and return the same stable machine-readable error vocabulary.
- Do not add a table, projection, materialized view, issue lifecycle state, assignee, or workflow fields in this slice.

## Alternatives considered

### Persist a mutable issues table now

Rejected because grouping identity already exists and V1 has no product requirement for status, assignment, ownership, or mutation. A mutable control-plane record can be added later without changing fingerprint identity.

### Add a ClickHouse materialized view

Rejected until measured latency and examined-row evidence show that the bounded correctness-first aggregation is insufficient.

### Group by error message or event name

Rejected because volatile values split equivalent failures or merge unrelated ones. Final server fingerprinting already normalizes the relevant error structure.

### Return occurrence events inside every issue row

Rejected because it duplicates the existing event-list contract and makes issue pagination payloads unbounded. Occurrences use the event endpoint with the fingerprint filter.

## Compatibility and consequences

- No Event Protocol, ingestion, processor, or ClickHouse schema change is required.
- Counts are scoped to the requested time window and are not lifetime totals.
- `FINAL`, exact distinct counts, and JSON extraction favor correctness over query speed. Production measurements determine whether later projections are justified.
- Empty-fingerprint errors are excluded because they lack stable grouping identity.
- Issue lifecycle state remains unresolved and is not implied by the aggregation response.

## Migration and rollback

The endpoint and event filter are additive. Rollback removes the issue route and fingerprint query field; event capture, processing, storage, and existing event queries continue unchanged.

## References

- [ADR-013: Server-side error fingerprinting](./SPECTRO_ADR_V1.md)
- [ADR-035: ClickHouse event storage V1](./ADR-035_CLICKHOUSE_EVENT_STORAGE_V1.md)
- [ADR-037: Browser error capture V1](./ADR-037_BROWSER_ERROR_CAPTURE.md)
- [ADR-041: Event query API V1](./ADR-041_EVENT_QUERY_API_V1.md)
