# Docker infrastructure

The current production-shaped data-plane and control-plane slice runs NATS JetStream, ClickHouse, and PostgreSQL locally:

```bash
docker compose -f infra/docker/compose.yaml up -d --wait
pnpm test:integration
docker compose -f infra/docker/compose.yaml down
```

Local endpoints:

- NATS client: `nats://localhost:4222`
- NATS monitoring: `http://localhost:8222`
- ClickHouse HTTP: `http://localhost:8123`
- ClickHouse database/user/password: `spectro` / `spectro` / `spectro_local`
- PostgreSQL: `postgres://spectro:spectro_local@localhost:5432/spectro`

The credentials are local-only defaults. Production injects credentials and does not expose database or broker ports publicly.

Named volumes preserve local data across `down`. Run `down --volumes` only when intentionally discarding local event and control-plane data.
