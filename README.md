# Spectro

Spectro is a digital product observatory that connects technical health, user experience, behavior, and business outcomes.

The current milestone establishes the protocol-first monorepo and a durable event-plane vertical slice:

```text
track -> SpectroEvent -> Envelope -> ingestion -> JetStream -> processor -> ClickHouse
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

See `PRODUCT.md`, `AGENTS.md`, and `docs/` before changing protocol or architecture. The current tool and state-management evaluation is recorded in `docs/architecture/STACK_EVALUATION_2026-09-14.md`.
