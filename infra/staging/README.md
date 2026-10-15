# Hosted staging

Operator deployment for ADR-054, not a customer self-hosted distribution. Build on the target ARM64 host. Requires Docker Compose, TCP 80/443, DNS pointing to the host, and the Auth0 callback configured for the Console host.

## Prepare

From the repository root, generate credentials on the server:

```sh
docker run --rm -v "$PWD/infra/staging:/setup" node:22-bookworm-slim node /setup/prepare.mjs
```

Edit `infra/staging/.env` locally on that server. Confirm `SPECTRO_OIDC_CLIENT_ID` matches the Auth0 application, and fill `SPECTRO_OIDC_CLIENT_SECRET`. Quote values containing `$` or `#` using single quotes. Keep mode 0600. Never paste the file into a chat, commit it, or run `docker compose config` without `--quiet`, since expanded configuration contains credentials. Preparation refuses to overwrite an existing file. Generated credentials are safe for connection URLs and initialization SQL.

## Build and start

```sh
docker compose -f infra/staging/compose.yaml config --quiet
docker compose -f infra/staging/compose.yaml build
docker compose -f infra/staging/compose.yaml up -d
docker compose -f infra/staging/compose.yaml ps
```

Compose reads `.env` adjacent to its first configuration file. PostgreSQL bootstrap creates scoped roles only on a fresh volume. The migration job uses the API schema-owner account and its ordered ledger. The grant job then permits ingestion to read only `project_write_keys`. ClickHouse bootstrap creates the event table and separate SELECT/INSERT users only on a fresh volume. Never change generated database passwords in `.env` without an explicit database credential rotation; restarting containers does not update persisted users.

Caddy serves the built SPA and routes `/v1/*` to the API on the Console HTTPS host. It obtains certificates automatically. The second host routes to ingestion. No database or NATS port is published. The health endpoints are liveness checks, not proof of durable event delivery.

## Acceptance and operations

Check HTTPS `/health` on both hosts; complete a real Auth0 login, create a workspace and scoped write key, send SDK events from an allowed origin, and confirm Events/Issues/Performance/Network/Live show them. Verify a revoked key fails and another user cannot read the workspace. Staging starts with empty data and does not copy local users or keys.

```sh
docker compose -f infra/staging/compose.yaml exec processor node services/processor/dist/status.js
docker compose -f infra/staging/compose.yaml logs --tail=50 api ingest processor
```

Capture a known-good image tag before updates. Build new images, review schema compatibility and take database backups before rerunning migrations, then recreate applications. For rollback restore the prior compatible application images; keep data volumes. Never run `down --volumes`. Disk space, queue backlog and processing failures require regular inspection. Logs rotate at 10 MB per file, three files per container. ClickHouse is capped at 3 GB memory; measure actual workload before increasing traffic. The runtime currently retains the workspace build toolchain; production image minimization is follow-up work.

Hetzner host backups alone do not demonstrate database recovery. Before inviting external testers, configure encrypted off-host database backups, protect their credentials, and perform a restore drill. Event retention remains an open product decision: this deployment does not silently add a TTL.
