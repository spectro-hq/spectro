# Product API

The product API owns authorized read access to Spectro data. Its current query surfaces are:

```http
GET /v1/projects/:projectId/events
GET /v1/projects/:projectId/issues
PATCH /v1/projects/:projectId/issues/:fingerprint
GET /v1/projects/:projectId/issues/:fingerprint/history
GET /v1/projects/:projectId/performance
GET /v1/projects/:projectId/network
GET /v1/projects/:projectId/live
```

Historical list endpoints require `environment`, `from`, and `to`; timestamps are inclusive Unix epoch milliseconds and a query window is capped at 31 days. `limit` defaults to 50 and is capped at 100. Use the opaque `nextCursor` response value as `cursor` for the next page.

## Live observation

Live observes **processed** events, not ingestion acknowledgements. It requires the same project/environment read permission as Events. `environment` is required; optional exact `type`, `name`, and `sessionId` filters apply. Omitted `from`/`to` select the last 60 seconds of server processing time. Explicit windows are capped at five minutes, with at most five seconds of future clock tolerance. Unknown filters and malformed values return `400 invalid_query`.

Each response contains `data`, `from`, `to`, `observedAt`, and optional `nextCursor`. Drain subsequent pages using the returned fixed `from`/`to`, unchanged scope/filters, and cursor. Ordering is descending `(processed_at_ms, event_id)`, independently of occurrence time. A page has at most 100 protocol-validated events and a 2 MiB serialized response budget. All requests recheck authorization and use `Cache-Control: no-store`. Query execution is capped at two seconds, two million read rows, and 256 MiB of scanned data; exceeding a cap fails closed with `503 query_unavailable`, not partial success or private storage diagnostics.

The Console targets a three-second poll cadence, rechecks a 60-second overlap, deduplicates IDs, and drains at most five pages/8 MiB per update. This is bounded, best-effort observation, **not lossless streaming**. Long disconnections, delayed storage visibility beyond overlap, or load limits may miss arrivals; Events remains the historical investigation path. See [ADR-051](../../docs/adr/ADR-051_LIVE_EVENT_OBSERVATION.md).

The event list accepts optional exact filters for `type`, `name`, `release`, `sessionId`, `pageId`, and the server-generated 32-character hexadecimal `fingerprint`. The issue list groups error events by that fingerprint inside the selected project, environment, and time window; it accepts optional exact `name`, `release`, and lifecycle `status` filters. Each issue reports occurrence, affected-session, and affected-user counts plus first/latest evidence and its PostgreSQL-backed lifecycle status.

The performance list groups field measurements by metric and page path. It accepts optional exact `metric`, `pagePath`, and `release` filters and reports sample and affected-session counts, average, p75, p95, rating distribution, first/latest evidence, and the latest release. Its opaque cursor orders groups by latest evidence, metric, and page path.

The network list groups privacy-sanitized requests by initiator, method, URL, and page path. It accepts optional exact `initiator`, `method`, `success`, `pagePath`, and `release` filters and reports request, failure, session, duration-percentile, response-class, and transport-failure counts. Query strings, credentials, headers, and bodies are never part of this surface.

Send an authorized PATCH body such as `{ "environment": "production", "status": "resolved" }` to change lifecycle state. Accepted statuses are `open`, `resolved`, and `ignored`. The bounded history endpoint requires `environment` and accepts `limit`. In hosted mode, the authenticated Console user becomes the history actor.

Local development intentionally denies event access until a project and bearer token are configured:

```bash
SPECTRO_AUTH_MODE=local \
SPECTRO_API_LOCAL_PROJECT_ID=prj_local \
SPECTRO_API_LOCAL_TOKEN=local-secret \
pnpm --filter @spectro/api dev
```

Then query the local API without putting credentials in the URL or event payload:

```bash
curl --get http://localhost:4400/v1/projects/prj_local/events \
  --header 'Authorization: Bearer local-secret' \
  --data-urlencode environment=development \
  --data-urlencode from=1789368000000 \
  --data-urlencode to=1789368060000
```

Replace `events` with `issues`, `performance`, or `network` to query the corresponding aggregate using the same authorization and time-window contract.

`SPECTRO_CLICKHOUSE_URL`, `SPECTRO_CLICKHOUSE_USER`, `SPECTRO_CLICKHOUSE_PASSWORD`, and `SPECTRO_CLICKHOUSE_DATABASE` override the local ClickHouse defaults. The static bearer-token adapter requires `SPECTRO_AUTH_MODE=local` and cannot run with `NODE_ENV=production`. With no mode selected outside production, product access is denied.

`SPECTRO_POSTGRES_URL` overrides the local PostgreSQL connection used for issue lifecycle state.

Apply ordered control-plane migrations before starting a deployed API or after pulling schema changes:

```bash
pnpm --filter @spectro/api migrate
```

Migrations `003_auth_control_plane.sql` and `004_oidc_login_attempts.sql` add the hosted SaaS identity, organization, project, environment, Console session, and one-time OIDC login-transaction tables from ADR-050.

Hosted mode requires `SPECTRO_AUTH_MODE=hosted`, `SPECTRO_POSTGRES_URL`, `SPECTRO_PUBLIC_ORIGIN` (an HTTPS origin shared by Console and API), `SPECTRO_AUTH_CSRF_SECRET` (at least 32 bytes), `SPECTRO_OIDC_ISSUER` (HTTPS), `SPECTRO_OIDC_CLIENT_ID`, and `SPECTRO_OIDC_CLIENT_SECRET`. Register `${SPECTRO_PUBLIC_ORIGIN}/v1/auth/callback` as the provider redirect URI. Production startup refuses local or missing authentication mode. The provider must support OIDC Authorization Code, PKCE S256, and an ID token with a stable subject.

`GET /v1/auth/login` starts login; `GET /v1/auth/callback` consumes its browser-bound, one-time state and creates a seven-day, revocable host-only session. `GET /v1/auth/session` returns the current Spectro user ID and session-bound CSRF token (never the session credential). `POST /v1/auth/logout` requires an exact same-origin `Origin` header and `X-CSRF-Token` and revokes the session. Issue PATCH uses the same CSRF check. All hosted project reads and writes verify the live session, organization membership, project, environment, and action. Never send OIDC provider tokens to the SPA.

Login does not provision organizations or projects automatically. The hosted Console guides a new user through creating one organization and its first project, then opens Project settings to create a scoped Browser write key. Invitations, member administration, and ownership transfer remain ADR-050 follow-ups.

For Auth0 acceptance before a staging domain is available, see [local HTTPS authentication](../../docs/operations/auth-local.md). For a deployed environment, see [hosted authentication staging acceptance](../../docs/operations/hosted-auth-staging.md).

## Workspace provisioning

Hosted mode exposes these same-origin, cookie-authenticated endpoints:

| Method | Path                                         | Permission / response                                                                   |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/v1/organizations`                          | Current user's memberships, including each organization ID, name and role               |
| POST   | `/v1/organizations`                          | Any active Console user; creates the organization and its Owner membership, returns 201 |
| GET    | `/v1/organizations/:organizationId/projects` | Any current member; projects with registered environment names                          |
| POST   | `/v1/organizations/:organizationId/projects` | Owner or Admin; creates the project and its environments, returns 201                   |

Both POST routes require the exact Console `Origin` and session-bound `X-CSRF-Token` returned by `/v1/auth/session`. Organization bodies are `{ "name": "My team" }`; project bodies are `{ "name": "Storefront", "environments": ["production", "staging"] }`. Names are trimmed and limited to 120 characters. A project requires 1–10 distinct, trimmed environment names of up to 64 characters. Request bodies are limited to 8 KiB. Unknown properties are rejected; user, role and resource IDs cannot be assigned by the caller. Names need not be unique, and POST requests are not idempotent; clients must not automatically retry creation after an ambiguous response.

GET routes accept `limit` (default 50, maximum 100) and `cursor`. Responses are `{ "data": [...] }` with an optional `nextCursor` containing the last resource ID. Results are ordered by ID; pass the returned cursor unchanged to the same endpoint. Cursors and organization IDs never grant access. Unknown and inaccessible organizations both return 403; missing or invalid sessions return 401. All responses produced by these routes use `Cache-Control: no-store`.

Apply migration `005_workspace_audit_log.sql` before using creation routes. Organization creation, Owner membership and the audit entry commit together. Project creation, environments and its audit entry also commit together. Membership is checked and locked within project transactions. Audit records contain actor ID, organization ID, resource ID, action and timestamp; they contain no session or provider credentials. New projects immediately use the existing project/environment authorization checks.

Run the real PostgreSQL acceptance with `SPECTRO_POSTGRES_URL` pointing to a migrated test database:

```sh
pnpm --filter @spectro/api migrate
pnpm --filter @spectro/api exec vitest run src/postgres-workspaces.integration.test.ts
```

The test creates isolated fixture users and organizations, checks provisioning through the HTTP boundary, cross-organization denial, all four roles, live membership removal, pagination, transaction rollback, audit actors and invalidated sessions, then removes only those fixtures. See [workspace provisioning acceptance](../../docs/operations/workspace-provisioning.md) for scope and rollout notes.

## Browser write keys

Hosted mode exposes project/environment-scoped key management:

| Method | Path                                                           | Permission / behavior                                                           |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/v1/projects/:projectId/environments/:environment/write-keys` | Owner/Admin only; returns metadata and the configured public ingestion endpoint |
| POST   | same path                                                      | Owner/Admin only; creates an overlapping key and returns its secret once        |
| DELETE | `.../write-keys/:keyId`                                        | Owner/Admin only; revokes the key                                               |

Write-key POST and DELETE require the exact Console `Origin` and session-bound `X-CSRF-Token`. The POST body is `{ "environment": "production", "label": "Browser production", "allowedOrigins": ["https://app.example.com"] }`. `allowedOrigins` is optional, capped at 20 exact HTTPS origins; HTTP is accepted only for localhost development. Empty means any origin may use the public ingestion endpoint, so configure origins for production sites. Keys are project/environment-specific. Create a replacement before revoking an existing key to rotate without an ingestion gap. Raw secrets are returned only by create and are never stored or logged; the database stores a SHA-256 verifier and a non-secret hint. Revocation and creation are included in the workspace audit log.

`SPECTRO_INGEST_PUBLIC_ENDPOINT` is the public Browser SDK base URL. Production must provide it over HTTPS; local hosted-auth mode proxies `https://localhost:5188/ingest` to the local ingestion service. The ingestion service needs `SPECTRO_INGEST_KEY_POSTGRES_URL`, configured with a dedicated read-only role that has `SELECT` only on `project_write_keys`. The product API keeps using its write-capable `SPECTRO_POSTGRES_URL`; never share the API credential with ingestion.

Ingest verifies the submitted key, optional `Origin` policy, and every event's project and environment before admission. Scope mismatch rejects the entire envelope. A database lookup outage fails closed with 503. Browser keys are admission scopes, not user identities or read/admin credentials. The SDK source package is currently in this repository; publication to a package registry remains a separate release step.
