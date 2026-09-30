# Live observation

Primary target: apps/web/src/live-explorer.tsx

Mode: Operate

## Confirmed scope

Live serves connection verification and live troubleshooting for a selected project/environment across all event types. The owner accepted exact filters and event detail, and accepted list pause with continued bounded observation and an explicit new-events action.

## Structure decision

The owner selected arrival groups with a persistent right-side inspector on 2026-09-30. Surface seed: 40726971; degraded local deal after the online roll was unreachable. Selected option: arrival-groups. Build path: comp, unchanged by the owner. The original text-only direction round had no decision comp.

The subsequent comp round supplies three variations of that same structure:

- .impeccable/mocks/live/balanced.png
- .impeccable/mocks/live/event-led.png
- .impeccable/mocks/live/detail-led.png

The owner approved the event-led comp on 2026-10-01. Approved build comp: .impeccable/mocks/live-event-led.png. This completed the three-option visual round; the files under .impeccable/mocks/live/ record the preceding variation round.

## Direction contract

THESIS: Observe newly available events in compact arrival groups with a persistent inspector, focused on individual evidence.

OWN-WORLD: Inherit Spectro's native system type, muted surfaces, authored navigation icons, subtle borders and violet selection. Current implementation tokens remain authoritative.

STORY: Confirm SDK delivery, filter relevant signals, freeze the displayed list to investigate, and explicitly reveal queued arrivals without displacing the selected event.

FIRST VIEWPORT: Shared shell; Live title and project/environment controls; compact observation/pause/filter toolbar; wide grouped ledger on the left and narrower persistent inspector on the right. Illustrative data is labeled.

FORM: Arrival-groups, grounded candidate 7, seed 40726971; approved event-led comp. Desktop ledger owns approximately three fifths of the workbench as rendered by the chosen comp; narrow screens stack the inspector below the ledger.

SIGNATURE: Paused reading keeps event rows fixed while a new-events action grows; revealing arrivals does not switch selected evidence. Motion is limited to explicit state changes.

FINISH: Record implemented behavior, finish evidence, and the verdict without treating comp approval as shipping approval. Preserve the incumbent DESIGN.md and .impeccable/design.json for this ordinary surface extension. The owner approved retaining native responsive sizing and recording a pixel-comparison exception on 2026-10-01; responsive is closed by that exception, with failed numeric evidence preserved. The final independent reviewer returned ship within the original seven-finding scope, and the supported finish transition closed review and recorded ship. This is not a whole-surface recertification; see .impeccable/review/live-documentation.md.

## Incumbent evidence

The owner-supplied populated Events screenshot is the reference for shell, palette, system typography, and payload controls. Current apps/web/src/styles.css tokens take precedence over pre-existing DESIGN.md drift. The screenshot is reference material only; generated mockups use illustrative data.

## Translation constraints

Comp payload text and identifiers illustrate density only; actual payloads must follow the Event Protocol. Do not introduce the mockups' invented fields, raw stacks, user-agent capture, input text, or coordinate claims into SDK capture. Reuse existing navigation icons, brand asset, detail viewer, and semantic theme tokens. Keep occurrence time, processing time, and the observer's batch discovery time distinct. New-arrival group counts describe only that observation response, never a causal transaction.

## Implemented behavior

Live queries processed events through the authorized project/environment observation endpoint and supports exact event type, event name, and session filters. It reuses the shared Console shell, authored navigation icons, event detail tabs, and read-only JSON/YAML payload viewer. Illustrative mode is a labeled static preview with no live connection.

Arrival groups describe the observer's discovery response, not a causal transaction. Row timestamps show occurrence time; the inspector separately labels occurrence and processing time. Discovery groups remain ordered by arrival, including late events with older occurrence times.

Pause freezes displayed rows and selected detail while matching arrivals continue into the bounded pending buffer. Resume or the explicit “Show N new events” action reveals pending rows and resumes display updates without switching the selected event. The inspector retains one selected snapshot even if its row later leaves the retained buffer. Scope/filter changes reset the surface; lost authorization clears retained evidence.

## Initial observation policy

ADR-051 was accepted on 2026-10-01 and records the observation policy separately from the UI finish verdict. Its implemented policy targets updates about every three seconds while visible, revisits a 60-second processing-time overlap, and deduplicates by event ID. Hidden tabs suspend requests; transient failures retry with backoff up to 30 seconds. Invalid requests stop automatic updates; expired sessions or permission loss stop observation and clear evidence. An interruption longer than 60 seconds restarts the recent window with an explicit gap notice and a route to Events history.

Each server page is limited to 100 rows / 2 MiB; one observation update drains at most five pages / 8 MiB. Displayed and pending rows share a 500-row / 8 MiB UTF-8 serialized-item budget, plus one protocol-bounded selected snapshot. A full paused buffer drops pending arrivals rather than moving displayed rows. Eviction and truncated updates are reported. Query work is capped at two seconds, two million read rows, and 256 MiB scanned data; paginated snapshots are limited to five minutes. Telemetry payloads remain in memory. This finite window is best-effort observation, not a lossless subscription.

## Native and responsive adaptation

Current semantic theme tokens, native system type, quiet borders, and violet selection remain authoritative. The surface introduces no new font, palette, brand asset, or decorative motion. Real protocol fields replace illustrative comp payloads and identifiers.

The desktop workbench uses a wider ledger and narrower sticky inspector. At 1200px the scope controls reflow and secondary session/page row columns disappear; at 900px the inspector stacks below a bounded scrolling ledger; at 760px controls stack and Live rows, pause, and new-events actions have at least 44px height. A Live-only minimum-width override permits the 320px viewport without page overflow. Light and dark modes use shared semantic tokens. Detail tabs support arrow-key navigation; immediate state changes remain understandable with reduced motion.

## Verification and finish status

The full pnpm verify run passed without warnings; the final rerun also passed with exit 0 after generated JSON formatting was corrected through pnpm format. Real ClickHouse/API integration passed for 120 late events with tied processing timestamps across pagination, authorization boundaries, and scoped cursors. A browser test against an isolated loopback in-memory fixture verified four arrival groups, four pending arrivals, a frozen 12-row list, explicit reveal to 16 rows, and retained selection. Invalid-query (400) and reconnecting (503) states were inspected. Keyboard Event → Context → Raw → Event navigation and selected-tab semantics were verified. At 320px the usable width and scroll width both measured 310px, with readable Performance labels and 44px Live targets.

Hero passed at 79% and is closed; sections and motion are closed. The automated responsive comparison at 1440px failed at 75.58%, reporting ten missing/contradicted regions. The paired-crop review found those regions present but displaced by native sizing or different protocol-valid content. On 2026-10-01 the owner replied “同意” to retaining the native responsive layout and explicitly recording the comparison exception. The supported build-phase force/reason transition closed responsive by this narrowly approved exception and opened review; the failed numeric result and reasons remain preserved. This is an exception to Live's responsive pixel-comparison authority, not a numeric pass or a global design change.

The final independent reviewer returned “ship” within the original seven-finding scope: implementation findings 1–6 remain resolved at 100%, and finding 7 (workflow/documentation) is now resolved at 100%. The supported build-phase finish with disposition ship closed review and recorded the final outcome. This documents the external reviewer's verdict rather than self-certifying it, and does not constitute a new whole-surface approval or production-capacity certification. ADR-051 is accepted; the root design canon remains unchanged.

Post-finish correction, 2026-10-01: the owner reported the event-type dot sitting too high beside the fetch_request heading. The shared detail component now centers the dot and title in one flex row, removes the dot's 5px top margin, and preserves the 22px summary indent and long-title shrink behavior. Supplied evidence: two layout tests, all 43 web tests, and full pnpm verify passed (exit 0); browser captures .impeccable/review/dot-desktop.png, dot-mobile.png, and dot-detail.png show equal dot/title center coordinates (272.3984375px desktop, 1164.796875px mobile), with mobile width and scroll width both 380px. This matches the incumbent detail design; the root canon, recorded finish, ADR, and responsive exception are unchanged. A fresh independent reviewer returned ship for this narrow dot/title correction and directly affected summary, overflow, and semantics, with no material fixes requested. This is not a new whole-surface approval.
