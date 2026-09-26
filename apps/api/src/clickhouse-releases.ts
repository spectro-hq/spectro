import { z } from 'zod';

import {
  encodeReleaseCursor,
  type ReleaseHealth,
  type ReleaseListPage,
  type ReleaseListQuery,
  type ReleaseQueryStore,
} from './releases.js';
import {
  CLICKHOUSE_EVENTS_TABLE,
  nonNegativeSafeIntegerSchema,
  type ClickHouseJsonEachRowClient,
} from './clickhouse-shared.js';

const rowSchema = z.object({
  release_version: z.string().min(1).max(128),
  event_count: nonNegativeSafeIntegerSchema,
  error_count: nonNegativeSafeIntegerSchema,
  affected_session_count: nonNegativeSafeIntegerSchema,
  poor_performance_count: nonNegativeSafeIntegerSchema,
  network_failure_count: nonNegativeSafeIntegerSchema,
  first_seen_ms: nonNegativeSafeIntegerSchema,
  last_seen_ms: nonNegativeSafeIntegerSchema,
  latest_event_id: z.string(),
});

export type ClickHouseReleaseQueryClient = ClickHouseJsonEachRowClient;

function toRelease(row: z.infer<typeof rowSchema>): ReleaseHealth {
  return {
    release: row.release_version,
    eventCount: row.event_count,
    errorCount: row.error_count,
    affectedSessionCount: row.affected_session_count,
    poorPerformanceCount: row.poor_performance_count,
    networkFailureCount: row.network_failure_count,
    firstSeen: row.first_seen_ms,
    lastSeen: row.last_seen_ms,
    latestEventId: row.latest_event_id,
  };
}

export class ClickHouseReleaseQueryStore implements ReleaseQueryStore {
  readonly #client: ClickHouseReleaseQueryClient;

  constructor(client: ClickHouseReleaseQueryClient) {
    this.#client = client;
  }

  async list(query: ReleaseListQuery): Promise<ReleaseListPage> {
    const parameters: Record<string, unknown> = {
      projectId: query.projectId,
      environment: query.environment,
      fromMs: String(query.from),
      toMs: String(query.to),
      rowLimit: query.limit + 1,
    };
    const cursorClause = query.cursor
      ? `HAVING last_seen_ms < {cursorLastSeen:UInt64}
          OR (last_seen_ms = {cursorLastSeen:UInt64} AND release_version < {cursorRelease:String})`
      : '';
    if (query.cursor) {
      parameters.cursorLastSeen = String(query.cursor.lastSeen);
      parameters.cursorRelease = query.cursor.release;
    }
    const result = await this.#client.query({
      query: `
        SELECT
          release_version,
          count() AS event_count,
          countIf(event_type = 'error') AS error_count,
          uniqExactIf(session_id, session_id != '') AS affected_session_count,
          countIf(event_type = 'performance' AND JSONExtractString(payload_json, 'rating') = 'poor') AS poor_performance_count,
          countIf(event_type = 'network' AND JSONExtractBool(payload_json, 'success') = false) AS network_failure_count,
          min(timestamp_ms) AS first_seen_ms,
          max(timestamp_ms) AS last_seen_ms,
          argMax(toString(event_id), tuple(timestamp_ms, event_id)) AS latest_event_id
        FROM ${CLICKHOUSE_EVENTS_TABLE} FINAL
        WHERE project_id = {projectId:String}
          AND environment = {environment:String}
          AND timestamp_ms >= {fromMs:UInt64}
          AND timestamp_ms <= {toMs:UInt64}
          AND release_version != ''
        GROUP BY release_version
        ${cursorClause}
        ORDER BY last_seen_ms DESC, release_version DESC
        LIMIT {rowLimit:UInt16}
      `,
      query_params: parameters,
      format: 'JSONEachRow',
    });
    const rows = z.array(rowSchema).parse(await result.json());
    const data = rows.slice(0, query.limit).map(toRelease);
    const last = data.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeReleaseCursor({ lastSeen: last.lastSeen, release: last.release })
        : undefined;
    return { data, ...(nextCursor ? { nextCursor } : {}) };
  }
}
