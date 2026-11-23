---
version: 1
slug: 'apps-web-src-schema-reference-tsx'
primary_target: 'apps/web/src/schema-reference.tsx'
related_targets: ['apps/web/src/schema-catalogue.ts']
---

# Schemas V1

Mode: Read. Developers consult supported protocol contracts while integrating or investigating the SDK. Success is finding a field's exact type, containing-object requiredness and constraints, then comparing a safe example or copying the original schema.

Scope: global, read-only catalogue from the protocol package. Preserve the Console shell, scope navigation, typography, themes and existing machine-data viewer. No customer schema inference, editor, validator playground, new query endpoint or protocol change. ADR-052 owns architecture.

## Direction contract

THESIS: A contract index and one broad reading pane keep long constraints legible. Fields, Example and JSON Schema are separate views of the same contract.

OWN-WORLD: Inherit Spectro's native system fonts, quiet gray ground, white working surfaces, violet selection, hairlines and authored navigation icons; dark mode keeps those roles.

STORY: Choose Envelope, Event, Context or a payload; read nested field structure, compare a synthetic valid example, inspect/copy source JSON Schema. Explain runtime limits separately.

FIRST VIEWPORT: Shared rail/topbar, page heading and event/envelope versions. One connected workbench: compact contract index left, Error payload heading and description right, Fields/Example/JSON Schema tabs, wide field table, compact limits and schema identity footer. Fields is initial view. Copy belongs beside the code view.

FORM: Candidate 2, reference-tabs; seed a3ad2e68. Owner selected the second layout on 2026-10-01. Approved comp: .impeccable/mocks/decision/schemas-reference-tabs.png. Correct factual defects listed in .impeccable/schemas-candidates.md; preserve composition. Signature interaction: expand a field in place while parent context remains visible; URL retains selected contract and view.

Fidelity boundary: On 2026-10-01 the owner answered “同意” to retaining the second layout while typography, spacing, and responsive behavior follow the incumbent Console system without pixel-for-pixel reproduction of the generated comp. This is a local composition reference, not a global system change. All finish-review and accessibility requirements remain.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Finish record

2026-10-01: The independent full review returned one material hierarchy fix. A single correction batch reserved equal disclosure slots for expandable and terminal rows; children now have a 16px depth step, and deeper capped rows retain their full JSON Pointer. The reviewer scored this original finding resolved and returned `ship` within that correction scope, not a new whole-surface certification.

The fresh documentation comparison preserved the incumbent root DESIGN.md and design.json and reported their pre-existing drift. No new shipping raster was introduced. Repository verification passed with 276 tests and four opt-in service integration skips. See docs/operations/CONSOLE_SCHEMAS_V1_ACCEPTANCE.md and .impeccable/review/schemas-finish-review.md for the bounded evidence and owner-approved fidelity exception; no hosted-service or release acceptance is claimed.
