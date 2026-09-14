# Spectro Stack Evaluation — 2026-09-14

## Decision summary

| Concern                   | Decision                                                  | Boundary                                                                              |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Type checking             | Adopt TypeScript 7                                        | Use the native `tsc` CLI; do not depend on its compiler API in V1.                    |
| Web build                 | Adopt Vite 8 and `@vitejs/plugin-react` 6                 | The console remains a static React SPA.                                               |
| Tests                     | Adopt Vitest 5                                            | Node 22.12 or newer is required.                                                      |
| Lint and format           | Adopt Oxlint and Oxfmt                                    | Both run at the monorepo root and are CI gates.                                       |
| Event protocol validation | Keep JSON Schema Draft 2020-12 + Ajv                      | JSON Schema remains the language-neutral protocol source of truth.                    |
| Application validation    | Introduce Zod only when control-plane DTOs or forms exist | Do not duplicate event protocol schemas in Zod.                                       |
| Client state              | Use Zustand only for genuine cross-route client state     | Local component state stays in React; shareable filter state stays in the URL.        |
| Server state              | Use TanStack Query                                        | Remote data, caching, invalidation, retries, and async lifecycle stay out of Zustand. |
| Field performance         | Use `web-vitals` 6                                        | Google owns Web Vitals algorithms; Spectro owns privacy-safe protocol adaptation.     |

## TypeScript 7

TypeScript 7 is a stable native compiler and language service with materially faster checking. Its 7.0 release does not expose the previous JavaScript compiler API, so Spectro adopts it for CLI checking and declaration emit while avoiding tools that require importing `typescript` programmatically. If a future tool needs the legacy API, install TypeScript 6 through the official side-by-side compatibility package rather than downgrading the project checker.

## Oxc tooling

Oxlint supplies high-signal JavaScript, TypeScript, React, accessibility, import, and Vitest rules without adding ESLint's plugin/runtime graph. Oxfmt supplies one deterministic formatter for TypeScript, TSX, JSON, CSS, Markdown, and YAML. `pnpm verify` checks formatting and lint before type checks, tests, and builds.

## Validation: JSON Schema, Ajv, and Zod

Zod is a good fit for TypeScript-owned application boundaries: control-plane API inputs, form models, URL parameter parsing, and environment configuration. It is not the right replacement for Spectro's event protocol because that protocol must be consumed across languages and already declares JSON Schema as its source of truth.

The recommended hybrid is:

1. JSON Schema + Ajv for SDK/ingestion protocol validation.
2. Zod for future TypeScript-only control-plane and console DTOs.
3. No hand-maintained duplicate schema for the same boundary.
4. If conversion is later needed, test the generated JSON Schema as an artifact; do not rely on experimental JSON-Schema-to-Zod conversion in a critical ingestion path.

Zod is therefore not installed yet: the current API exposes only a health endpoint and has no application DTO to validate.

## State ownership

TanStack Query and Zustand are complementary only when their ownership is explicit:

- TanStack Query owns server state: project lists, issues, event queries, saved views, mutations, cache freshness, retries, and invalidation.
- The router owns shareable navigation state: environment, time range, release, filters, selected issue, and pagination when those values should survive refresh or be linkable.
- React owns component-local interaction state.
- Zustand owns the small residue of real global client state, such as a cross-route command palette, investigation workspace draft, or non-server UI preference.

Do not copy TanStack Query data into Zustand, and do not make Zustand the default home for every filter. Zustand is not installed until the first qualifying global client-state slice exists; TanStack Query is already installed and wired at the console root.

## Field performance

Google's `web-vitals` 6 attribution build measures CLS, FCP, INP, LCP, and TTFB. Spectro registers it once per loaded browser SDK module and maps only bounded primitive attribution fields into the event protocol. DOM nodes, default selectors, browser performance entries, and resource URLs are excluded. Spectro supplements the library with native Long Task and Navigation Timing summaries; Resource Timing remains part of the later network instrumentation decision.
