# Processor service

Owns server-side normalization, final error fingerprinting, enrichment, and writes to the durable event plane.

The current slice implements the deterministic processing core, the JetStream admitted-envelope source, and a ClickHouse `ProcessedEventWriter`. A writer resolves `append()` only after the full batch is durably committed; the worker acknowledges the JetStream message afterward and requests delayed redelivery on failure.

ClickHouse starts with one `events_v1` table containing typed common query dimensions and bounded context/payload JSON. Event-type tables, projections, materialized views, TTLs, and larger streaming infrastructure remain deferred until query, retention, throughput, and recovery evidence justify them.
