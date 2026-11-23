---
version: 1
slug: 'apps-web-session-investigation'
primary_target: 'apps/web/src/main.tsx'
related_targets: ['apps/web/src/session-query.ts', 'apps/web/src/styles.css']
---

# Session investigation surface brief

- Scope/mode: authenticated Console session investigation; Operate.
- Audience/job: a frontend developer follows one browser session chronologically to understand what happened before and after an error or other signal.
- Entry points: a session identifier in the Events ledger or selected Event context. The route preserves project, environment, time range, source, and selected event.
- Data boundary: reuse the authorized event-list query with its exact `sessionId` filter, bounded time window, keyset pagination, and bearer credential header. Do not add a second session API until query evidence requires one.
- Primary composition: session identity and controls, compact loaded-window summary, chronological signal timeline, and the existing event detail viewer aligned beside it.
- Timeline rule: order by event timestamp from earliest to latest regardless of storage or fixture order. Keep event type, page, timestamp, and a bounded summary visible without exposing additional payload data.
- Responsive rule: desktop keeps timeline and event detail side by side. Below 980px the detail follows the timeline; at phone widths metadata collapses without horizontal page overflow.
- Required states: invalid session identifier, API connection, loading, query error, empty session, populated timeline, selected event, and additional-page loading.
- Illustrative data must obey the selected time window and remain explicitly labeled.
