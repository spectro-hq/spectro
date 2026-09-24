# ADR-049: Browser delivery priority and recovery

Status: accepted  
Date: 2026-09-24

Amends the browser delivery policy in ADR-048.

## Context

ADR-048 introduced a five-second browser batch cadence and best-effort keepalive delivery. A single cadence treats a runtime crash and a routine interaction alike, delaying high-value failures. Network failures can also leave an urgent event only in volatile memory. The SDK needs a bounded priority queue, prompt delivery, and a recovery path without adding severity fields to the cross-language Event Protocol.

## Decision

- Delivery priority is SDK queue metadata, independent of event payloads and protocol severity.
- Unhandled runtime errors and promise rejections, manually captured errors marked unhandled, and non-aborted network failures with timeout, HTTP 408, or 5xx status use immediate delivery. Resource load errors, handled errors, 4xx responses other than 408, aborted requests, and all normal telemetry remain batched by default.
- On an immediate event, the SDK coalesces arrivals for 100 ms, then sends urgent events with up to eight recent earlier events from the same session and page, bounded to the preceding ten seconds. Selected events retain their original order and event IDs.
- Routine events continue on the five-second cadence. The SDK also starts a batch early at 50 queued events. Page hidden and `pagehide` keepalive behavior and its 60 KiB/100-event limits remain in effect.
- The in-memory queue is bounded to 500 events and 4 MiB. When capacity is exhausted, routine events are evicted before urgent events; oldest entries within a priority are removed first. Every drop is surfaced through `onError` without throwing into the host page.
- Urgent events are written to an IndexedDB outbox before the scheduled urgent send. The outbox is optional and can be disabled. It contains only already validated and privacy-filtered events, scoped by project and environment; it never stores API keys.
- The outbox retains at most 100 events and 1 MiB per project/environment, expires records after 24 hours, and drops an urgent event after eight failed attempts. On initialization, unexpired records are restored to the in-memory queue. Successful delivery removes their stored copies. Storage failures are reported and fall back to memory-only delivery.
- Failed transport attempts use exponential backoff, capped at 60 seconds. Normal automatic retries pause while offline and resume on the browser `online` event. Immediate events captured while offline remain in IndexedDB and are attempted on reconnect.
- This policy does not add fields to protocol event schemas. Backend severity and UI filtering remain separate decisions.

## Alternatives considered

### Send every event immediately

Rejected because it multiplies requests for ordinary performance and interaction telemetry.

### Add protocol severity and use it as delivery metadata

Rejected because urgency is client transport policy; protocol severity would change ingestion, storage, and query contracts without helping these decisions.

### Persist every queued event

Rejected because durable retention is only needed for high-priority failures and increases browser storage use and privacy exposure.

### Use localStorage

Rejected because synchronous writes can block the page and the API is not suitable for bounded asynchronous event records.

## Compatibility and consequences

- Capture schemas remain unchanged. Optional transport and capture options are additive.
- The browser SDK writes urgent events to IndexedDB when the API is available unless persistent delivery is disabled. Applications with stricter storage policies can opt out; unsupported browsers continue with the bounded in-memory queue.
- Delivery is at-least-once across ambiguous transport failures. Stable event IDs are retained across retries so downstream consumers can identify duplicates.
- The outbox is best-effort browser storage, not a durable delivery guarantee; browser eviction, private browsing, or process termination can still remove it.

## Migration and rollback

The policy lives in the SDK queue and browser outbox adapter. Disabling persistent delivery returns to the bounded in-memory queue. Disabling the immediate policy restores periodic batch delivery without changing protocol schemas or server components.
