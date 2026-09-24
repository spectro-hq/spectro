# Spectro Protocol and SDK Interfaces V1

## Protocol boundary

`@spectro/protocol` defines schemas, protocol types, version constants, serialization constraints, and strict validation. It does not implement browser instrumentation, sampling, transport policy, storage, or product business logic.

## Transport and event envelopes

```ts
interface Envelope {
  version: 1;
  sentAt: number;
  items: Array<{ type: 'event'; payload: SpectroEvent }>;
}

interface SpectroEvent<TType extends EventType, TPayload> {
  id: string;
  type: TType;
  name: string;
  version: 1;
  timestamp: number;
  context: EventContext;
  payload: TPayload;
}
```

Event types are `session`, `page`, `error`, `performance`, `network`, `interaction`, and `custom`. Event names are lowercase snake_case and at most 64 characters.

## Context

Every event includes SDK identity, project identity, and environment. Optional namespaces include session, user, page, device, browser, OS, release, trace, and bounded tags. Authentication is carried by `X-Spectro-Key` or an authorization header, never in event JSON.

## Payloads

- Error: mechanism, message, handled state, bounded stack frames, source, and optional fingerprint hints.
- Performance: metric, numeric value, unit, rating, navigation type, and bounded attribution.
- Network: sanitized URL/method, response status, timing, initiator, and success state.
- Interaction: stable monitor ID and limited target metadata; target text is absent by default.
- Custom: JSON-only properties used by `track(name, properties)`.
- Session and page: lifecycle actions and minimal contextual data.

## Validation and limits

- The SDK normalizes and performs best-effort validation; ingestion validates strictly.
- Before enqueueing, custom properties, user traits, and tags recursively remove sensitive keys for passwords, authorization, cookies, input values, secrets, and request/response bodies.
- Single serialized event maximum: 64 KiB.
- Serialized envelope maximum: 1 MiB.
- Strings, arrays, object depth, stack frames, and tag counts are bounded by schemas or SDK normalization.
- Rejected envelopes are atomic in V1: no items are persisted.

## First public SDK slice

```ts
interface SpectroClient {
  track(name: string, properties?: JSONObject): string | undefined;
  flush(options?: FlushOptions): Promise<FlushResult>;
}

interface FlushOptions {
  keepalive?: boolean;
  priority?: 'immediate' | 'batch';
}

interface BrowserClient extends SpectroClient {
  captureException(value: unknown, options?: CaptureExceptionOptions): string | undefined;
  destroy(): void;
}

interface Transport {
  send(envelope: Envelope, options?: FlushOptions): Promise<TransportResult>;
}
```

`track()` produces a custom event through the same builder and context path future instrumentation uses. It returns `undefined` after reporting invalid input through the optional `onError` hook; SDK failures never escape into the host application. Browser clients send unhandled runtime errors, unhandled promise rejections, unhandled manual errors, timeouts, HTTP 408, and 5xx network failures after a short coalescing window. They send routine events every five seconds and start a batch early at 50 queued events. An urgent send includes up to eight recent earlier events from the same session and page when available. When the document becomes hidden or receives `pagehide`, clients make a best-effort keepalive flush limited to 60 KiB and 100 events; events that do not fit remain queued for a later flush. `flush({ keepalive: true })` requests the same bounded transport policy; `flush({ priority: 'immediate' })` sends the urgent lane. Transport failures are reported through `onError`, drained events are restored with bounded exponential retry, and the resolved result reports zero sent with the remaining queue count.

The in-memory browser queue is limited to 500 events and 4 MiB. Browser clients persist urgent events in IndexedDB by default so they can retry them after a reload or reconnect. The outbox is scoped by project and environment, retains at most 100 events and 1 MiB for 24 hours, and gives up after eight failed attempts. Set `persistence: false` to disable it. Only validated, privacy-filtered event records are stored, never API keys. If IndexedDB is unavailable, the SDK uses memory only; storage failures are reported through `onError` and delivery continues from memory when possible. Delivery across ambiguous failures is at-least-once, so a retry may be observed more than once.

`init()` follows the same containment rule: malformed runtime options or missing platform capabilities are reported through `onError` when available and return `undefined` rather than throwing into the host application.

Browser fetch transport does not set `keepalive` for ordinary envelopes because browser keepalive quotas are smaller than the protocol's 1 MiB envelope limit. The bounded keepalive policy is specified in [ADR-048](../adr/ADR-048_BROWSER_BATCH_DELIVERY.md).

## Browser session and page lifecycle

Browser `init()` enables the session/page lifecycle plugin by default. Sessions are scoped to a tab and project/environment, survive reloads through `sessionStorage`, and rotate after 30 minutes without SDK or browser activity. A new session emits `session_start`.

The inactivity timeout can be set with `lifecycle.sessionTimeoutMs`; `lifecycle: false` disables automatic lifecycle instrumentation. The timeout must be a positive finite number of milliseconds.

Every initialization creates a page ID and emits `page_view`. A `pushState`, `replaceState`, `popstate`, or hash route that changes the sanitized URL creates a new page ID and emits `page_route_change`; later events receive that new page context. Query strings, credentials, and arbitrary fragments are excluded from captured URLs. Hash-router paths beginning with `#/` are retained without their query portion.

`destroy()` removes lifecycle listeners, the automatic flush timer, and restores owned History wrappers. It does not implicitly flush or emit unreliable unload end events.

## Browser error capture

Browser `init()` enables error capture by default. Uncaught runtime errors emit `runtime_error`, unhandled promise rejections emit `unhandled_rejection`, and failed script, stylesheet, image, or other resource loads emit `resource_error`. Automatic capture can be disabled with `errors: false`; runtime, promise, and resource capture can also be toggled independently.

`captureException(value, options)` emits `manual_error`, defaults to `handled: true`, and accepts optional bounded fingerprint hints. Arbitrary thrown or rejected objects are never serialized. The SDK extracts bounded error-like scalar fields, converts recognized browser stacks to structured frames, discards unsupported stack lines, and removes credentials, queries, and fragments from source URLs. Final error normalization and fingerprinting remain server-side.

Automatic listeners do not prevent browser defaults. `destroy()` removes both lifecycle and error listeners.

## Browser performance capture

Browser `init()` enables performance capture by default. Google's `web-vitals` library supplies CLS, FCP, INP, LCP, and TTFB semantics. Spectro emits `web_vital_cls`, `web_vital_fcp`, `web_vital_inp`, `web_vital_lcp`, and `web_vital_ttfb`, plus native `long_task` and `navigation_timing` events.

Performance capture can be disabled with `performance: false`; Web Vitals, long tasks, and navigation timing can also be toggled independently. CLS uses the `score` unit and other emitted performance metrics use milliseconds. The library's `needs-improvement` rating maps to `needs_improvement` in the protocol.

The SDK never queues raw attribution objects, DOM nodes, selectors, `PerformanceEntry` objects, or resource URLs. It retains only an explicit primitive allowlist. DOM targets become a bounded `monitor:<id>` only for valid `data-spectro-monitor-id` values and otherwise become `element`.

Web Vitals registration is page-global and happens at most once per loaded SDK module. Client destruction unsubscribes Spectro delivery and disconnects native observers. Delayed callbacks use their navigation URL to recover the matching bounded session/page context instead of inheriting a later SPA route. Unsupported browser APIs degrade silently.

## Browser network capture

Browser `init()` enables Fetch and XMLHttpRequest capture by default. Completed operations emit `fetch_request` or `xhr_request`; `network: false` disables all automatic network capture, and `captureFetch` and `captureXhr` can be toggled independently. Resource Timing emits `resource_request` only when `captureResourceTiming: true` because asset-level collection remains opt-in until production sampling and volume defaults exist.

Network events contain only an uppercase bounded method, a sanitized HTTP(S) URL, monotonic start and duration values, optional response status, initiator, and success state. Credentials, queries, fragments, headers, cookies, request bodies, response bodies, response text, and arbitrary request objects are never queued. Fetch rejection and XHR abort, timeout, or network completion are unsuccessful; HTTP 4xx and 5xx responses are also unsuccessful.

Fetch and XMLHttpRequest wrappers are shared by active SDK subscribers and are restored when the last subscriber is destroyed, provided another library has not replaced them. Spectro's ingestion envelope URL is excluded from capture. In-flight Fetch and XMLHttpRequest callbacks retain the sanitized page URL present when the request starts so a later SPA transition does not replace their session/page context. Resource Timing uses the active page context when its observer delivers the entry because it has no request-start hook.

## Browser interaction capture

Browser `init()` enables delegated click and form-submit capture by default. It emits `element_click` and `form_submit` only when the event target or a bounded ancestor has a valid `data-spectro-monitor-id`. `interactions: false` disables the plugin; `captureClicks` and `captureFormSubmits` can be toggled independently.

Interaction targets contain the explicit monitor ID and may contain a bounded tag and ARIA role from the same marked element. The SDK never captures element text, labels, values, names, DOM IDs, classes, HTML, generated selectors, form fields, event objects, or DOM nodes. It does not install telemetry listeners for input, change, keyboard, composition, clipboard, pointer-move, mouse-move, or scroll events.

Click coordinates are absent by default and require `captureCoordinates: true`. Delegated listeners do not prevent browser defaults or propagation, work with dynamically rendered elements, use a bounded composed path for shadow DOM, and are removed by `destroy()`.
