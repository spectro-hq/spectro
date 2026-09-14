CREATE DATABASE IF NOT EXISTS spectro;

CREATE TABLE IF NOT EXISTS spectro.events_v1
(
    event_id UUID,
    event_version UInt16,
    event_type LowCardinality(String),
    event_name LowCardinality(String),
    timestamp_ms UInt64,
    event_time DateTime64(3, 'UTC') MATERIALIZED fromUnixTimestamp64Milli(timestamp_ms),
    envelope_sent_at_ms UInt64,
    processed_at_ms UInt64,
    processed_at DateTime64(3, 'UTC') MATERIALIZED fromUnixTimestamp64Milli(processed_at_ms),
    processing_version UInt16,
    project_id String,
    environment LowCardinality(String),
    sdk_name LowCardinality(String),
    sdk_version String,
    session_id String,
    user_id String,
    anonymous_id String,
    page_id String,
    page_url String,
    page_path String,
    release_version String,
    trace_id String,
    tags Map(String, String),
    error_fingerprint String,
    context_json String CODEC(ZSTD(3)),
    payload_json String CODEC(ZSTD(3))
)
ENGINE = ReplacingMergeTree(processed_at_ms)
PARTITION BY toYYYYMM(event_time)
ORDER BY
(
    project_id,
    environment,
    toDate(event_time),
    event_type,
    event_name,
    event_id
);
