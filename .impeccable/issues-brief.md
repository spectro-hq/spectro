# Issues workspace surface brief

- Scope/mode: authenticated Console error aggregation and investigation surface; Operate.
- Audience/job: a developer or operator scans repeated browser errors, judges impact inside a fixed query window, and opens the exact underlying occurrences.
- Primary task: identify the highest-signal error group, understand its reach and recency, then continue into the event explorer without losing project, environment, or time context.
- Required states: local authorization setup, loading, populated, empty, query error, and additional-page loading. Illustrative data must be visibly identified.
- Chosen direction: extend the approved Focus Bench event-explorer world rather than introduce a separate visual identity. The user’s later dashboard references authorize higher typographic clarity, lighter surfaces, and finer operational density, but not their content topology.
- Memorable moment: selecting an error group moves one ultraviolet signal into a persistent evidence panel; the occurrence link converts the group into an exact fingerprint-filtered event query.
- Responsive rule: desktop keeps the issue ledger and evidence panel side by side; under 980px they become a single reading column; at 390px controls, summaries, rows, and evidence stack without horizontal scrolling.
- Credential constraint: local bearer token is session-scoped and never written to URL or persistent storage.
- Data constraint: grouping uses the server-generated fingerprint within project, environment, and selected time window. Counts are window-scoped; workflow status, ownership, and resolution are not implied.

## Direction contract

- **THESIS:** Turn a noisy error stream into a calm, evidence-first investigation bench.
- **OWN-WORLD:** Spectro’s Digital Observatory: cool atmospheric ground, white analytical instruments, ultraviolet as a scarce selection signal, cyan for terminal/protocol context, and green only for verified health.
- **STORY:** Start with scope and window, compare grouped impact, inspect one issue, then descend into matching raw events.
- **FIRST VIEWPORT:** Project/environment/time command row; honest illustrative-data notice; three-number issue summary; compact filters; ranked ledger on the left and selected evidence on the right.
- **FORM:** Existing approved Focus Bench direction, seed `299e769a`; restrained humanist sans typography, compact mono machine data, hairline-separated flat surfaces, one lifted focal instrument, short state-explaining motion.

## Literalization boundary

The four example errors, counts, paths, releases, timestamps, sessions, and users are explicitly illustrative composition data. Live mode derives every row and count from the authorized API. No claim of assignment, severity, resolution, or production impact is fabricated.

## Unresolved decisions

- Issue lifecycle state, assignment, ownership, and resolution semantics.
- Cross-window trend comparison and regression detection.
- Saved views and alert policy.
