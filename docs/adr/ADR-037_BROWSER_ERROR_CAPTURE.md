# ADR-037: Browser error capture V1

Status: accepted  
Date: 2026-09-14

## Context

Errors are the next browser signal after session and page context. The SDK needs to capture uncaught JavaScript failures, unhandled promise rejections, failed resources, and explicit application-reported exceptions without crashing the host application or copying arbitrary private object state into events.

Browser error shapes differ across engines. Stack strings are unbounded and can contain query strings, credentials, or fragments. Resource error events do not carry an `Error`, and rejection reasons can be any JavaScript value. Final issue grouping already belongs to server-side processing under ADR-013.

## Decision

- Browser error instrumentation is enabled by default and can be disabled with `errors: false`. Runtime, unhandled-rejection, and resource capture can be enabled independently through error options.
- The plugin listens for capture-phase `error` events and `unhandledrejection` events. It never calls `preventDefault()` or otherwise changes host error handling.
- Uncaught JavaScript errors emit `runtime_error`, unhandled rejections emit `unhandled_rejection`, and resource failures emit `resource_error`.
- `captureException(value, options)` emits `manual_error`; manual errors default to `handled: true` and may include bounded fingerprint hints.
- `Error`-like values are normalized without serializing arbitrary objects. Primitive reasons become bounded messages; opaque object reasons use a stable fallback message.
- Raw stack strings are never transported. Recognized V8, Firefox, and Safari-style locations are converted to at most 50 structured frames. Unrecognized lines are discarded.
- Error messages, names, function names, URLs, frames, and fingerprint hints are bounded before entering the core capture pipeline.
- Source and frame URLs exclude credentials, queries, and fragments. Resource capture reads only a bounded tag name and URL-like `currentSrc`, `src`, or `href` property; it never captures DOM text, HTML, input values, request bodies, response bodies, cookies, or headers.
- SDK normalization and listener failures are contained and reported through `onError`. `destroy()` removes the plugin listeners.
- Client-provided fingerprint values are hints only. Final normalization and fingerprinting remain server-side.

## Alternatives considered

### Send the raw stack string

Rejected because it is unbounded, inconsistent across engines, harder to query, and can contain sensitive URL components.

### Serialize arbitrary rejection reasons

Rejected because objects may be cyclic, invoke getters, contain secrets, or produce large payloads. Only safe error-like scalar fields are inspected.

### Fingerprint errors in the browser

Rejected because source maps, normalization policy, and cross-release grouping belong to the processing layer and must evolve independently of deployed SDKs.

### Patch `console.error`

Rejected because console output is not a reliable error boundary, patching changes a widely used host API, and console arguments frequently contain private application data.

## Compatibility and consequences

- The Event Protocol does not change; the existing error payload schema is used.
- The browser SDK public surface gains `captureException()` and error capture configuration.
- Automatic error events inherit the active session and page context established by ADR-036.
- Cross-origin browser restrictions may leave some runtime or resource details unavailable; valid minimal events are still captured.
- Stack parsing is deliberately conservative. Unsupported stack lines are omitted rather than transported raw.

## Migration and rollback

The implementation is a browser plugin around the existing core capture contract. Automatic capture can be disabled per initialization or the plugin can be removed without changing protocol, ingestion, processing, or storage. The manual API remains a thin structured error capture path.
