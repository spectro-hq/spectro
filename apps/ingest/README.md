# Ingestion service

`pnpm --filter @spectro/ingest dev` uses the local-only `sp_local_dev` key when
`SPECTRO_INGEST_API_KEY` is unset and no write-key database URL is configured.

Hosted production ingestion uses `SPECTRO_INGEST_KEY_POSTGRES_URL`, a dedicated
read-only PostgreSQL credential with `SELECT` access to `project_write_keys`.
It never shares the product API's write-capable `SPECTRO_POSTGRES_URL`. The
ingestion service looks up SHA-256 verifiers, enforces each key's project and
environment scope, checks optional exact origin restrictions, and fails closed
when the lookup database is unavailable. A scoped write key can only admit
events; it does not grant Console or query access.
