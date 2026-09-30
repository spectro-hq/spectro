# ADR-051: Bounded live event observation

Status: accepted

Date: 2026-09-30
Accepted: 2026-10-01

## Context

The owner confirmed that Live serves SDK connection verification and live troubleshooting, not a metrics dashboard. Pausing freezes the displayed list while observation continues into a bounded buffer. Existing event queries use occurrence-time ordering (ADR-041); simply refreshing them can hide late delivery of older events, including SDK outbox recovery.

## Decision

Add an authorized, bounded observation query to the product API over the existing ClickHouse event plane. Keep the Event Protocol, ingestion, and processor deployment boundaries unchanged.

- Observe processed events, not raw ingestion or NATS messages. Display occurrence time separately from processing time; processing time is not a durable admission offset or a guaranteed visibility timestamp.
- Initially poll while the page is visible, targeting a three-second interval after successful completion, with no overlapping requests. The UI states the refresh cadence rather than promising instantaneous delivery.
- Require project/environment scope and the same hosted membership authorization as existing event queries on every request. Support exact type, event name, and session filters. Browser write keys do not grant read access.
- Use a bounded processing-time window, deterministic `(processed_at_ms, event_id)` ordering, parameterized SQL, protocol-validated responses, and scoped/versioned cursors. Do not change the existing historical event cursor contract.
- Revisit an overlapping processing-time window and deduplicate by event ID to cover ordinary delayed visibility and replay. Do not claim this makes observation lossless: writes can become visible after an overlap expires, and processor replay can change processing metadata.
- Bound query rows, pagination work, retained rows, and retained payload bytes. Use at most 100 rows/2 MiB per page, five pages/8 MiB per observation update, and 500 rows/8 MiB UTF-8 serialized items shared by displayed and pending buffers. Selection retains one additional protocol-bounded event snapshot. Query execution is capped at two seconds, two million read rows, and 256 MiB scanned data, failing closed rather than returning partial results.
- Pausing freezes the list and selected detail while retaining new matching events within those bounds. Offer an explicit new-events action. Keep selected detail stable; never silently replace it with the latest event.
- Report buffer eviction and interrupted observation honestly. A long absence starts a fresh observation window with an explicit gap notice, rather than attempting unlimited catch-up. Keep Events available for bounded historical investigation.
- Stop polling in hidden tabs; distinguish hidden-tab suspension from the user's list pause. Retry transient failures with bounded backoff. Stop on expired authentication or lost permission, and clear data when scope or user changes.
- Persist no telemetry payloads to browser storage. URL state may contain scope and filters; local React state owns presentation and TanStack Query owns requests.

## Alternatives

### Refresh occurrence-time event queries

Smallest change, but the wrong observation semantics for delayed SDK delivery. Keep these queries for Events and history.

### Server-sent events over repeated storage queries

Would still require the same delayed-visibility and query-cost policy while adding long-lived connection, proxy timeout, and authorization-renewal behavior. Defer until polling measurements justify it.

### Fan out NATS admissions to Console browsers

Introduces a separate read path before normalization/persistence and new authorization, replay, and retention boundaries. Defer a durable streaming design until lossless subscription is an explicit requirement.

## Acceptance evidence required

- Tenant/environment isolation, expired sessions, malformed and cross-scope cursors, bounded query work, and failure responses.
- Older occurrence time with recent processing time; timestamp ties; duplicate IDs and replay; delayed visibility inside and outside overlap.
- Real ClickHouse/API integration, not only mocked query results.
- Pause/resume, stable selection, payload-byte caps, eviction notices, visibility changes, reconnect gaps, and filter/scope changes.
- Desktop, narrow-screen, keyboard, light/dark, and reduced-motion checks against the selected Live surface contract.

## Compatibility, migration, and rollback

This extends ADR-041 without replacing its historical query semantics. No protocol or storage migration is proposed. If measurements show that processing-time queries need a new index or storage model, record that decision before introducing it. Disable the Live route and navigation entry to roll back; event capture, persistence, and historical queries remain available.

## Initial policy and validation

The initial server horizon and client overlap are 60 seconds. An explicitly paginated snapshot is limited to five minutes and its cursor binds project, environment, window, and all exact filters. Successful observation targets three-second polling; transient retries exponentially back off to at most 30 seconds. More than 60 seconds without a successful observation restarts at the recent server window and produces a gap notice. Neither processing timestamps nor this finite overlap guarantee losslessness.

Real ClickHouse/API integration verifies 120 timestamp-tied late events across two pages, replay convergence, project/environment isolation, and cursor scope. Unit tests verify validation, hosted session/permission checks, scan settings, protocol failure, byte/page/row caps, deduplication, frozen paused rows, explicit reveal, and reconnect horizon. The measured local query path completes within its bounded test deadline; this is not a production-load capacity claim. Larger-scale processing-time scans may hit these limits because the current table is occurrence-time ordered; a new index or storage model requires a separate ADR.

Full repository formatting, lint, type checks, unit tests, and builds pass. The separate real ClickHouse/API test passes. Browser checks against an isolated loopback fixture verify grouped arrivals, 12 frozen rows with four pending events, explicit reveal to 16 rows with stable selection, disabled zero-pending action, distinct 400/503 recovery copy, and keyboard detail-tab navigation. Desktop, dark, 390px, and 320px captures are recorded; at the minimum viewport the usable and document widths both equal 310px, and mobile rows retain 44px targets.

The independent finish verdict resolves the six implementation findings. Hero comparison passes at 79%; the automated responsive comparison at 1440px remains a failed measurement (75.58%, with hard vetoes). Its normalized crops flag displaced native-layout regions and protocol-valid content differences as missing or contradicted, while the reviewer confirms those elements are present. After two fix rounds, the owner explicitly agreed on 2026-10-01 to retain native responsive sizing and record a comparison-gate exception. The supported build-phase command closed responsive by that recorded exception, not by a passing score. The final independent verdict is ship within the original seven-finding scope: all six implementation findings and the workflow/documentation finding are resolved. The supported finish command records review closure and that disposition. This approval is limited to Live's comparison workflow; it neither changes the global design system nor certifies production capacity or constitutes another whole-surface review.
