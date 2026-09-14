# ADR-039: Browser network capture V1

Status: accepted
Date: 2026-09-15

## Context

Spectro needs network signals that can be correlated with the session and page that initiated a request. Fetch and XMLHttpRequest are long-lived browser globals, so naive wrapping during every SDK initialization would stack instrumentation, emit duplicates, and risk changing application behavior. Spectro's own envelope delivery can also pass through an instrumented fetch implementation and must never recursively generate telemetry.

Request URLs can contain credentials, query parameters, and fragments. Headers, cookies, and request or response bodies commonly contain secrets and are outside the V1 protocol. Resource Timing adds useful asset visibility, but collecting every resource by default would create high event volume before production sampling defaults are decided.

## Decision

- Browser network instrumentation is enabled by default for Fetch and XMLHttpRequest. It can be disabled with `network: false`; Fetch, XMLHttpRequest, and Resource Timing can also be toggled independently.
- Successful and failed operations emit `fetch_request`, `xhr_request`, or `resource_request` network events through the normal core capture pipeline.
- Events contain only an uppercase bounded method, a sanitized URL, monotonic start and duration values, an optional status, the initiator, and success state. Headers, cookies, request bodies, response bodies, response text, and arbitrary request objects are never inspected or queued.
- URL sanitization removes credentials, queries, and fragments, accepts only HTTP(S), resolves relative URLs against the page URL, and enforces the protocol's 2,048-character limit.
- HTTP success follows Fetch `Response.ok` semantics and the equivalent 200–299 range for XMLHttpRequest and Resource Timing. Rejected Fetch requests and XHR network, timeout, or abort completions are captured as unsuccessful without serializing the thrown value.
- Instrumentation preserves the original Fetch promise and XMLHttpRequest behavior. Listener, normalization, and capture failures are contained and never replace an application response or exception.
- A module-level bridge owns the wrappers and native observer. Multiple subscribers share one installation. The first subscriber installs instrumentation; the last unsubscribe restores a wrapper only when it is still the active global function and disconnects the Resource Timing observer.
- Spectro's exact ingestion envelope URL is excluded before capture. The transport also retains the Fetch implementation supplied or available at client construction, so later global wrapping does not redirect SDK delivery through itself.
- Resource Timing is available with `captureResourceTiming: true` and is off by default until sampling and volume defaults are supported. Fetch, XMLHttpRequest, and beacon initiators are excluded from Resource Timing to avoid duplicates. Cross-origin entries with unavailable status remain valid resource observations.
- Each Fetch and XMLHttpRequest observation retains the page URL present when the operation starts. Completion uses the lifecycle's bounded URL-to-context lookup so an in-flight request does not inherit a later SPA route. Resource Timing has no request-start hook and uses the active page context when its observer delivers the entry.

## Alternatives considered

### Patch Fetch and XMLHttpRequest on every `init()`

Rejected because reinitialization would stack wrappers, duplicate events, complicate restoration, and increase the chance of altering host behavior.

### Capture headers and bodies with redaction

Rejected because allowlisting all sensitive formats is not reliable, body access can consume streams or change behavior, and V1 investigations do not require payload contents.

### Enable all Resource Timing entries by default

Rejected until production sampling and volume limits are decided. Applications can opt in when asset-level visibility is worth the event volume.

### Treat only transport rejection as failure

Rejected because HTTP 4xx and 5xx responses are operational failures even though Fetch resolves them normally.

## Compatibility and consequences

- The existing network payload schema and event envelope remain unchanged.
- `@spectro/browser` gains network capture configuration but no new public imperative method.
- Fetch and XMLHttpRequest monkey-patching is contained in the browser runtime adapter; protocol and core packages remain browser-independent.
- Code that retained Fetch or XMLHttpRequest methods before Spectro initialization cannot be observed. Cross-origin Resource Timing may omit status and detailed timing according to browser policy, and a resource entry delivered after an SPA transition can inherit the newer page context.
- Default event volume grows with application Fetch and XMLHttpRequest traffic. Resource volume does not grow unless explicitly enabled.

## Migration and rollback

Network capture is a browser plugin around the existing public core capture contract. It can be disabled per initialization or removed without changing ingestion, processing, storage, or the event protocol. Rollback removes the plugin wiring and restores owned runtime wrappers when the final subscriber stops.
