# ADR-036: Browser session and page lifecycle

Status: accepted  
Date: 2026-09-14

## Context

Session and page IDs are first-class event context. Browser SDK instrumentation must establish them before automatic or custom events are captured, survive reloads without conflating independent tabs, and create a new page lifecycle when a single-page application changes routes. Browser unload delivery is not yet reliable because the ordinary envelope limit is larger than browser keepalive quotas.

URLs can contain query strings, fragments, credentials, or tokens, so lifecycle capture must not copy a raw location into event context.

## Decision

- The default browser lifecycle plugin is enabled by `init()` unless explicitly disabled.
- A session is scoped to one browser tab and one project/environment pair. Its ID, start time, and last activity time are stored in `sessionStorage` when available and retained in memory if storage is unavailable.
- A missing, malformed, future-dated, or inactive session record starts a new session. The default inactivity timeout is 30 minutes and can be configured with a positive finite millisecond value.
- SDK capture attempts, URL transitions, pointer input, keyboard input, scrolling, and visibility changes update session activity. Storage writes are throttled during high-frequency activity.
- A new session emits `session_start` before the first page event and becomes context for subsequent events.
- Initial lifecycle setup creates a new page ID and emits `page_view` with action `view`.
- Every observed `pushState`, `replaceState`, `popstate`, or hash route that changes the sanitized URL creates a new page ID and emits `page_route_change` with action `route_change` and bounded `from`/`to` values.
- Query strings, credentials, and arbitrary fragments are removed. A fragment beginning with `#/` is retained as a sanitized hash-router path with its query portion removed.
- Reinitialization and `destroy()` restore patched History methods and remove listeners. Failures remain contained and are reported through the configured `onError` hook.
- V1 does not emit `session_end` or `page_leave` during unload. Those actions remain protocol-valid for a future explicit end API or a separately bounded unload transport. Server-side query processing may infer inactive session boundaries but does not rewrite the captured session ID.

## Alternatives considered

### One session per page load

Rejected because reloads would fragment one user investigation and make session timelines substantially less useful.

### Shared `localStorage` session

Rejected because independent tabs would race on one identity and unrelated concurrent navigation would merge into one session.

### Cookie-based session

Rejected because it adds cross-request state, consent and domain concerns, and unnecessary transport exposure.

### Emit end/leave with ordinary fetch on unload

Rejected because browsers may cancel it, and enabling `keepalive` for the existing 1 MiB envelope policy would exceed smaller browser quotas.

## Compatibility and consequences

- The Event Protocol does not change; existing session and page schemas are used.
- The browser SDK public surface gains lifecycle configuration and `destroy()` cleanup.
- Automatic lifecycle events are queued before the first customer `track()` call, so the next `flush()` includes them.
- Session continuity is deliberately tab-local. Cross-device or cross-tab identity belongs to user context, not session identity.
- History instrumentation must be composable: cleanup restores a method only if the plugin still owns the installed wrapper.

## Migration and rollback

The lifecycle is implemented as a browser plugin around the existing core capture pipeline. It can be disabled per initialization or removed without changing protocol, ingestion, processor, or storage. Session storage uses a versioned key; a future semantic change uses a new key version and starts a fresh session.
