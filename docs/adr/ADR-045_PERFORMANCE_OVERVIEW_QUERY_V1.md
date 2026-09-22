# ADR-045: Performance overview query V1

Status: accepted

Date: 2026-09-21

## Context

Spectro captures Web Vitals and other bounded browser performance events, but operators can currently inspect them only as individual events. The Console needs a bounded overview that reveals affected pages and releases while preserving drill-down into the existing event and session investigation paths.

## Decision

- Add `GET /v1/projects/:projectId/performance` to the authorized product API.
- Require environment and an inclusive epoch-millisecond `from`/`to` window capped at 31 days. Support exact metric, page path, and release filters.
- Aggregate performance events by metric and page path. Return sample count, affected session count, average, p75, p95, rating counts, first and last seen timestamps, and the latest event and release identifiers.
- Include only payloads whose metric, value, unit, and optional rating conform to the accepted performance protocol vocabulary. Do not infer ratings server-side.
- Order by `(last_seen DESC, metric DESC, page_path DESC)` and use an opaque keyset cursor containing those values. Return at most 100 groups per page.
- Query `spectro.events_v1 FINAL` and parameterize every caller-controlled value. Keep the existing single event table; do not introduce a materialized view or performance-specific table without measured query evidence.
- Reuse the existing project authorization boundary and stable machine-readable error vocabulary.
- Use the existing event endpoint for occurrence drill-down with exact performance event-name, page, release, and time filters where applicable.

## Alternatives

- Client-side aggregation was rejected because a loaded event page is incomplete and would produce misleading percentiles.
- A materialized view was rejected until production latency and examined-row measurements justify it.
- A single cross-metric percentile was rejected because CLS scores and millisecond metrics are not comparable.
- Server-generated Web Vital ratings were rejected because captured library semantics are authoritative and thresholds may evolve independently.

## Compatibility and consequences

The endpoint is additive and requires no protocol or storage migration. Percentiles and counts describe the requested query window, not lifetime behavior. Groups without page context use an empty page path and are labeled accordingly by clients.

## Migration and rollback

Rollback removes or disables the endpoint. Capture, ingestion, storage, and individual event queries continue unchanged.

## References

- [ADR-035: ClickHouse event storage V1](./ADR-035_CLICKHOUSE_EVENT_STORAGE_V1.md)
- [ADR-038: Browser performance capture V1](./ADR-038_BROWSER_PERFORMANCE_CAPTURE.md)
- [ADR-041: Event query API V1](./ADR-041_EVENT_QUERY_API_V1.md)
