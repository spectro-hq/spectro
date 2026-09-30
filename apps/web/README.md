# Spectro Console

The Console is a React + Vite SPA. Its operational surfaces are a unified event explorer and a grouped error Issues workspace, both backed by TanStack Query and the product API.

```bash
pnpm --filter @spectro/web dev
```

The development server uses `http://localhost:5174` with strict port binding. Requests under `/v1` proxy to the local product API at `http://127.0.0.1:4400`.

The explorer starts with clearly labeled illustrative events so its interaction states can be reviewed without production telemetry. In local development, choose **Connect API** to enter the bearer token configured for `@spectro/api` with `SPECTRO_AUTH_MODE=local`. That local-only token stays in `sessionStorage`, is sent only through the authorization header, and is never placed in URL filter state.

The production build uses hosted authentication. It checks `/v1/auth/session` before showing the workspace, links to `/v1/auth/login` when signed out, sends same-origin Cookie credentials without a browser-readable bearer token, and includes a session-bound CSRF header for issue updates and sign-out. Serve the built SPA and product API under the same configured HTTPS origin; the ingestion service must use a separate host. The local bearer-token form is not rendered in this mode. An authenticated user still needs explicit organization membership to read a project.

Project, environment, time range, event type, event name, release, session, page, error fingerprint, selected event, and selected issue are shareable router state. Server data and cursor pages remain in TanStack Query. Detail tabs and connection-panel visibility stay local React state; Zustand is intentionally unnecessary for this slice.

## Live

`/live` uses project/environment scope and exact type, event-name, and session filters. The compact arrival ledger groups events by the observer's discovery time; row time is occurrence time, while the inspector also displays processing time. Selection stays pinned as newer arrivals are prepended. All payloads reuse the existing read-only Event/Context/Raw inspector.

Pause freezes the displayed ledger, not the connection. Matching arrivals accumulate in memory; Resume or **Show N new events** explicitly reveals them without replacing selected detail. Displayed and pending rows share a 500-event/8 MiB UTF-8 budget; the selected event is one additional bounded snapshot. Capacity eviction is reported. Telemetry payloads are never persisted to browser storage.

Polling is suspended and in-flight work cancelled while the tab is hidden. Transient failures preserve displayed evidence and back off to a maximum 30-second interval; access failures stop observation and clear retained data. A successful poll after a gap longer than 60 seconds starts a fresh observation window and reports possible missed arrivals. Scope/filter changes remount and discard the old observation. Illustrative mode is a labeled static preview, not a simulated successful connection.
