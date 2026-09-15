# Spectro Console

The Console is a React + Vite SPA. Its operational surfaces are a unified event explorer and a grouped error Issues workspace, both backed by TanStack Query and the product API.

```bash
pnpm --filter @spectro/web dev
```

The development server uses `http://localhost:5174` with strict port binding. Requests under `/v1` proxy to the local product API at `http://127.0.0.1:4400`.

The explorer starts with clearly labeled illustrative events so its interaction states can be reviewed without production telemetry. Choose **Connect API** to enter the local bearer token configured for `@spectro/api`. The token stays in `sessionStorage`, is sent only through the authorization header, and is never placed in URL filter state.

Project, environment, time range, event type, event name, release, session, page, error fingerprint, selected event, and selected issue are shareable router state. Server data and cursor pages remain in TanStack Query. Detail tabs and connection-panel visibility stay local React state; Zustand is intentionally unnecessary for this slice.
