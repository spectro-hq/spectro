# Docker infrastructure

The current production-shaped data-plane slice runs NATS JetStream and ClickHouse locally:

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

The credentials are local-only defaults. Production injects credentials and does not expose database or broker ports publicly.

Named volumes preserve local data across `down`. Run `down --volumes` only when intentionally discarding the local event plane.
