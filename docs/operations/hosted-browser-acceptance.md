# Hosted Browser Key to live Console acceptance

This local-only extension joins the existing Auth0 Console on `https://localhost:5188` to scoped ingestion, NATS JetStream, the processor, and ClickHouse. It does not change identity, protocol, or deployment boundaries. It preserves manually created users, organizations, projects, and keys.

## Start

First complete [local Auth0 login](./auth-local.md) and create a workspace, project, environment, and Browser Key. Save the one-time key yourself. For this harness, allow `http://localhost:3000` as a browser origin. Do not paste any key into a chat, URL, or committed file.

From the repository root:

```sh
docker compose -f infra/docker/compose.yaml up -d --wait nats clickhouse
pnpm build
pnpm auth:local:ingest:prepare
```

The preparation command creates a dedicated local PostgreSQL login with `SELECT` on `project_write_keys` and read-only transactions. Its random credential lives in Git-ignored `.env.ingest-local` with owner-only permissions. Repeat runs preserve this credential. The account has no access to Console users/sessions and is not the API's write-capable account. This setup targets only the isolated `spectro_auth_local` database, not a production database.

Leave the existing API/Console running. Start these commands in separate terminals:

```sh
pnpm auth:local:ingest
pnpm auth:local:processor
pnpm auth:local:harness
```

Services listen on loopback: ingestion `4401`, API `4488`, Console `5188`, and harness `3000`. The harness preserves the browser's real Origin, removes cookies/authorization from the ingestion proxy, and keeps the write key only in the SDK's memory. Private environment files, certificates, `.local`, and design metadata are denied by the harness file server.

## Manual acceptance

1. Open `http://localhost:3000/?mode=hosted`. Fill the project ID from the Console URL, the exact key environment, and your saved Browser Key. Project/environment may be supplied in the URL; keys may not.
2. Click **Connect SDK**. A successful connection reports HTTP `202`; an invalid or revoked key reports `401`, disallowed origin/scope reports `403`, and unavailable admission reports `503`. Failure keeps signal controls disabled and explains how to reconnect.
3. Click **Send all test signals**. This creates an explicitly simulated runtime error and real request to the harness's simulated HTTP `503` endpoint. The monitored click and native Navigation Timing supply interaction and performance signals through the unmodified Browser SDK.
4. Check `acceptedEvents` and `lastHttpStatus`, then use **Open live Events**. Allow processing to finish and refresh the query. Look for Error, Network, Interaction, Performance, and normal session/page lifecycle events in the selected project/environment.
5. Inspect the Issues, Network, and Performance pages and open a captured event's Session. Their evidence should refer to the same browser session. Navigation Timing has no invented rating, so missing Web Vital ratings are expected.

The test page never prints the raw key. It clears the input after SDK initialization. Reloading forgets the key and requires you to paste it again; ordinary SDK session context and the bounded urgent-event outbox retain their documented behavior.

## Automated acceptance

With the processor running:

```sh
pnpm auth:local:test-ingestion
```

This test uses temporary users, organizations, projects, and keys in the isolated authentication database. It covers real PostgreSQL key lookup through the read-only role, JetStream admission, processing, ClickHouse persistence, session-filtered API queries, issue fingerprinting, network/performance aggregation, wrong project/environment/origin denial, credential separation, and revocation. It cleans only its own randomly identified fixtures. OIDC is a test adapter here; the user's actual Auth0 login is a separate manual acceptance step.

The existing fixed-key harness mode (`live` / `ack-loss`) still uses `sp_local_dev` and requires a local fixed-key ingestion instance. Do not point it at the hosted scoped-key ingestion instance. See [Browser-to-console acceptance](../../tests/browser-acceptance/README.md).

## Stop

Use Ctrl+C in the ingestion, processor, and harness terminals. Stop only these temporary services; do not remove Docker volumes or revoke the user's key. The existing Auth0 API and Console can remain running.
