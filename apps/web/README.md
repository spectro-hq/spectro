# Spectro Console

The Console is a React + Vite SPA. Its operational surfaces are a unified event explorer and a grouped error Issues workspace, both backed by TanStack Query and the product API.

```bash
pnpm --filter @spectro/web dev
```

The development server uses `http://localhost:5174` with strict port binding. Requests under `/v1` proxy to the local product API at `http://127.0.0.1:4400`.

The explorer starts with clearly labeled illustrative events so its interaction states can be reviewed without production telemetry. In local development, choose **Connect API** to enter the bearer token configured for `@spectro/api` with `SPECTRO_AUTH_MODE=local`. That local-only token stays in `sessionStorage`, is sent only through the authorization header, and is never placed in URL filter state.

The production build uses hosted authentication. It checks `/v1/auth/session` before showing the workspace, links to `/v1/auth/login` when signed out, sends same-origin Cookie credentials without a browser-readable bearer token, and includes a session-bound CSRF header for issue updates and sign-out. Serve the built SPA and product API under the same configured HTTPS origin; the ingestion service must use a separate host. The local bearer-token form is not rendered in this mode. An authenticated user still needs explicit organization membership to read a project.

Project, environment, time range, event type, event name, release, session, page, error fingerprint, selected event, and selected issue are shareable router state. Server data and cursor pages remain in TanStack Query. Detail tabs and connection-panel visibility stay local React state; Zustand is intentionally unnecessary for this slice.
