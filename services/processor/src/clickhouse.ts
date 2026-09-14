import type { ProcessedEvent, ProcessedEventWriter } from './processor.js';

export const CLICKHOUSE_EVENTS_TABLE = 'spectro.events_v1';

export interface ClickHouseEventRow {
  event_id: string;
  event_version: number;
  event_type: string;
  event_name: string;
  timestamp_ms: string;
  envelope_sent_at_ms: string;
  processed_at_ms: string;
  processing_version: number;
  project_id: string;
  environment: string;
  sdk_name: string;
  sdk_version: string;
  session_id: string;
  user_id: string;
  anonymous_id: string;
  page_id: string;
  page_url: string;
  page_path: string;
  release_version: string;
  trace_id: string;
  tags: Record<string, string>;
  error_fingerprint: string;
  context_json: string;
  payload_json: string;
}

export interface ClickHouseInsertClient {
  insert(request: {
    table: string;
    values: readonly ClickHouseEventRow[];
    format: 'JSONEachRow';
    clickhouse_settings: { async_insert: 1; wait_for_async_insert: 1 };
  }): Promise<unknown>;
}

function optional(value: string | undefined): string {
  return value ?? '';
}

function eventErrorFingerprint(event: ProcessedEvent): string {
  return event.event.type === 'error' ? optional(event.processing.errorFingerprint) : '';
}

export function toClickHouseEventRow(processed: ProcessedEvent): ClickHouseEventRow {
  const { event, processing } = processed;
  const context = event.context;

  return {
    event_id: event.id,
    event_version: event.version,
    event_type: event.type,
    event_name: event.name,
    timestamp_ms: String(event.timestamp),
    envelope_sent_at_ms: String(processing.envelopeSentAt),
    processed_at_ms: String(processing.processedAt),
    processing_version: processing.version,
    project_id: context.project.id,
    environment: context.environment,
    sdk_name: context.sdk.name,
    sdk_version: context.sdk.version,
    session_id: optional(context.session?.id),
    user_id: optional(context.user?.id),
    anonymous_id: optional(context.user?.anonymousId),
    page_id: optional(context.page?.id),
    page_url: optional(context.page?.url),
    page_path: optional(context.page?.path),
    release_version: optional(context.release?.version),
    trace_id: optional(context.trace?.traceId),
    tags: context.tags ?? {},
    error_fingerprint: eventErrorFingerprint(processed),
    context_json: JSON.stringify(context),
    payload_json: JSON.stringify(event.payload),
  };
}

export class ClickHouseProcessedEventWriter implements ProcessedEventWriter {
  readonly #client: ClickHouseInsertClient;

  constructor(client: ClickHouseInsertClient) {
    this.#client = client;
  }

  async append(events: readonly ProcessedEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.#client.insert({
      table: CLICKHOUSE_EVENTS_TABLE,
      values: events.map(toClickHouseEventRow),
      format: 'JSONEachRow',
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  }
}
