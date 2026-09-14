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

Detailed records:

- [ADR-034: Durable admission with NATS JetStream](./ADR-034_DURABLE_ADMISSION_JETSTREAM.md)
- [ADR-035: ClickHouse event storage V1](./ADR-035_CLICKHOUSE_EVENT_STORAGE_V1.md)
- [ADR-036: Browser session and page lifecycle](./ADR-036_BROWSER_SESSION_PAGE_LIFECYCLE.md)

## Change rule

Changes to accepted decisions require a new dated ADR that names the superseded decision, alternatives considered, compatibility impact, migration plan, and rollback strategy.
