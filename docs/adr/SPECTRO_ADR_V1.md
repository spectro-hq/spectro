# Spectro Architecture Decision Records V1

Status: accepted unless marked open.

| ID      | Decision                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-001 | Use a pnpm TypeScript monorepo.                                                                                                                        |
| ADR-002 | Use one contextual event model across observability and analytics.                                                                                     |
| ADR-003 | Keep a stable common envelope and event-specific payloads.                                                                                             |
| ADR-004 | Treat JSON Schema as the cross-language protocol source of truth.                                                                                      |
| ADR-005 | Version transport envelopes and events independently.                                                                                                  |
| ADR-006 | Use Unix epoch milliseconds for event time.                                                                                                            |
| ADR-007 | Use UUIDv7 event identifiers.                                                                                                                          |
| ADR-008 | Require snake_case event names with a 64-character maximum.                                                                                            |
| ADR-009 | Keep authentication credentials outside event payloads.                                                                                                |
| ADR-010 | Make project and environment required context.                                                                                                         |
| ADR-011 | Make sessions and page lifecycles first-class context.                                                                                                 |
| ADR-012 | Support anonymous and identified users while bounding repeated traits.                                                                                 |
| ADR-013 | Perform final error fingerprinting in server-side processing.                                                                                          |
| ADR-014 | Apply privacy filtering before sampling and transport.                                                                                                 |
| ADR-015 | Batch events in transport envelopes.                                                                                                                   |
| ADR-016 | Keep ingestion independent from the product/query API.                                                                                                 |
| ADR-017 | Use PostgreSQL for the control plane and ClickHouse for the event plane.                                                                               |
| ADR-018 | Do not introduce Kafka until throughput and durability evidence requires it.                                                                           |
| ADR-019 | Reserve trace context without coupling V1 to OpenTelemetry.                                                                                            |
| ADR-020 | Build browser capabilities as plugins around a small core pipeline.                                                                                    |
| ADR-021 | Keep protocol/core packages free of browser-only dependencies.                                                                                         |
| ADR-022 | Capture custom events from the first release through `track()`.                                                                                        |
| ADR-023 | Enforce bounded events and envelopes before persistence.                                                                                               |
| ADR-024 | Defer replay, funnels, retention, experimentation, and AI insights.                                                                                    |
| ADR-025 | Keep repository licensing open until SDK/protocol and platform licenses are intentionally chosen.                                                      |
| ADR-026 | Build the authenticated Spectro Console as a React + Vite SPA; a future public site may use Next.js separately.                                        |
| ADR-027 | Use Tailwind + Radix/shadcn as UI foundations; Spectrum UI is selectively adapted source/reference, never the runtime design system.                   |
| ADR-028 | Motion explains state; it does not decorate state.                                                                                                     |
| ADR-029 | Use the stable TypeScript 7 native CLI for type checking and declaration emit; avoid compiler-API dependencies in V1.                                  |
| ADR-030 | Use Oxlint and Oxfmt as repository-wide lint and formatting gates.                                                                                     |
| ADR-031 | Use Vite 8, `@vitejs/plugin-react` 6, Vitest 5, and Node.js 22.12 or newer.                                                                            |
| ADR-032 | Keep JSON Schema + Ajv for the cross-language event protocol; reserve Zod for future TypeScript-owned application DTOs.                                |
| ADR-033 | Keep server state in TanStack Query, shareable filter state in the router, local state in React, and use Zustand only for genuine global client state. |
| ADR-034 | Use NATS JetStream as the V1 durable admission source with pull consumption, explicit acknowledgements, and at-least-once delivery.                    |
| ADR-035 | Store processed V1 events in one ClickHouse `ReplacingMergeTree` table with typed common dimensions and bounded JSON payload/context columns.          |
| ADR-036 | Use tab-scoped browser sessions with 30-minute inactivity rotation and a new page lifecycle for initial load and every client-side route transition.   |
| ADR-037 | Capture bounded structured browser errors without raw stacks or arbitrary object serialization; retain final fingerprinting on the server.             |
| ADR-038 | Use Google's `web-vitals` for standard field metrics behind a privacy-safe singleton bridge, supplemented by bounded native timing signals.            |
| ADR-039 | Capture privacy-bounded Fetch and XMLHttpRequest signals through shared reversible wrappers; keep Resource Timing opt-in until sampling exists.        |
| ADR-040 | Capture only explicitly marked clicks and form submissions with bounded target metadata; exclude content, values, and generated selectors.             |
| ADR-041 | Expose bounded, authorized event queries through the product API using parameterized ClickHouse SQL and stable keyset cursors.                         |
| ADR-042 | Aggregate error issues by server fingerprint in bounded authorized queries and reuse event queries for occurrence drill-down.                          |
| ADR-043 | Store issue lifecycle state in PostgreSQL and join it onto ClickHouse-derived issue aggregates in the product API.                                     |
| ADR-044 | Record lifecycle transitions and manage PostgreSQL control-plane schema with ordered, ledger-backed SQL migrations.                                    |
| ADR-045 | Aggregate bounded performance signals by metric and page through an authorized ClickHouse query with stable keyset pagination.                         |

Detailed records:

- [ADR-034: Durable admission with NATS JetStream](./ADR-034_DURABLE_ADMISSION_JETSTREAM.md)
- [ADR-035: ClickHouse event storage V1](./ADR-035_CLICKHOUSE_EVENT_STORAGE_V1.md)
- [ADR-036: Browser session and page lifecycle](./ADR-036_BROWSER_SESSION_PAGE_LIFECYCLE.md)
- [ADR-037: Browser error capture V1](./ADR-037_BROWSER_ERROR_CAPTURE.md)
- [ADR-038: Browser performance capture V1](./ADR-038_BROWSER_PERFORMANCE_CAPTURE.md)
- [ADR-039: Browser network capture V1](./ADR-039_BROWSER_NETWORK_CAPTURE.md)
- [ADR-040: Browser interaction capture V1](./ADR-040_BROWSER_INTERACTION_CAPTURE.md)
- [ADR-041: Event query API V1](./ADR-041_EVENT_QUERY_API_V1.md)
- [ADR-042: Error issues query V1](./ADR-042_ERROR_ISSUES_QUERY_V1.md)
- [ADR-043: Issue lifecycle control plane](./ADR-043_ISSUE_LIFECYCLE_CONTROL_PLANE.md)
- [ADR-044: Issue lifecycle history and migrations](./ADR-044_ISSUE_LIFECYCLE_HISTORY_AND_MIGRATIONS.md)
- [ADR-045: Performance overview query V1](./ADR-045_PERFORMANCE_OVERVIEW_QUERY_V1.md)

## Change rule

Changes to accepted decisions require a new dated ADR that names the superseded decision, alternatives considered, compatibility impact, migration plan, and rollback strategy.
