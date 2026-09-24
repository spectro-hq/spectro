# ADR-048: Browser batch delivery

Status: accepted  
Date: 2026-09-24

## Context

Browser SDK capture is synchronous and best-effort, while performance and lifecycle signals can arrive throughout a long-lived page. Requiring applications to call `flush()` manually leaves those events queued indefinitely in otherwise healthy integrations. Ordinary fetch requests can be canceled during navigation, but using the protocol's 1 MiB envelope ceiling with `keepalive` exceeds browser keepalive quotas.

## Decision

- Browser clients automatically attempt a batch flush every five seconds. A failed request restores its events to the in-memory queue and is reported through the existing `onError` hook; the next scheduled or explicit flush may retry it.
- A transition to `document.visibilityState === 'hidden'` and the `pagehide` event each request a best-effort keepalive flush.
- Keepalive batches contain at most 100 events and at most 60 KiB of serialized envelope data. The lower bound leaves margin beneath commonly enforced browser keepalive quotas.
- Events that do not fit the bounded batch remain queued. Page exit cannot guarantee delivery, and the SDK does not persist the queue across process termination.
- `flush()` remains source-compatible. An optional `flush({ keepalive: true })` requests the bounded policy, and the public transport send options are additive.
- Concurrent flush attempts are serialized. If page exit requests keepalive while a normal flush is in flight, a bounded follow-up is attempted when queued events remain.
- `destroy()` cancels the scheduled flush and removes page lifecycle listeners; it does not implicitly flush.
- This decision does not add protocol event types or emit `session_end` / `page_leave` events.

## Alternatives considered

### Explicit flush only

Rejected because routine automatic instrumentation otherwise depends on applications remembering a transport lifecycle API.

### `navigator.sendBeacon()`

Rejected for this delivery path because the SDK transport requires its configured request headers, including the project API key header, while beacon requests do not support setting arbitrary headers.

### Unbounded keepalive using the ordinary envelope ceiling

Rejected because the 1 MiB protocol limit exceeds browser keepalive quotas and a page can enqueue more data than a single exit request can carry.

### Persist the queue across page/process termination

Deferred. Durable browser storage adds retention, consent, quota, and cross-tab coordination concerns beyond best-effort delivery.

## Compatibility and consequences

- Existing integrations can continue calling `flush()` with no arguments and keep their existing transport implementations; the options parameter is optional.
- Browser clients may now send captured events without an explicit application flush. The cadence is fixed at five seconds in V1.
- Page exit improves the delivery opportunity but is not a delivery guarantee. Oversized queues and browser termination may still drop events.
- The Event Protocol and server ingestion contract do not change.

## Migration and rollback

The automatic timer and lifecycle listeners are contained in the browser SDK. Removing those hooks restores explicit-flush-only behavior without changing captured event schemas or server components. The keepalive byte ceiling can be adjusted in a future SDK release without a protocol migration.
