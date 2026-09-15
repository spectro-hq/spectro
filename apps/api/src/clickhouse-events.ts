import type { SpectroEvent } from '@spectro/protocol';
import { validateEvent } from '@spectro/protocol';
import { z } from 'zod';

import {
  encodeEventCursor,
  type EventListItem,
  type EventListPage,
  type EventListQuery,
  type EventQueryStore,
} from './events.js';

const CLICKHOUSE_EVENTS_TABLE = 'spectro.events_v1';

const clickHouseEventQueryRowSchema = z
  .object({
    event_id: z.string(),
    event_version: z.number().int().nonnegative(),
    event_type: z.string(),
    event_name: z.string(),
    timestamp_ms: z.union([z.string(), z.number()]),
    envelope_sent_at_ms: z.union([z.string(), z.number()]),
    processed_at_ms: z.union([z.string(), z.number()]),
    processing_version: z.number().int().nonnegative(),
    project_id: z.string(),
    environment: z.string(),
    error_fingerprint: z.string().max(256),
    context_json: z.string(),
    payload_json: z.string(),
  })
  .strict();

type ClickHouseEventQueryRow = z.infer<typeof clickHouseEventQueryRowSchema>;

export interface ClickHouseQueryClient {
  query(request: {
    readonly query: string;
    readonly query_params: Record<string, unknown>;
    readonly format: 'JSONEachRow';
  }): Promise<{ json(): Promise<unknown> }>;
}

export class StoredEventValidationError extends Error {
  constructor() {
    super('Stored event failed protocol validation');
    this.name = 'StoredEventValidationError';
  }
}

function safeInteger(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new StoredEventValidationError();
  }
  return parsed;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new StoredEventValidationError();
  }
}

function toEvent(row: ClickHouseEventQueryRow): SpectroEvent {
  const context = parseJson(row.context_json);
  const payload = parseJson(row.payload_json);
  const candidate = {
    id: row.event_id,
    version: row.event_version,
    type: row.event_type,
    name: row.event_name,
    timestamp: safeInteger(row.timestamp_ms),
    context,
    payload,
  };
  const validation = validateEvent(candidate);

  if (
    !validation.success ||
    validation.data.context.project.id !== row.project_id ||
    validation.data.context.environment !== row.environment
  ) {
    throw new StoredEventValidationError();
  }

  return validation.data;
}

function toListItem(row: ClickHouseEventQueryRow): EventListItem {
  const fingerprint = row.error_fingerprint;
  return {
    event: toEvent(row),
    processing: {
      version: safeInteger(row.processing_version),
      envelopeSentAt: safeInteger(row.envelope_sent_at_ms),
      processedAt: safeInteger(row.processed_at_ms),
      ...(fingerprint.length > 0 ? { errorFingerprint: fingerprint } : {}),
    },
  };
}

function filterClause(query: EventListQuery): {
  readonly sql: string;
  readonly parameters: Record<string, unknown>;
} {
  const conditions = [
    'project_id = {projectId:String}',
    'environment = {environment:String}',
    'timestamp_ms >= {fromMs:UInt64}',
    'timestamp_ms <= {toMs:UInt64}',
  ];
  const parameters: Record<string, unknown> = {
    projectId: query.projectId,
    environment: query.environment,
    fromMs: String(query.from),
    toMs: String(query.to),
    rowLimit: query.limit + 1,
  };

  if (query.type !== undefined) {
    conditions.push('event_type = {eventType:String}');
    parameters.eventType = query.type;
  }
  if (query.name !== undefined) {
    conditions.push('event_name = {eventName:String}');
    parameters.eventName = query.name;
  }
  if (query.release !== undefined) {
    conditions.push('release_version = {releaseVersion:String}');
    parameters.releaseVersion = query.release;
  }
  if (query.sessionId !== undefined) {
    conditions.push('session_id = {sessionId:String}');
    parameters.sessionId = query.sessionId;
  }
  if (query.pageId !== undefined) {
    conditions.push('page_id = {pageId:String}');
    parameters.pageId = query.pageId;
  }
  if (query.cursor !== undefined) {
    conditions.push(
      '(timestamp_ms < {cursorTimestamp:UInt64} OR (timestamp_ms = {cursorTimestamp:UInt64} AND event_id < {cursorEventId:UUID}))',
    );
    parameters.cursorTimestamp = String(query.cursor.timestamp);
    parameters.cursorEventId = query.cursor.eventId;
  }

  return { sql: conditions.join('\n          AND '), parameters };
}

export class ClickHouseEventQueryStore implements EventQueryStore {
  readonly #client: ClickHouseQueryClient;

  constructor(client: ClickHouseQueryClient) {
    this.#client = client;
  }

  async list(query: EventListQuery): Promise<EventListPage> {
    const filter = filterClause(query);
    const result = await this.#client.query({
      query: `
        SELECT
          event_id,
          event_version,
          event_type,
          event_name,
          timestamp_ms,
          envelope_sent_at_ms,
          processed_at_ms,
          processing_version,
          project_id,
          environment,
          error_fingerprint,
          context_json,
          payload_json
        FROM ${CLICKHOUSE_EVENTS_TABLE} FINAL
        WHERE ${filter.sql}
        ORDER BY timestamp_ms DESC, event_id DESC
        LIMIT {rowLimit:UInt16}
      `,
      query_params: filter.parameters,
      format: 'JSONEachRow',
    });
    const rows = z.array(clickHouseEventQueryRowSchema).parse(await result.json());
    const visibleRows = rows.slice(0, query.limit);
    const data = visibleRows.map(toListItem);
    const lastItem = data.at(-1);
    const nextCursor =
      rows.length > query.limit && lastItem
        ? encodeEventCursor({ timestamp: lastItem.event.timestamp, eventId: lastItem.event.id })
        : undefined;

    return {
      data,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }
}
