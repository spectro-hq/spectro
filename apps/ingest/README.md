# Ingestion service

`pnpm --filter @spectro/ingest dev` uses the local-only `sp_local_dev` key when
`SPECTRO_INGEST_API_KEY` is unset. The service refuses to start with
`NODE_ENV=production` unless `SPECTRO_INGEST_API_KEY` is configured.

The current V1 adapter compares one configured key for all accepted events.
Production deployments still need a project-key lookup and rotation strategy
before serving multiple customer projects.
