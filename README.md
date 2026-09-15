# Spectro

Spectro is a digital product observatory that connects technical health, user experience, behavior, and business outcomes.

The current milestone provides the protocol-first monorepo, browser lifecycle, error, performance, network, and explicit interaction capture, a durable event-plane vertical slice, and the first authorized event query API:

```text
browser lifecycle/error/performance/network/interaction/custom track -> SpectroEvent -> Envelope -> ingestion -> JetStream -> processor -> ClickHouse
                                                                                                             -> product API event query
```

## Commands

```bash
pnpm install
pnpm verify
pnpm infra:up
pnpm test:integration
pnpm dev
```

Use `pnpm format` and `pnpm lint:fix` for automated Oxc formatting and safe lint fixes. The supported runtime is Node.js 22.12 or newer.

`pnpm infra:down` stops the local data plane without deleting its named volumes.

The Console development server binds strictly to `http://localhost:5174`; `/v1` requests proxy to the product API on port 4400.

See `PRODUCT.md`, `AGENTS.md`, and `docs/` before changing protocol or architecture. Product API query usage is documented in `apps/api/README.md`; the current tool and state-management evaluation is recorded in `docs/architecture/STACK_EVALUATION_2026-09-14.md`.
