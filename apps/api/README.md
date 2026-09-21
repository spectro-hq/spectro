# Product API

The product API owns authorized read access to Spectro data. Its current query surfaces are:

```http
GET /v1/projects/:projectId/events
GET /v1/projects/:projectId/issues
PATCH /v1/projects/:projectId/issues/:fingerprint
GET /v1/projects/:projectId/issues/:fingerprint/history
```

Both endpoints require `environment`, `from`, and `to`; timestamps are inclusive Unix epoch milliseconds and a query window is capped at 31 days. `limit` defaults to 50 and is capped at 100. Use the opaque `nextCursor` response value as `cursor` for the next page.

The event list accepts optional exact filters for `type`, `name`, `release`, `sessionId`, `pageId`, and the server-generated 32-character hexadecimal `fingerprint`. The issue list groups error events by that fingerprint inside the selected project, environment, and time window; it accepts optional exact `name`, `release`, and lifecycle `status` filters. Each issue reports occurrence, affected-session, and affected-user counts plus first/latest evidence and its PostgreSQL-backed lifecycle status.

Send an authorized PATCH body such as `{ "environment": "production", "status": "resolved" }` to change lifecycle state. Accepted statuses are `open`, `resolved`, and `ignored`. The bounded history endpoint requires `environment` and accepts `limit`; actor identity remains absent until production identity is integrated.

Local development intentionally denies event access until a project and bearer token are configured:

```bash
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

Replace `events` with `issues` to query grouped errors using the same authorization and time-window contract.

`SPECTRO_CLICKHOUSE_URL`, `SPECTRO_CLICKHOUSE_USER`, `SPECTRO_CLICKHOUSE_PASSWORD`, and `SPECTRO_CLICKHOUSE_DATABASE` override the local ClickHouse defaults. The static bearer-token adapter is for local development only; production identity and membership remain a separate control-plane integration.

`SPECTRO_POSTGRES_URL` overrides the local PostgreSQL connection used for issue lifecycle state.

Apply ordered control-plane migrations before starting a deployed API or after pulling schema changes:

```bash
pnpm --filter @spectro/api migrate
```
