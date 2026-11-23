# Staging deployment: 2026-11-23

Branch `feat/public-landing-page` revisions:

- `9994531282845aff8faa5cdacfd596fcb5272404` — landing at `/`, console under `/app/`, migration 008.
- `12035a216cd0e97b40573b4a5ad9ee099f6145ad` — Caddy `/app` redirect fix (explicit `*` matcher; the two-argument form was parsed as inline matcher and returned an empty 200).

## Release locations

Source archives and Compose working directories:

- `/opt/spectro-releases/9994531282845aff8faa5cdacfd596fcb5272404` (runtime + first web build)
- `/opt/spectro-releases/12035a216cd0e97b40573b4a5ad9ee099f6145ad` (final web image)

Only tracked files from the exact Git revisions were uploaded via `git archive`.
`infra/staging/.env` was copied server-side from the previous release, mode 0600,
checksum compared identical without displaying contents.

Image tags:

- `spectro-staging-runtime:release-9994531` — api, ingest, processor
- `spectro-staging-web:release-12035a2` — web/Caddy (supersedes `release-9994531`)

Retained rollback tags: `*-rollback-20261018`, `release-b3e2e9c`.

## Execution and evidence

- Migration `008_console_app_basepath.sql` applied via `docker compose run --rm migrate`
  and confirmed in `control_plane_migrations`. It widens `oidc_login_attempts.return_path`
  to accept `/app` and `/app/invite` while keeping the previous values readable.
- Rolling update: `up -d --no-deps --no-build --wait api ingest processor web`.
  PostgreSQL/NATS/ClickHouse container IDs compared before and after and matched;
  no volumes touched.
- External checks on `https://staging.spectrohq.com`:
  - `/` → 200, `<title>Spectro — Follow the error</title>` (landing)
  - `/app/` → 200, `<title>Spectro · Digital Product Observatory</title>` (console)
  - `/app` → 301 → `/app/`; `/app/issues` deep link → 200 console document
  - `/health` → 200; `/v1/auth/session` → 401; `/v1/auth/login` → 302 to Auth0 with
    `redirect_uri=https://staging.spectrohq.com/v1/auth/callback` (unchanged API route)
  - `/landing/` (old path) → 200 landing document via SPA fallback; `/landing/*.webp`
    assets still served
- Public homepage SHA256 equals `/srv/index.html` in the web container:
  `a393c24163f09ab4c92830438f883f62f759064c07237288bb97a62d6b91e4c2`.
- `https://ingest-staging.spectrohq.com/health` → 200.

## Not revalidated this rollout

A real interactive Auth0 login through the callback (server-side flow redirects to
`/app` on success; covered by `hosted-auth.test.ts`), authenticated console pages,
and live SDK event delivery. These remain the next operator acceptance step.
