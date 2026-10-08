# ADR-052: Read-only protocol catalogue

Status: accepted

Date: 2026-10-01

## Context

Live completes the initial event-observation workflow. The owner approved Schemas V1 as a read-only reference for supported event contracts, including common fields, payload constraints, examples, and the original JSON Schema. The existing protocol package already distributes its schema files through the public `@spectro/protocol/schemas/*` export. These files, rather than observed customer events or a second handwritten field model, remain the cross-language source of truth.

## Decision

Bundle the supported protocol catalogue with the React + Vite Console. Expose the schema documents through the protocol package's public index so the Console can consume a typed, local document registry without importing private package paths. Keep presentation labels and navigation in the Console.

- Reference the existing Draft 2020-12 schema documents without changing their validation semantics or wire versions. Display event and envelope versions separately.
- Resolve document references and JSON Pointer fragments against the bundled registry. Schema identifiers are identities, not a promise that their HTTPS addresses serve files. Viewing a contract must not initiate network requests to those addresses.
- Show the transport envelope, common event fields and context, and the seven event-specific payload contracts. Present requiredness at the containing object's level and preserve conditional, alternative, array, and recursive structures. Bounded expansion must leave reference/alternative information available rather than imply it was flattened away.
- Distinguish schema-expressed constraints from runtime admission limits, using the protocol's exported limit constants for the latter. A JSON Schema view alone is not the entire ingestion admission policy.
- Provide synthetic, privacy-safe examples checked against the real validators. Do not copy live customer payloads into reference examples. Explain the difference between what the protocol permits and what browser plugins capture by default.
- Label the surface as the protocol supported by this Console build. It is global reference material, not a project-specific inventory, inferred schema, schema editor, compatibility checker, or promise about a separately deployed ingestion version.
- Preserve organization/project/environment navigation context, while omitting telemetry time-range and refresh controls from the reference surface. Keep contract selection and view in URL state; expansion is local UI state.
- Reuse the Console's access gate, shell, themes, and read-only data viewer. This adds no query endpoint, persistence, schema registration API, subscription, or deployment unit.

## Alternatives

### Copy fields and constraints into the Console

Creates a second contract that can drift from ingestion validation. Keep only human-facing explanations in the Console; derive structural information from the shipped schema documents.

### Fetch schemas from the product API or their identifier URLs

Adds availability and version negotiation concerns to static reference material. Revisit if independently deployed version discovery becomes a product requirement; document that protocol before implementation.

### Infer customer schemas from captured events

Answers a different question and introduces aggregation, privacy, sampling, and observed-versus-allowed semantics. Defer to a separately scoped feature and ADR.

## Acceptance evidence required

- Public exports build correctly and registry documents are the original JSON Schema sources; package consumers do not depend on private paths.
- Local cross-document references, JSON Pointer escaping, nested requiredness, alternatives, recursion, and bounded traversal behave accurately and fail safely on unsupported or unresolved structures.
- Every example passes the existing strict validator; invalid examples and the documented runtime limits are covered at the narrowest useful layer.
- URL selection, invalid selection recovery, copy success/failure, keyboard operation, readable constraints, and no remote schema fetches.
- Desktop, narrow-screen, light/dark, and reduced-motion checks against the selected Schemas direction contract; repository checks and builds.

## Compatibility and rollback

No event protocol, SDK capture policy, ingestion behavior, database migration, or authentication/session semantics change. Catalogue exports are additive. Removing the Console route and navigation entry rolls back the feature without affecting event collection or existing raw schema exports.

## Verification

The owner approved the read-only scope and selected composition. The implemented reference passed repository checks and browser inspection; the independent finish review's nested-field correction was scored resolved. See [Schemas V1 verification](../operations/CONSOLE_SCHEMAS_V1_ACCEPTANCE.md) for evidence, the owner-approved native-system fidelity boundary, and the explicit exclusion of hosted-service and release acceptance.
