# ADR-034: Durable admission with NATS JetStream

Status: accepted  
Date: 2026-09-14

## Context

Ingestion must acknowledge an accepted envelope only after it has crossed a durable boundary. The processor must be independently deployable, apply server-side normalization, and acknowledge work only after ClickHouse confirms the processed batch. Delivery can be repeated after publisher uncertainty, consumer timeout, process failure, or downstream failure.

PostgreSQL is reserved for the control plane, ClickHouse is the event plane, and Kafka is intentionally deferred until measured scale justifies it.

## Decision

Use NATS JetStream as the V1 durable admission source.

- One validated protocol envelope is one JetStream message on `spectro.admitted.v1`.
- Ingestion waits for the JetStream publish acknowledgement before returning HTTP `202`.
- The publisher supplies a deterministic message ID derived from envelope version, send time, and ordered event IDs. Broker deduplication reduces immediate duplicate publishes but is not the permanent idempotency boundary.
- The processor uses a durable pull consumer with explicit per-message acknowledgement.
- The processor acknowledges only after the complete envelope has been successfully written to ClickHouse.
- A processor or ClickHouse failure leaves the message unacknowledged or negatively acknowledged for redelivery with bounded backoff.
- Delivery is documented as at least once. Spectro does not claim end-to-end exactly-once processing.
- Event IDs are the durable idempotency identity. ClickHouse storage and queries must tolerate replay beyond JetStream's finite deduplication window.
- The stream uses file storage. Local development uses one replica; production starts with three replicas when deployed as a NATS cluster.
- Stream and consumer limits, retention, backoff, and maximum deliveries remain configuration, with safe repository defaults and operational visibility for exhausted deliveries.

## Alternatives considered

### PostgreSQL inbox

Rejected for event payloads because it turns the control plane into the event buffer and couples high-volume ingestion pressure to organizations, projects, keys, and other transactional data.

### Direct ingestion into ClickHouse

Rejected because it collapses admission, processing, and event-plane storage into one failure boundary and makes server-side normalization and controlled retry harder to evolve independently.

### Redis Streams

Viable, but persistence and recovery behavior depend more heavily on Redis deployment policy, while JetStream provides file-backed streams, pull consumers, explicit acknowledgements, redelivery, and publisher acknowledgements in one focused component.

### Kafka

Rejected for V1 under ADR-018. Its operational and partitioning costs are not justified by current evidence.

## Compatibility and consequences

- The public Event Protocol does not change; JetStream carries an already validated `Envelope` plus internal admission metadata.
- Ingestion and processor remain separately deployable.
- NATS becomes an additional production dependency and must be monitored for storage, consumer lag, redelivery, and exhausted delivery attempts.
- Processor side effects must be idempotent because a failure can occur after ClickHouse commits but before JetStream receives the acknowledgement.
- No API key or sensitive transport header is placed in a JetStream message.

## Migration and rollback

The broker is hidden behind admission sink/source ports. A later queue migration can dual-publish, drain the JetStream consumer, and switch the source without changing SDKs or the public protocol. Rollback restores the previous adapter while preserving unacknowledged messages in the stream.

## References

- [NATS JetStream consumers](https://docs.nats.io/nats-concepts/jetstream/consumers)
- [NATS JetStream streams](https://docs.nats.io/nats-concepts/jetstream/streams)
