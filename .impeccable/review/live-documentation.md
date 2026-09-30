# Live surface documentation

Recorded: 2026-10-01. Scope: ordinary Operate surface extension. Documentation only; the root design canon and sidecar are preserved.

## Implemented system summary

1. World: Spectro's native system typography, authored SVG icons, muted semantic surfaces, quiet borders, and violet selection remain the incumbent visual authority.
2. Composition: compact arrival groups occupy a wider ledger beside a persistent inspector; shared project/environment scope and exact filters lead the first viewport.
3. Interaction: pause freezes the displayed list while bounded observation continues; explicit reveal or resume retains selected evidence, including one snapshot outside the row buffer.
4. Adaptation: the inspector stacks below the ledger at 900px; mobile controls reflow, Live targets reach 44px, and shared semantic tokens support light/dark modes without decorative motion.
5. Evidence: verification and real-boundary integration passed; responsive closed by owner-approved exception with failed numeric evidence preserved; review closed with ship within the original seven-finding scope.

## Behavior and policy captured

The updated [surface brief](../../apps/web/.impeccable/surfaces/apps-web-live-observation.md) replaces its planned target and pending-implementation language with the implemented observation endpoint, exact filters, arrival semantics, pause/reveal behavior, native adaptation, failure states, and finish evidence.

The ADR-051 implementation targets three-second visible-page updates with a 60-second overlap and ID deduplication. It bounds pages to 100 rows / 2 MiB, updates to five pages / 8 MiB, and displayed plus pending buffers to 500 rows / 8 MiB, plus one selected protocol-bounded snapshot. It reports eviction, truncated updates, and reconnect gaps. Hidden tabs suspend observation; transient failures back off up to 30 seconds; invalid queries stop automatic updates; authorization failure clears evidence. Payloads stay in memory. Processing time, occurrence time, and discovery groups remain distinct; finite overlap does not guarantee losslessness.

## Verification evidence

Evidence below records the final implementation handoff supplied by the coordinating agent and the current build state; this documentation pass did not rerun tests or alter the UI.

- Full pnpm verify passed without warnings. The final rerun passed with exit 0 after generated JSON formatting was corrected through pnpm format.
- Real ClickHouse/API integration: one test passed covering 120 late timestamp-tied events across two pages, authorization, and scoped cursors.
- Browser loopback fixture: four arrival groups; pause preserved 12 displayed rows while four arrivals queued; explicit reveal produced 16 rows and retained selection. The fixture was an isolated in-memory test, not production telemetry.
- Failure states: invalid-query 400 and reconnecting 503 were inspected.
- Keyboard: Event → Context → Raw → Event using ArrowRight; aria-selected was true for the active tab at each step.
- Minimum viewport: at 320px, usable width 310px equaled scrollWidth 310px after the Live-only minimum-width override; Performance remained readable and Live targets measured 44px.
- Captures: [hero](hero-repro.png), [desktop](desktop.png), [mobile](mobile.png), [dark](dark.png), [320px](mobile-320.png), [pending arrivals](pending.png), [invalid query](query-error.png), and [reconnecting](reconnecting.png).

These checks establish the recorded behaviors and local rendering evidence. They do not imply a production-load capacity benchmark or a numeric responsive fidelity pass.

## Recorded finish outcome

The current [.impeccable/build/state.json](../build/state.json) records hero PASS at 79% (closed), sections closed, motion closed, responsive closed by approved exception, review closed, and finish disposition ship. The 1440px comparison still records an automated failure at 75.58% (0.7558), with eight missing regions and two contradicted regions after normalized cropping. The paired-crop review confirms all ten are present, with displaced native geometry or differences in protocol-valid content. The failed result and its reasons remain in the build record.

On 2026-10-01 the owner replied **“同意”** to the concrete proposal **“保留现有原生布局，明确记录对照例外”**. The supported build-phase advance with force and reason then closed responsive and opened review. Approval is limited to retaining Live's native responsive sizing and recording an exception to its responsive pixel-comparison authority. It does not convert the automated result to PASS, authorize a global design change, or establish production capacity.

The final independent reviewer returned **ship within the original seven-finding scope**. Findings 1–6 (inspector spacing, new-events control, notice stripe, failure copy, mobile scanning, and row hierarchy/numerals) remain resolved at 100%; finding 7 (workflow/documentation) is resolved at 100%. The supported build-phase finish with disposition ship closed review and recorded that outcome. This administrative update records the independent verdict and does not self-certify the reviewer finding. No new UI assessment was performed, and the verdict is not a whole-surface recertification or production-capacity certification.

The coordinating implementation task accepted ADR-051 on 2026-10-01, reflecting the confirmed observation policy and owner finish decision. This documentation does not edit the ADR; it records the closed review and ship outcome already written by the supported finish operation.

## Preserved canon and pre-existing drift

Root [DESIGN.md](../../DESIGN.md) and [.impeccable/design.json](../design.json) are unchanged. This is an ordinary extension, so Live's arrival-group strategy stays in its surface brief rather than becoming a system-wide rule.

Pre-existing drift remains reportable: root frontmatter uses the earlier cool-blue palette, 16px instrument radius, and 980px/640px responsive story, while the current console uses gray semantic surfaces, a 12px panel radius, and different operational breakpoints. The sidecar still contains Avenir-based component snippets, older palette fallbacks and foundation-navigation examples, despite the native system typography and shared shell now in use. Root prose contains later shell/theme guidance but its frontmatter and sidecar do not fully describe the same implementation. A root refresh was not authorized for this task.

No drift repair, redesign, new global token, comp-only payload field, lossless-delivery claim, or whole-surface recertification was canonized by this documentation pass. The narrowly owner-approved Live responsive comparison exception and scoped ship verdict are recorded only in the surface and workflow documentation; they are not promoted into the root design canon.

Post-finish correction, 2026-10-01: the owner reported a high event-type dot beside the fetch_request heading. The shared detail component now centers dot and title together, removes the 5px dot offset, and preserves the 22px summary indent and long-title shrink behavior, matching the existing design. The coordinating task supplied passing results for two layout tests, all 43 web tests, and full pnpm verify (exit 0), plus [desktop](dot-desktop.png), [mobile](dot-mobile.png), and [detail crop](dot-detail.png) captures. Dot/title centers match exactly at 272.3984375px on desktop and 1164.796875px on mobile; mobile width and scroll width both measure 380px. The fresh independent reviewer returned ship for this reported component defect and directly affected summary, overflow, and semantics, with no material fixes requested. This documentation records that narrow verdict, not a whole-surface recertification: no root canon, build state, ADR, or responsive exception changed, and no tests or UI assessment were rerun here.
