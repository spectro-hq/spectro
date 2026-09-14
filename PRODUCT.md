# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed: pnpm TypeScript monorepo; React + Vite for the authenticated console; Fastify for the API and ingestion services; PostgreSQL for control-plane data and ClickHouse for event data when persistence is introduced. The console uses TanStack Router and Query, Tailwind CSS, Radix/shadcn foundations, selective source adoption from Spectrum UI, and ECharts for data visualization.

## Users

The V1 primary user is a frontend developer investigating errors, performance regressions, network failures, session context, and release impact. Secondary users are product managers, product/data analysts, and engineering or product leads who connect user behavior and business outcomes to technical signals.

## Product Purpose

Spectro is a digital product observatory that connects technical health, user experience, user behavior, and business outcomes. It begins as frontend observability and grows into product analytics, experimentation, and product intelligence without replacing its foundational event model.

## Positioning

Spectro uses one contextual signal model across observability and analytics. When context exists, a signal is not shown in isolation: errors, performance, network activity, behavior, sessions, releases, users, and business events can be investigated as one causal timeline.

## Operating Context

Customer web applications send events through `@spectro/browser` to an independent ingestion service. Authenticated teams investigate projects and environments through a high-interaction console, changing time range, release, browser, device, and other filters while drilling from aggregates into issues, sessions, and individual events.

## Capabilities and Constraints

- V1 domains: browser SDK, errors, performance, network, sessions/behavior, and a unified event explorer.
- `track()` and custom events exist from the first release so later funnels, retention, and experiments grow from the same event protocol.
- The stable protocol is a common event envelope with typed payloads, transport envelope versioning, Unix epoch millisecond timestamps, snake_case event names, and contextual namespaces.
- JSON Schema is the cross-language protocol source of truth. SDK validation is best-effort; ingestion validation is strict.
- Web, API, and ingestion are independently deployable. The console is a static SPA and does not become an application server.
- Privacy defaults exclude passwords, authorization headers, cookies, input values, request/response bodies, and DOM snapshots.
- Licensing is deliberately undecided. Do not add a repository-wide license until the SDK/protocol and platform licensing strategy is confirmed.
- NATS JetStream is the V1 durable admission source, and processed events begin in one ClickHouse table with typed common dimensions plus bounded JSON payload/context columns.
- Open decisions include production sampling defaults, event retention policy, and the platform source-available license.

## Brand Commitments

The product name is Spectro. The product world is “Digital Observatory / 数字观测站.” The established positioning lines are “From Signals to Better Products” and “See the full spectrum of your product.” The operating product should feel precise, restrained, modern, and signal-led: roughly 90% quiet and 10% signal. Motion explains state; it does not decorate state.

## Evidence on Hand

The product and architecture decisions were confirmed in the shared planning conversation supplied by the owner. No customer testimonials, production benchmarks, pricing, legal license text, or production telemetry exist yet; future work must not fabricate them.

## Product Principles

1. Never show a signal without its context when context is available.
2. Keep one event and context model across technical, experience, behavior, and business domains.
3. Separate capture, transport, ingestion, processing, storage, and query responsibilities.
4. Privacy and bounded payloads are protocol-level defaults, not optional cleanup.
5. Start with the smallest vertical slice and evolve infrastructure only from measured need.

## Accessibility & Inclusion

The console must support keyboard operation, visible focus, reduced motion, semantic structure, and readable high-density data presentation. Decorative motion must never be required to understand state.
