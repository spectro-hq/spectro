# ADR-057: Landing page at root, console under /app/

Status: accepted

Date: 2026-11-23

## Context

ADR-056 introduced the public landing page at `/landing/` while the console kept `/`. The product is now ready for the landing page to be the public homepage: first contact should be the product narrative, and the console is an authenticated destination reached from it.

## Decision

Swap the two entry points. The static landing entry becomes the root document (`apps/web/index.html` → `dist/index.html`); the console entry moves to `apps/web/app/index.html` → `dist/app/index.html` so it serves under `/app/`.

- The console router mounts at `basepath: '/app'`; router-relative links and `useLocation().pathname` remain basepath-stripped.
- Hosted-auth return destinations are re-scoped: `returnTo` accepts `/app` or `/app/invite`, login attempts default to `/app`, invitation links are generated as `/app/invite#token=…`, and logout lands on `/app/`.
- Caddy routes `/v1/*` and `/health` to the API, redirects bare `/app` to `/app/`, serves the console SPA fallback for `/app/*`, and serves landing plus shared static assets for everything else (`try_files {path} /index.html`, where `dist/index.html` is now the landing document). Console assets remain absolute under `/assets/`, so they never enter the `/app/*` namespace.
- Auth0 callback, logout, and cookie configuration are unchanged: `/v1/auth/callback` is an API route, session cookies keep `path: '/'`, and the public origin does not move.

## Alternatives and consequences

Keeping the console at `/` and the landing under a separate hostname would split infrastructure and SEO for no current requirement. Rewriting `/` to the landing document inside Caddy while leaving entries in place would make dev-server URLs diverge from production; moving the HTML files keeps `pnpm dev` faithful to production routing (`/` → landing, `/app/` → console). Deep links to console paths outside `/app/*` now fall back to the landing document; that is accepted because the previous root routes were never published outside the staging environment.

## Compatibility, validation, and rollback

Verify `/` serves the landing document, `/app/` and deep links such as `/app/settings` serve the console, the login → Auth0 → `/v1/auth/callback` → `/app` loop completes, invitation links land on `/app/invite`, and `/v1/*` plus `/health` are unaffected. In-flight login attempts may redirect to a stale return path; they expire within ten minutes. Roll back by reverting the entry swap, basepath, auth paths, and Caddy block together — no data migration is involved.
