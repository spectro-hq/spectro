import { parseStoredEventItems } from './clickhouse-events.js';
import { CLICKHOUSE_EVENTS_TABLE, type ClickHouseJsonEachRowClient } from './clickhouse-shared.js';
import { liveCursor, type LiveEventStore, type LivePage, type LiveQuery } from './live-events.js';

export class ClickHouseLiveEventStore implements LiveEventStore {
  constructor(private readonly client: ClickHouseJsonEachRowClient) {}

  async list(query: LiveQuery): Promise<Omit<LivePage, 'observedAt'>> {
    const conditions = [
      'project_id = {project:String}',
      'environment = {environment:String}',
      'processed_at_ms >= {from:UInt64}',
      'processed_at_ms <= {to:UInt64}',
    ];
    const parameters: Record<string, unknown> = {
      project: query.projectId,
      environment: query.environment,
      from: String(query.from),
      to: String(query.to),
    };
    for (const [key, column, value] of [
      ['type', 'event_type', query.type],
      ['name', 'event_name', query.name],
      ['session', 'session_id', query.sessionId],
    ] as const) {
      if (value !== undefined) {
        conditions.push(`${column} = {${key}:String}`);
        parameters[key] = value;
      }
    }
    if (query.cursor) {
      conditions.push('(processed_at_ms, event_id) < ({processed:UInt64}, {id:UUID})');
      parameters.processed = String(query.cursor.processedAt);
      parameters.id = query.cursor.eventId;
    }
    const result = await this.client.query({
      query: `SELECT event_id, event_version, event_type, event_name, timestamp_ms,
        envelope_sent_at_ms, processed_at_ms, processing_version, project_id,
        environment, error_fingerprint, context_json, payload_json
        FROM ${CLICKHOUSE_EVENTS_TABLE} FINAL
        WHERE ${conditions.join(' AND ')}
        ORDER BY processed_at_ms DESC, event_id DESC LIMIT 101
        SETTINGS max_execution_time = 2, max_rows_to_read = 2000000,
          max_bytes_to_read = 268435456, read_overflow_mode = 'throw'`,
      query_params: parameters,
      format: 'JSONEachRow',
    });
    const items = parseStoredEventItems(await result.json());
    const data = [];
    let bytes = 0;
    for (const item of items.slice(0, 100)) {
      const size = Buffer.byteLength(JSON.stringify(item));
      // Reserve space for the page envelope and scoped cursor as well as array punctuation.
      if (data.length > 0 && bytes + size > 2 * 1024 * 1024 - 2048) break;
      data.push(item);
      bytes += size;
    }
    const last = data.at(-1);
    return {
      data,
      from: query.from,
      to: query.to,
      ...(last && items.length > data.length ? { nextCursor: liveCursor(query, last) } : {}),
    };
  }
}
