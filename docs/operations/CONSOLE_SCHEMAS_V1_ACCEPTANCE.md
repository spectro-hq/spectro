# Schemas V1 verification record

Date: 2026-10-01

Status: owner accepted the local reference surface on 2026-10-08. Implementation verification and design documentation comparison are complete; responsive gate closed by owner-approved fidelity exception; the independent review's one material correction scored resolved (`ship` within that correction scope). Hosted-service and release acceptance remain outside this record.

Owner acceptance: “我看了应该没啥问题，可以提交了。”

## Scope

The owner selected the second composition, the contract index with Fields / Example / JSON Schema tabs. The reference bundles the existing protocol documents through an additive public package export. No original JSON Schema, wire version, SDK capture behavior, authentication semantics, API, or persistence changes.

Generated proposal content is not protocol authority: source line/column minima are 0; source URL is a bounded string without a schema URL-format restriction; stack order is unspecified; array items are not optional object properties. Schema identifiers are copied, not fetched.

## Automated evidence

`pnpm verify` passed after the independent review's hierarchy fix: formatting, lint, TypeScript checks, 276 tests, and all package builds. Four opt-in real-service integration tests were skipped; no live hosted-auth or ingestion acceptance is claimed here.

The 37 new tests cover original schema exports, local reference and JSON Pointer resolution, unsupported references, nested requiredness, conditional/alternative structures, recursion and traversal limits, boolean schemas, URL selection, safe synthetic examples validated by the real protocol validators, clipboard success/fallback/failure, and disclosure slots/full JSON Pointer labels after the indentation cap. The schema reference remains a lazy route (24.27 kB, 7.16 kB gzip in this build).

## Browser evidence

Two main inspection rounds and one reviewer-directed correction batch used the local illustrative Console at `http://127.0.0.1:5174/schemas`. Captures show the complete document from the top; native capture excludes a 10px scrollbar from the requested viewport width.

- 1280, 1440, and 1600 desktop widths: no document horizontal overflow; all four field headers present.
- 390 narrow viewport: grouped catalogue navigation and stacked field details; all four headers remain exposed to the accessibility tree. Long raw JSON scrolls inside its code viewport, rather than widening the document. The code viewport is keyboard-focusable.
- Light/dark captures; reduced-motion disclosure transition is effectively disabled (0.00001s under the existing global reduced-motion rule).
- Nested stack fields expand and collapse. Tab arrow/Home navigation updates URL selection and focus. Switching contracts preserves explorer navigation scope.
- Copy UI feedback was checked; exact copied text and denied-clipboard fallback are covered by unit tests. The harness clipboard read did not independently establish OS clipboard contents.
- No remote schema-identifier requests were observed during contract navigation.

Required captures are under `.impeccable/review/`: `desktop.png`, `mobile.png`, `schemas-1280.png`, `schemas-1600.png`, `schemas-dark.png`, `schemas-mobile-raw.png`, and `user-1280.png`.

## Recorded fidelity exception

The comp-sized hero gate passed at 85%. The 1440px responsive comparison did not pass: width normalization places description, build note, table heading, footer, and top rule outside their narrow reference crop boxes. Paired crops and full captures were inspected; those elements exist in the built surface. The build record retains the earlier responsive result of 0.7749; the advisory comparison rerun after the hierarchy correction returned 0.7751 (`drift`). Neither is described as a pixel-comparison pass.

On 2026-10-01 the owner answered “同意” to “保留第二种布局，字体、间距和响应式沿用现有 Console 规范，不要求逐像素复刻生成图？” The selected composition remains authoritative; pixel-level typography, spacing, and responsive fidelity to the generated image do not. The supported `build-phase advance --force --reason` operation records this exact consent, closes responsive, and opens review. This exception does not change the global design system or waive protocol accuracy, accessibility, or behavior.

A fresh independent finish reviewer inspected the primary implementation, representative tests, all seven required captures, the direction contract, and paired comp comparisons. The full review returned `fix` with the one hierarchy finding below. After the correction, the same reviewer reopened all seven captures and scored that finding resolved, returning `ship` within the original one-finding scope. This verdict is not a fresh whole-surface recertification. The reviewer did not run a browser, services, or repository tests; runtime evidence comes from the main thread's checks. See [the independent report](../../.impeccable/review/schemas-finish-review.md).

## Reviewer-directed correction

The full independent review returned `fix` with one material finding: expandable parents used a 14px icon and 8px gap, while leaf rows used an 8px margin, making depth-one leaves only approximately 2px offset from their parents. The fix reserves the same disclosure slot for both. Every depth now has a 16px offset; beyond the four-level visual indentation cap, labels show the full JSON Pointer rather than losing their path. Leaf spacers are non-interactive and hidden from assistive technology.

One correction batch rebuilt the Console, reran `pnpm verify`, and recaptured all seven required views over the same files. DOM-backed geometry measured `source` at x520 and its leaves at x536 on all three desktop widths, and x62/x78 on mobile. The array leaf has the same offset. No document horizontal overflow was observed. All recaptures were opened and checked before returning them for the reviewer verdict. The temporary `schemas-transient-viewport.png` is not acceptance evidence: viewport reset was still settling, and that capture was excluded rather than passed under an incorrect viewport name.

## Documentation comparison

A fresh independent documenter inspected the source, approved composition, all seven final captures, surface brief, review verdict, and incumbent design records. It found the ordinary extension consistent with the current Console implementation. [The documentation report](../../.impeccable/review/schemas-documentation.md) records the native typography, themes, connected workbench, responsive field layout and corrected hierarchy.

`DESIGN.md` and `.impeccable/design.json` remain unchanged. Their pre-existing palette, radius, typography-snippet and breakpoint drift is reported, not repaired or promoted into new global rules. No new shipping raster was introduced; the provenance scan checked six existing public assets and reported zero missing provenance. No UI changes followed the final correction batch.
