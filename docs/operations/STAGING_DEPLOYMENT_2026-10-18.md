# Staging deployment: 2026-10-18

GitHub main revision: `b3e2e9c26614cd7676690aad1677b516f85fb2bc`.
PR #3 CI passed before merge. The operator subsequently verified that the new
encrypted checkpoint could be decrypted and listed without a plaintext Mac archive.
That is not a complete restore test.

## Release and rollback locations

New source archive and application Compose working directory:
`/opt/spectro-releases/b3e2e9c26614cd7676690aad1677b516f85fb2bc`.
Only tracked files from this exact Git revision were uploaded, not the current
uncommitted maintenance helpers or UI artifacts. Server-only `.env` was copied
within the server, mode 0600, and compared unchanged without displaying contents.
The original `/opt/spectro-staging` source/configuration remains for rollback and
existing database bind mounts. It is not a Git checkout and is not the new
release's application source directory.

Retained prior-image tags:

- `spectro-staging-runtime:rollback-20261018`
- `spectro-staging-web:rollback-20261018`

New release tags:

- `spectro-staging-runtime:release-b3e2e9c`
- `spectro-staging-web:release-b3e2e9c`

Migration SQL and Compose/Caddy/NATS/database-init/grant configuration matched the
old source. Only macOS `._*` metadata was excluded from migration comparison;
those old files were not deleted. No migrations were rerun for this deployment.

## Execution and evidence

Built the new runtime/Web images on the ARM64 server, then used the unchanged
`spectro-staging` Compose project to update `api ingest processor web` with
`up -d --no-deps --no-build --wait --wait-timeout 90` under an outer timeout.
Database/broker container IDs were compared before and after and matched.
No volumes were removed or recreated. Existing certificates remain in the named
Caddy volumes. Prior application images remain available for rollback.

- All four running application image IDs match their release image tags.
- API and ingestion container health checks pass; processor status is `ok`.
- Queue stored/pending/ack-pending/lost counts are zero; acknowledged sequence 289.
- Both public HTTPS health endpoints return `status: ok`.
- Public homepage SHA256 matches `/srv/index.html` in the new Web container:
  `6258dd2b5ecf48f08bd40e5dd1f6846a53cf6789e77d9f71eb1066673cc4f803`.
- PostgreSQL/ClickHouse retain their October 13 start times; NATS retains its
  start time from the earlier checkpoint window, not this application rollout.

The first stdin-fed deployment shell completed its image/queue checks, but a
Docker exec consumed the remaining stdin-fed verification commands. Those checks
were rerun independently over a separate SSH invocation and external HTTPS
requests; the helper was corrected to redirect exec stdin from `/dev/null`.
Do not treat the first shell's exit code alone as the acceptance evidence.

Actual Auth0 login, authenticated pages and fresh browser event delivery were not
revalidated in this rollout. They remain the next operator acceptance step.
Cold broker restore and coordinated application recovery remain unverified.
