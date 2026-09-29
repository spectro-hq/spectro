# Product API

The product API owns authorized read access to Spectro data. Its current query surfaces are:

```http
GET /v1/projects/:projectId/events
GET /v1/projects/:projectId/issues
PATCH /v1/projects/:projectId/issues/:fingerprint
GET /v1/projects/:projectId/issues/:fingerprint/history
GET /v1/projects/:projectId/performance
GET /v1/projects/:projectId/network
```

Both endpoints require `environment`, `from`, and `to`; timestamps are inclusive Unix epoch milliseconds and a query window is capped at 31 days. `limit` defaults to 50 and is capped at 100. Use the opaque `nextCursor` response value as `cursor` for the next page.

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

This slice does not provision organizations or projects on first login. An authenticated user without explicit membership receives 403 for project data. Invitation/onboarding and scoped browser ingestion keys remain separate ADR-050 follow-ups.

For Auth0 acceptance before a staging domain is available, see [local HTTPS authentication](../../docs/operations/auth-local.md). For a deployed environment, see [hosted authentication staging acceptance](../../docs/operations/hosted-auth-staging.md).
