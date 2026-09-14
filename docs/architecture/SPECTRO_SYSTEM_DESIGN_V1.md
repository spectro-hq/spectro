# Spectro System Design V1

## Goal

Build the foundation for a digital product observatory that connects technical, experience, behavior, and business signals through one contextual event model.

## Logical architecture

```text
Customer browser
  -> @spectro/browser
  -> POST /v1/envelope
  -> Ingestion API
  -> validation and admission
  -> event processor
  -> ClickHouse event plane

Spectro Console
  -> Spectro API
  -> PostgreSQL control plane + ClickHouse query plane
```

The web console, product API, and ingestion service are separate deployable units. The first implementation uses an injected in-memory event store to prove the protocol-to-storage boundary; this is not a production storage decision.

## Monorepo boundaries

```text
apps/
  web/       authenticated React + Vite console
  api/       product/query API
  ingest/    public high-throughput ingestion edge
packages/
  protocol/  JSON Schema, protocol types, strict validation
  types/     public SDK/product configuration types
  core/      client pipeline, context, queue, transport contracts
  browser/   browser singleton API and fetch transport
services/
  processor/ normalization, fingerprinting, enrichment, event-plane writer port
infra/
  docker/    future local production topology
```

Dependencies point inward: apps and browser depend on core/types/protocol; core depends on types/protocol; protocol has no product or browser dependency.

## Event flow

```text
track()
  -> CaptureInput
  -> normalize JSON values
  -> EventBuilder + Context
  -> SpectroEvent v1
  -> queue
  -> Envelope v1
  -> Transport
  -> Ingestion authentication
  -> strict schema and size validation
  -> admitted envelope boundary
  -> processor
  -> durable event-plane writer
```

Future instrumentation follows the same capture path:

```text
Instrumentation -> Capture -> Context -> Privacy -> beforeSend
  -> Sampling -> Queue -> Batch -> Transport
```

## Storage boundaries

- PostgreSQL: organizations, members, projects, API keys, environments, releases, source maps, dashboards, alert rules, flags, and experiments.
- ClickHouse: accepted event, error, performance, network, behavior, and business signal data.
- Physical ClickHouse tables are decided from query and retention evidence. UI navigation must not dictate physical table boundaries.

## Delivery sequence

1. Monorepo and repository quality gates.
2. `@spectro/protocol`, JSON Schema, validators, and fixtures.
3. `@spectro/types` capture/configuration contracts.
4. `@spectro/core` event builder, context, queue, and transport.
5. `@spectro/browser` public `init`, `track`, and `flush` path.
6. Ingestion admission and replaceable storage port.
7. Processor service and durable event plane. The deterministic processor core and writer port are implemented; durable source and ClickHouse adapters remain.
8. Session/page lifecycle, then error, performance, network, and behavior plugins.
9. Product API and console data surfaces.

## V1 product scope

Browser SDK, error monitoring, performance monitoring, network monitoring, session/behavior context, and unified event exploration. Custom events are captured and queryable from the start. Funnels, retention, experiments, replay, and AI insights remain later milestones.
