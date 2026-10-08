# Schemas V1 extension documentation

Recorded: 2026-10-01. Scope: ordinary Read surface extension in the established Spectro Console. This report records the finished artifact and its relationship to the incumbent visual system; it does not replace or refresh the root design canon.

## Implemented system summary

1. Palette: current Console semantic gray grounds, white working surfaces, restrained violet selection and hairlines; dark mode remaps the same roles through existing variables.
2. Type: native system sans for meaning and guidance, SFMono-Regular/Consolas for field names, types and JSON; surface headings are 34px/26px on desktop and 28px/24px on mobile, with compact 12–14px supporting text.
3. Composition: candidate 2's compact contract index and broad reading pane form one connected, flat workbench with Fields, Example and JSON Schema views.
4. Named rules: the Ten-Percent Signal, Telemetry Boundary and Flat-by-Default rules remain evidenced by quiet selection, machine-only monospace and structural hairlines; no new global rule is introduced.
5. Adaptation: the index narrows at 1100px and stacks before the reading pane at 760px; mobile preserves all four field dimensions, native 44px controls and internal code scrolling.

## Evidence checked

The shipped `impeccable_documenter` role and `reference/document.md` were read directly. The documentation pass read [PRODUCT.md](../../PRODUCT.md), [AGENTS.md](../../AGENTS.md), [DESIGN.md](../../DESIGN.md), [design.json](../design.json), the [Schemas surface brief](../../apps/web/.impeccable/surfaces/apps-web-src-schema-reference-tsx.md), the [candidate record](../schemas-candidates.md), the prior [Live documentation](live-documentation.md), and the [independent Schemas review and appended verdict](schemas-finish-review.md). The context launcher and explicit surface-brief read were used; no context repair was performed.

Source inspection covered [schema-reference.tsx](../../apps/web/src/schema-reference.tsx), [schema-catalogue.ts](../../apps/web/src/schema-catalogue.ts), [schema-navigation.ts](../../apps/web/src/schema-navigation.ts), [schema-examples.ts](../../apps/web/src/schema-examples.ts), the root/theme, shared tabs/viewer and scoped schema rules in [styles.css](../../apps/web/src/styles.css), plus the existing [Console shell](../../apps/web/src/console-shell.tsx) and [machine-data viewer](../../apps/web/src/payload-viewer.tsx). The [schema-reference tests](../../apps/web/src/schema-reference.test.tsx) were read, including the new disclosure spacer and escaped JSON Pointer assertions. CSS values below are source values, not independently sampled live computed styles.

The approved [candidate 2 comp](../mocks/decision/schemas-reference-tabs.png) and every final supplied capture were opened for this pass: [desktop](desktop.png), [mobile](mobile.png), [1280](schemas-1280.png), [1600](schemas-1600.png), [dark](schemas-dark.png), [mobile original JSON](schemas-mobile-raw.png) and [user 1280](user-1280.png). They show populated Schemas content, the intended connected workbench and distinct nested-field containment. The transient viewport capture was excluded. This pass did not launch a browser, create new captures, perform a contrast measurement, rerun tests or inspect OS clipboard contents.

## Comparison with the incumbent system

The implementation uses the actual Console's `--ink`, `--muted`, `--faint`, `--surface`, `--ground`, `--hairline`, `--readout`, `--telemetry` and violet variables rather than adding a schema palette. The inherited source defines light ink `#24252b`, ground `#f5f5f7`, white surface and violet `#5850df`; dark remaps ink to `#f1f4fa`, ground to `#0e1420`, surface to `#171e2a` and violet to `#8a83ff`. Captures visibly retain the incumbent quiet near-neutral ground and blue-black dark working environment. This report does not turn source values into new normative tokens or claim exact screenshot color equivalence.

The 12px workbench radius and 7px controls come from the existing panel/control variables. The index uses the same hover surface and violet selected wash as navigation, and the view tabs reuse the shared underline treatment. Authored SVG icons and the existing brand mark remain the controls and identity vocabulary. The workbench receives no decorative shadow, raster plate, gradient, side stripe or new motion treatment.

Typography preserves the documented telemetry boundary: human explanations stay sans-serif while machine-shaped labels, identifiers and source JSON use monospace. The larger Schemas and contract headings are surface-specific hierarchy observed in the finished code, not additions to the global type scale. Field prose is bounded on desktop and reflows on mobile. The footer keeps byte limits and the schema identifier subordinate to the reading task.

The existing shell supplies the rail, breadcrumb, collapse preference, theme toggle and mobile drawer. Reference chrome truthfully reads Protocol → Schemas and Protocol reference; this global catalogue does not imply selected-project inference or live telemetry. Route state preserves the selected contract and view, while links retain surrounding scope for returning to investigative surfaces.

On desktop the index occupies 250px, reduced to 190px at 1100px. The reading pane keeps the table's four dimensions: Field, Type, Presence and Constraints. At 760px the index wraps above the pane, versions follow the title/subtitle, and each field becomes a stacked row with visible Type, Presence and Constraints labels; semantic table headers remain available. These are local reading-surface adaptations within the incumbent Console world. The final mobile raw capture shows the existing line-numbered code viewer contained within the pane; its source retains keyboard focus and scrollable long values.

The corrected hierarchy reserves the same 14px disclosure slot and 8px gap for expandable and terminal rows. The terminal spacer is noninteractive and `aria-hidden`. Source applies 16px per depth step through depth four; deeper rows show the full escaped JSON Pointer so the capped indentation does not hide ancestry. Final captures visibly separate `source` from `url`, `line` and `column`, and separate the fingerprint parent from its array item. The independent verdict reports matching 16px DOM steps; this pass corroborated the geometry in source and captures rather than remeasuring it. Chevron rotation communicates expansion and is disabled under reduced motion.

## Truth and local fidelity authority

The source consumes the bundled public protocol registry and resolves references locally. Envelope, Event and Context are common contracts; Session, Page, Error, Performance, Network, Interaction and Custom are payloads. Presence refers to the containing object, while array items and schema rules are explicitly distinct. Expansion is bounded by row, reference-chain and depth limits, with the original JSON Schema as the complete reference.

Examples are labeled synthetic and separate from captured project data. Both code views use the incumbent viewer in JSON-only mode, with adjacent copy and truthful failure guidance. Existing event use retains its JSON/YAML control. The build/ingestion-version caveat, runtime-depth explanation, exported 64 KiB event and 1 MiB envelope limits, and identifier copy keep schema facts separate from transport/admission policy. Generated-comp claims of URL format, positive line/column numbers, chronological stack order and item Optional presence were reconciled to protocol truth rather than preserved as factual authority.

The owner chose candidate 2 on 2026-10-01 and answered **“同意”** to **“保留第二种布局，字体、间距和响应式沿用现有 Console 规范，不要求逐像素复刻生成图？”**. This explicitly retains the composition while allowing incumbent fonts, spacing and responsive conventions. It is only a local comp-authority exception; it does not authorize a global redesign or relax content, accessibility, behavior or finish review.

The inspected build record retains its earlier failed responsive gate result of `0.7749`, with five missing-region flags, and the quoted force reason. It remains a failed gate comparison closed by the approved exception, not a numeric pass. After the hierarchy correction, the advisory comp-diff was rerun against the regenerated desktop capture: [final report](diff/final/report.json), created at `2026-10-01T11:32:00.701Z`, records overall `0.7751` and verdict `drift`. This later advisory result does not replace the retained gate history or revoke the owner exception. The independent review explains the earlier missing flags with paired-crop displacement and full-capture evidence; the coordinating task also opened the new source region and three weakest paired crops and reports continuing crop displacement. This documentation pass directly checked the final full captures and the final report's metadata, not either complete diff inventory. The corrected hierarchy remains visibly resolved while numeric fidelity drift remains disclosed.

## Verification and finish scope

The coordinating task supplied passing formatting, lint, type and build checks, 276 passing tests, and four opt-in service integration tests skipped. Its shipping-asset provenance scan covered six existing public rasters with zero missing provenance; no new shipping raster is introduced. These are supplied verification results, not checks rerun by this documentation pass.

The same independent reviewer appended a resolved verdict for its original nested-containment finding and returned **ship within the one-finding correction scope**. The reviewed spacer, depth steps and full Pointer fallback are supported by the source and final captures inspected here. That verdict is not a fresh whole-surface recertification. Workflow closure, README/ADR updates and the acceptance record are owned by the coordinating task and are outside this report's write boundary.

No hosted-runtime, production-load, ingestion-service, native clipboard or comprehensive accessibility acceptance is established by this report. Local visual evidence, inspected code and supplied repository verification have their stated limits.

## Preserved canon and drift not canonized

[DESIGN.md](../../DESIGN.md) and [design.json](../design.json) were left unchanged. The ordinary extension is consistent with the incumbent implementation and later shell/theme prose; its contract-index composition, type sizes, 1100px/760px adaptations and 16px depth treatment stay local rather than becoming global design-system rules.

The pre-existing drift already recorded by Live remains: root frontmatter describes the earlier cool-blue palette and 16px instrument radius, while the current Console has gray semantic fields and a 12px panel radius. Its older 980px/640px layout story and sidecar breakpoints do not fully describe the current operational surfaces. The sidecar still carries Avenir component snippets, old palette fallbacks and foundation-navigation examples despite current native typography and the shared shell. Its invented uppercase instrument caption and glyph-mark navigation example were not treated as instructions for this extension or canonized again. Refreshing those artifacts was not authorized.

Context loading also reported an unset build path and orphaned surface targets. The supplied Schemas artifact exists and its explicit brief read succeeded; the launcher resolved the app root while listing repository-relative targets, so the orphan report is not evidence that this surface was removed. No configuration or brief was repaired. Those administrative notices do not broaden this ordinary extension.

No remaining material drift from the incumbent visual world was identified within this documentation comparison. Root/sidecar drift, failed numeric fidelity evidence and the narrowly scoped review verdict remain disclosed, without canon repair or global token changes.
