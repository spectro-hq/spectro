# Spectro Engineering Constitution

This file applies to the entire repository. Product truth lives in `PRODUCT.md`; architecture decisions live under `docs/adr/`.

## Required reading

Before changing architecture, protocol, SDK public APIs, identity/session semantics, package boundaries, storage technology, or deployment topology, read:

- `PRODUCT.md`
- `docs/architecture/SPECTRO_SYSTEM_DESIGN_V1.md`
- `docs/protocol/SPECTRO_PROTOCOL_SDK_V1.md`
- `docs/adr/SPECTRO_ADR_V1.md`

Any material departure requires a new ADR before implementation. Do not silently rewrite an accepted decision.

## Invariants

1. The Event Protocol is the contract shared by SDKs, ingestion, processing, storage, and query layers.
2. JSON Schema is the cross-language protocol source of truth; TypeScript types must stay synchronized.
3. A stable common envelope wraps event-specific payloads. Do not build a universal object with dozens of optional fields.
4. Envelope and event versions evolve independently.
5. Event timestamps are Unix epoch milliseconds.
6. Event names use `^[a-z][a-z0-9_]{0,63}$`.
7. API keys travel in transport headers, never inside events.
8. Project and environment are required event context.
9. Session and page IDs are first-class context; a route transition creates a new page lifecycle.
10. Identity supports anonymous and identified users without forcing PII into every event.
11. User traits are not copied unboundedly into every event.
12. Final error normalization and fingerprinting belong to server-side processing.
13. SDK capture is best-effort and must never crash the host application.
14. Privacy filtering happens before sampling, buffering, and transport.
15. Passwords, input values, authorization, cookies, and request/response bodies are not collected by default.
16. Payload size, string length, collection length, and nesting depth are bounded.
17. Browser instrumentation is implemented as plugins around a small core pipeline.
18. Plugins depend inward on public contracts; core never depends on browser plugins.
19. Web, API, ingestion, and processor remain independently deployable.
20. PostgreSQL is the control plane; ClickHouse is the event/analytics plane once persistence is introduced.
21. Do not introduce Kafka, OpenTelemetry coupling, replay, experiments, funnels, or AI features before their milestone justifies them.
22. The console is React + Vite, not a Next.js application server. A future public site may choose Next.js independently.
23. Server state belongs in TanStack Query, URL state in the router, local UI state in React, and only genuine global client state in Zustand.
24. Spectrum UI is an approved source/reference for adapted Level 1–2 components, not a runtime foundation or the owner of domain components.
25. Motion explains state; it does not decorate state.

## TypeScript and packages

- TypeScript 7 is the repository checker; do not introduce tooling that requires the removed legacy compiler API without an ADR.
- Oxlint and Oxfmt are the lint and formatting authorities. Run `pnpm lint` and `pnpm format` rather than adding parallel ESLint or Prettier configurations.
- Use strict TypeScript; avoid `any`, unchecked casts, and implicit public return types.
- Keep package public surfaces in `src/index.ts`; do not import another package's private paths.
- Prefer small pure functions and dependency injection at I/O boundaries.
- Use `workspace:*` for internal dependencies.
- Keep browser-only code out of protocol and core packages.
- Do not add a dependency when the platform or a small local implementation is sufficient.

## Validation, privacy, and failure behavior

- Ingestion rejects malformed envelopes atomically and returns a stable machine-readable error.
- SDK methods degrade safely and expose failures through controlled results/hooks rather than uncaught exceptions in the customer page.
- Never log API keys, raw sensitive headers, or rejected private payloads.
- Enforce the documented 64 KiB single-event and 1 MiB envelope limits before persistence.

## Tests and Definition of Done

Every change must have tests at the narrowest useful layer. A feature is done only when:

- formatting/type checks, unit tests, and builds pass;
- protocol changes include valid and invalid fixtures;
- a vertical slice has an integration test across its real boundaries;
- public exports and docs match behavior;
- privacy and failure paths are tested;
- architecture changes include an ADR;
- unrelated user changes remain untouched.
