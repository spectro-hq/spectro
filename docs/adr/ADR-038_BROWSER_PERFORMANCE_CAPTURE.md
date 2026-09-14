# ADR-038: Browser performance capture V1

Status: accepted
Date: 2026-09-14

## Context

Spectro needs field performance signals that match established Web Vitals semantics and remain correctly associated with session and page context. Reimplementing CLS, INP, LCP, FCP, and TTFB would duplicate subtle browser lifecycle, back/forward cache, interaction grouping, and soft-navigation logic maintained by the Chrome team.

The `web-vitals` reporting functions install observers and page-lifetime listeners but do not return teardown functions. Calling them repeatedly during SDK reinitialization would accumulate observers. The attribution build also exposes DOM targets and complex `PerformanceEntry` objects that must not be copied directly into the event protocol.

## Decision

- `@spectro/browser` uses `web-vitals` 6 for CLS, FCP, INP, LCP, and TTFB instead of implementing their algorithms.
- The attribution build is used, but Spectro supplies a privacy-safe target generator and maps only an explicit primitive allowlist. Raw DOM nodes, default selectors, `PerformanceEntry` objects, resource URLs, and arbitrary attribution fields are never queued.
- A target is reported only as a bounded `monitor:<id>` value when the element has a valid `data-spectro-monitor-id`; every other target is reported as `element`.
- A module-level bridge installs each `web-vitals` callback at most once per loaded SDK module. Browser client instances subscribe and unsubscribe from the bridge, so `destroy()` stops Spectro delivery and reinitialization does not add another set of Web Vitals observers.
- CLS, FCP, INP, and LCP enable `reportSoftNavs`. TTFB is reported only for document navigations because soft-navigation TTFB is defined as zero and would be misleading as a network measurement.
- Each callback becomes an immutable performance event. The Web Vitals metric ID, delta, navigation ID, navigation start time, and a bounded attribution allowlist provide correlation when a metric is reported more than once.
- Web Vitals `needs-improvement` maps to protocol `needs_improvement`. CLS uses `score`; the other Web Vitals use milliseconds.
- The browser SDK retains a bounded lookup from sanitized navigation URL to session/page context. Performance events use the metric's `navigationURL` to select that context instead of blindly using whichever SPA route is current when a delayed callback runs.
- Native browser APIs supplement the library with `long_task` events and one `navigation_timing` summary. Long tasks include only bounded numeric timing fields. Navigation timing includes bounded numeric phase durations and its navigation type.
- Automatic performance capture is enabled by default and can be disabled as a whole or by Web Vitals, long-task, and navigation-timing category. Unsupported browser APIs degrade silently.
- Resource Timing is deferred to the network instrumentation milestone, where URL privacy, request correlation, sampling, and duplicate network/performance signals can be decided together.

## Alternatives considered

### Implement all metrics with `PerformanceObserver`

Rejected because correct INP and CLS computation and page lifecycle finalization are not small local implementations. Divergence from Chrome UX Report semantics would make collected values misleading.

### Register `web-vitals` on every `init()`

Rejected because the public registration functions have page-lifetime observers and no unsubscribe return value. Reinitialization would increase memory and duplicate callbacks.

### Queue the complete attribution object

Rejected because it contains browser objects, DOM-derived selectors, URLs, and fields whose shape can change independently of the Spectro protocol.

### Capture every Resource Timing entry now

Rejected because it is high volume and overlaps the planned network plugin. It needs one shared privacy, correlation, and sampling policy.

## Compatibility and consequences

- The existing performance payload schema is sufficient; the Event Protocol does not change.
- `web-vitals` becomes a direct dependency of `@spectro/browser` and is not introduced into protocol or core packages.
- Core capture inputs gain an optional event-local context override so delayed instrumentation can preserve the page that produced a signal without mutating global client context.
- Soft-navigation Web Vitals are available only where the browser API supports them. Spectro does not fabricate equivalent measurements in unsupported browsers.
- The underlying Web Vitals observers remain page-scoped by library design, while Spectro subscriptions and native observers are detached on `destroy()`.

## Migration and rollback

Performance capture is a browser plugin around the public core capture contract. It can be disabled per initialization or removed without changing ingestion, processing, or storage. Removing `web-vitals` would require a replacement that preserves metric semantics and the singleton registration guarantee.
