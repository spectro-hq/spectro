# Product API

The product API owns authorized read access to Spectro data. Its first query surface is:

```http
GET /v1/projects/:projectId/events
```

Required query parameters are `environment`, `from`, and `to`; timestamps are inclusive Unix epoch milliseconds. Optional exact filters are `type`, `name`, `release`, `sessionId`, and `pageId`. `limit` defaults to 50 and is capped at 100. A query window is capped at 31 days. Use the opaque `nextCursor` response value as `cursor` for the next page.

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

`SPECTRO_CLICKHOUSE_URL`, `SPECTRO_CLICKHOUSE_USER`, `SPECTRO_CLICKHOUSE_PASSWORD`, and `SPECTRO_CLICKHOUSE_DATABASE` override the local ClickHouse defaults. The static bearer-token adapter is for local development only; production identity and membership remain a separate control-plane integration.
