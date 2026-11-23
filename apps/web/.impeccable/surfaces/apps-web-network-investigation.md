---
version: 1
slug: 'apps-web-network-investigation'
primary_target: 'apps/web/src/main.tsx'
related_targets: ['apps/web/src/network-query.ts', 'apps/web/src/styles.css']
---

# Network investigation surface brief

- Scope/mode: authenticated Console network overview and investigation; Operate.
- Audience/job: a frontend developer identifies failing or slow request targets, sees page and release context, and returns to the underlying event or session evidence.
- Entry point: primary Network navigation. Preserve project, environment, time range, source, initiator, method, outcome, page path, and release in URL state.
- Data boundary: show only the protocol's sanitized URL, method, status, timing, initiator, and success state. Never imply access to query strings, credentials, headers, cookies, or bodies.
- Primary composition: shared Console controls, loaded-window totals, request-group ledger, selected duration readout, response distribution, and a contextual link back to Events.
- Ranking rule: most recently observed first. Use p75 as the primary row duration and failure share as the health cue.
- Responsive rule: share the Issues and Performance connected workbench. Below 980px detail follows the ledger; phone widths remove secondary row health without horizontal page overflow.
- Required states: API connection, loading, query error, empty result, populated groups, selected group, and additional-page loading.
- Illustrative aggregates obey the selected window and remain explicitly labeled as non-production telemetry.
