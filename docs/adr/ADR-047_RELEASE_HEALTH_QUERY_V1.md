# ADR-047: Release health query V1

Status: accepted

## Context

Release context already accompanies accepted events. Developers need to see whether errors, poor field performance, or network failures cluster around a version without introducing a synthetic score or a separate release telemetry model.

## Decision

Expose an authorized `GET /v1/projects/:projectId/releases` product API backed by a parameterized ClickHouse query over `events_v1 FINAL`.

- Require `environment`, `from`, and `to`; cap the inclusive window at 31 days.
- Exclude events without a release version and group the remaining signals by exact `release_version`.
- Return event, error, affected-session, poor-performance, and network-failure counts plus first/latest evidence and the latest event ID.
- Order releases by latest evidence and version, and carry that tuple in an opaque keyset cursor.
- Do not combine heterogeneous signals into a health score or infer deployment boundaries from event timestamps.
- Drill into the existing Events, Issues, Performance, and Network surfaces using the exact release filter.

## Consequences

Release health stays an evidence index over the shared event plane. A version with more traffic may naturally have more signals, so the Console shows both counts and explicit rates where a valid denominator exists. Deployment metadata, adoption curves, and release comparison windows remain future control-plane work.

## Alternatives considered

- Compute a single release health score: rejected because weights would imply unsupported semantics across errors, performance, and network signals.
- Add a release-specific event table: rejected until query evidence requires a projection or materialized view.
- Infer deployments from the first event for a version: rejected because first observation is not a reliable deployment timestamp.

## Compatibility, migration, and rollback

This is an additive product API and requires no event or storage migration. Rollback removes the route and Console surface while release-filtered evidence remains available through existing queries.
