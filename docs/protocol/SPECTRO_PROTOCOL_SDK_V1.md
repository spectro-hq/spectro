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
  flush(): Promise<FlushResult>;
}

interface Transport {
  send(envelope: Envelope): Promise<TransportResult>;
}
```

`track()` produces a custom event through the same builder and context path future instrumentation uses. It returns `undefined` after reporting invalid input through the optional `onError` hook; SDK failures never escape into the host application. `flush()` wraps queued events in an envelope and sends them through an injected transport. Transport failures are reported through `onError`, the drained events are restored, and the resolved result reports zero sent with the remaining queue count.

`init()` follows the same containment rule: malformed runtime options or missing platform capabilities are reported through `onError` when available and return `undefined` rather than throwing into the host application.

Browser fetch transport does not set `keepalive` for ordinary envelopes because browser keepalive quotas are smaller than the protocol's 1 MiB envelope limit. Unload delivery will use a separately bounded transport policy when that lifecycle is introduced.
