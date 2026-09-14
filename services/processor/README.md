# Processor service

Owns server-side normalization, final error fingerprinting, enrichment, and writes to the durable event plane.

The current slice implements the deterministic processing core and a replaceable `ProcessedEventWriter` boundary. A writer must resolve `append()` only after the full batch is durably committed; rejection leaves retry and acknowledgement to the future admitted-envelope source adapter.

ClickHouse is the accepted event-plane technology. Its physical table layout and the durable queue/source technology remain open until query, retention, throughput, and recovery evidence justify those decisions.
