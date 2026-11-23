---
version: 1
slug: 'apps-web-release-health'
primary_target: 'apps/web/src/release-health.tsx'
related_targets:
  ['apps/web/src/release-query.ts', 'apps/api/src/releases.ts', 'apps/web/src/styles.css']
---

# Release Health surface brief

- Scope/mode: authenticated Console release health overview and investigation; Operate.
- Audience/job: a frontend developer identifies which observed version carries elevated errors, poor field-performance samples, or failed requests, then opens the underlying evidence.
- Entry point: primary Releases navigation. Preserve project, environment, time range, and data source in URL state; selected release is local UI state in this first slice.
- Data boundary: use the authorized bounded release aggregate query over existing version context. Exclude unversioned events. Do not infer deployment times, adoption, or a composite health score.
- Primary composition: shared Console controls, an evidence-window overview, latest-release ledger, selected signal readout, and exact-release links to Events, Issues, Performance, and Network.
- Truth rule: keep signal categories separate. Cross-release session counts are not unique sessions because the same session may carry multiple versions. Observation times are evidence bounds, not deployment metadata.
- Ranking rule: latest observed evidence first, with version as the stable cursor tie-breaker. Error share may use captured events as its denominator; other categories remain explicit counts.
- Responsive rule: desktop keeps ledger and detail connected side by side. On narrow screens the order is controls, overview, ledger, then detail, without horizontal page overflow.
- Required states: API credentials required, loading, query error, empty result, populated releases, selected release, and additional-page loading. Totals appear only when a query is active and resolved.
- Illustrative aggregates remain explicitly labeled as non-production telemetry.
