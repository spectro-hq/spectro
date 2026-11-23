---
version: 1
slug: 'apps-web-performance-investigation'
primary_target: 'apps/web/src/main.tsx'
related_targets: ['apps/web/src/performance-query.ts', 'apps/web/src/styles.css']
---

# Performance investigation surface brief

- Scope/mode: authenticated Console performance overview and investigation; Operate.
- Audience/job: a frontend developer finds degraded field metrics, identifies the affected page and release, and returns to the underlying event evidence.
- Entry point: primary Performance navigation. The route preserves project, environment, time range, data source, metric, page path, and release.
- Data boundary: use the authorized performance aggregate query with a bounded time window, exact optional filters, stable metric-and-page grouping, and opaque keyset pagination.
- Primary composition: compact query controls, loaded-window totals, metric/page ledger, selected group readout, rating distribution, and a contextual link back to Events.
- Metric rule: keep native units and labels. LCP, INP, FCP, TTFB, long tasks, navigation, and resource timing display milliseconds; CLS remains unitless.
- Ranking rule: sort groups by most recent evidence. Show p75 as the primary row value and poor-rating share as the health cue; averages alone must not imply user experience quality.
- Responsive rule: desktop keeps ledger and detail connected side by side. Below 980px the detail follows the ledger; phone widths reduce rows to metric, page, and p75 without horizontal overflow.
- Required states: invalid filters, API connection, loading, query error, empty result, populated groups, selected group, and additional-page loading.
- Illustrative aggregates must obey the selected time window and remain explicitly labeled as non-production telemetry.
