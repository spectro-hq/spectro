# ADR-040: Browser interaction capture V1

Status: accepted
Date: 2026-09-15

## Context

Spectro needs a minimal behavior signal that can connect technical events to the user action that preceded them. Broad autocapture of every DOM event, element identifier, selector, label, or text node would create high volume, unstable dimensions, and a direct path to collecting private content. Input, change, and keyboard events are especially sensitive because they can expose entered values or infer them from key sequences.

Applications also render controls dynamically and through shadow DOM. Per-element listeners are incomplete and expensive, while document-level delegated events can observe stable interaction boundaries without modifying host elements or preventing browser defaults.

## Decision

- Browser interaction instrumentation is enabled by default for clicks and form submissions. It can be disabled with `interactions: false`; click and submit capture can be toggled independently.
- V1 emits `element_click` and `form_submit` only when the event target or a bounded ancestor has a valid `data-spectro-monitor-id`. Unmarked interactions are ignored.
- Monitor IDs use `^[A-Za-z0-9_-]{1,120}$`. The SDK may additionally retain a bounded lowercase tag and valid ARIA role from the same marked element.
- The SDK never captures element text, labels, values, names, DOM IDs, classes, HTML, generated CSS selectors, form fields, event objects, or DOM nodes. It does not listen to input, change, keydown, keyup, composition, clipboard, pointer-move, mouse-move, or scroll events for telemetry.
- Click coordinates are disabled by default and are included only with `captureCoordinates: true`. Coordinates must be finite numbers and are read only from a click event.
- A capture-phase click listener and submit listener are attached to `document`. They do not call `preventDefault()`, stop propagation, or mutate the event or target. `composedPath()` is used when available so marked controls inside shadow DOM can be resolved; fallback parent traversal is bounded to 20 nodes.
- Safe target extraction happens synchronously before the observation reaches the capture plugin. Only bounded primitive metadata crosses the runtime boundary.
- Interaction callbacks touch the existing session lifecycle before capture and inherit the active page context. `destroy()` removes all owned listeners, and repeated `init()` does not accumulate listeners.
- Failures while reading hostile DOM properties, walking a path, notifying a subscriber, or cleaning listeners are contained and reported through the SDK error hook when possible. They never interrupt the host event.

## Alternatives considered

### Capture every click with generated selectors

Rejected because selectors are unstable, can include user-derived IDs or classes, increase cardinality, and turn DOM structure into an accidental public analytics contract.

### Capture visible text or accessible names

Rejected because labels frequently include names, emails, order identifiers, messages, and other private content.

### Capture input, change, and keyboard events with redaction

Rejected because redaction after reading values or key sequences is not a sufficient privacy boundary. V1 does not inspect these signals.

### Install listeners on every marked element

Rejected because dynamic elements and shadow roots make element-by-element registration incomplete, while mutation observation would add complexity and overhead.

### Add rage-click and dead-click heuristics now

Rejected until baseline click signals, query surfaces, volume, and user investigation needs provide evidence for stable heuristics.

## Compatibility and consequences

- The existing interaction payload schema and common event envelope remain unchanged.
- `@spectro/browser` gains interaction capture configuration but no new imperative public method.
- Applications must intentionally add `data-spectro-monitor-id` to controls they want in behavior telemetry. This produces lower coverage than broad autocapture in exchange for stable, privacy-bounded dimensions.
- Click coordinates require explicit opt-in and can add cardinality. No viewport reconstruction or replay capability is introduced.

## Migration and rollback

Interaction capture is a browser plugin around the existing core capture contract. It can be disabled per initialization or removed without changing ingestion, processing, storage, or the event protocol. Rollback removes the plugin wiring and its delegated listeners; application monitor attributes can remain inert.
