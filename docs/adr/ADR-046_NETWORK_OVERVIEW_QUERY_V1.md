# ADR-046: Network overview query V1

Status: accepted

## Context

The browser SDK already emits privacy-bounded Fetch, XMLHttpRequest, and opt-in Resource Timing events. The Console needs an aggregate view that identifies failing and slow request targets without widening the event protocol or exposing query strings, headers, cookies, or bodies.

## Decision

Expose an authorized `GET /v1/projects/:projectId/network` product API backed by a parameterized ClickHouse query over `events_v1 FINAL`.

- Require `environment`, `from`, and `to`; cap the inclusive window at 31 days.
- Accept exact optional filters for `initiator`, uppercase `method`, `success`, `pagePath`, and `release`.
- Group network events by initiator, method, sanitized URL, and page path.
- Return request, failure, and affected-session counts; average, p75, and p95 duration; 2xx, 3xx, 4xx, 5xx, and transport-failure counts; first/latest evidence; latest status, event ID, and release.
- Order groups by latest evidence, then initiator, method, URL, and page path. Carry the same tuple in an opaque keyset cursor.
- Treat missing response status on an unsuccessful request as a transport failure. Do not infer error categories that the protocol does not capture.
- Drill from a group into the existing event and session evidence rather than introducing a second raw-network detail store.

## Consequences

The query surface remains aligned with the privacy boundary established by ADR-039 and with the authorized, bounded query model in ADR-041. URL grouping operates only on the already-sanitized stored value. High-cardinality targets may produce many groups, so pagination is mandatory and future URL templating requires separate evidence and an ADR.

## Alternatives considered

- Group only by hostname: rejected because the stored sanitized path is essential for locating a failing endpoint.
- Add a dedicated network table or materialized view now: rejected until query volume demonstrates that the shared event table is insufficient.
- Persist request or response bodies for diagnosis: rejected by the protocol privacy contract.

## Compatibility, migration, and rollback

This is an additive product API and requires no event or storage migration. Rollback removes the route and Console surface while leaving existing network events queryable through the event explorer.
