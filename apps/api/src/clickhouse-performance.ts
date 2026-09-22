import { z } from 'zod';

import {
  encodePerformanceCursor,
  performanceMetricSchema,
  type PerformanceGroup,
  type PerformanceListPage,
  type PerformanceListQuery,
  type PerformanceQueryStore,
} from './performance.js';

const CLICKHOUSE_EVENTS_TABLE = 'spectro.events_v1';
const unsignedInteger = z.union([z.string(), z.number()]).transform((value, context) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    context.addIssue({ code: 'custom', message: 'must be a safe unsigned integer' });
    return z.NEVER;
  }
  return parsed;
});
const finiteNumber = z.union([z.string(), z.number()]).transform((value, context) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    context.addIssue({ code: 'custom', message: 'must be a non-negative finite number' });
    return z.NEVER;
  }
  return parsed;
});

const rowSchema = z.object({
  metric: performanceMetricSchema,
  unit: z.enum(['ms', 'score']),
  page_path: z.string().max(2_048),
  sample_count: unsignedInteger,
  affected_session_count: unsignedInteger,
  average_value: finiteNumber,
  p75_value: finiteNumber,
  p95_value: finiteNumber,
  good_count: unsignedInteger,
  needs_improvement_count: unsignedInteger,
  poor_count: unsignedInteger,
  first_seen_ms: unsignedInteger,
  last_seen_ms: unsignedInteger,
  latest_event_id: z.string(),
  latest_release: z.string().max(128),
});

export interface ClickHousePerformanceQueryClient {
  query(request: {
    readonly query: string;
    readonly query_params: Record<string, unknown>;
    readonly format: 'JSONEachRow';
  }): Promise<{ json(): Promise<unknown> }>;
}

function toGroup(row: z.infer<typeof rowSchema>): PerformanceGroup {
  return {
    metric: row.metric,
    unit: row.unit,
    ...(row.page_path.length > 0 ? { pagePath: row.page_path } : {}),
    sampleCount: row.sample_count,
    affectedSessionCount: row.affected_session_count,
    average: row.average_value,
    p75: row.p75_value,
    p95: row.p95_value,
    goodCount: row.good_count,
    needsImprovementCount: row.needs_improvement_count,
    poorCount: row.poor_count,
    firstSeen: row.first_seen_ms,
    lastSeen: row.last_seen_ms,
    latestEventId: row.latest_event_id,
    ...(row.latest_release.length > 0 ? { latestRelease: row.latest_release } : {}),
  };
}

export class ClickHousePerformanceQueryStore implements PerformanceQueryStore {
  readonly #client: ClickHousePerformanceQueryClient;

  constructor(client: ClickHousePerformanceQueryClient) {
    this.#client = client;
  }

  async list(query: PerformanceListQuery): Promise<PerformanceListPage> {
    const conditions = [
      'project_id = {projectId:String}',
      'environment = {environment:String}',
      "event_type = 'performance'",
      'timestamp_ms >= {fromMs:UInt64}',
      'timestamp_ms <= {toMs:UInt64}',
      "JSONExtractString(payload_json, 'metric') IN ('lcp', 'inp', 'cls', 'fcp', 'ttfb', 'long_task', 'navigation', 'resource_timing')",
      "JSONExtractString(payload_json, 'unit') IN ('ms', 'score')",
      "JSONExtractFloat(payload_json, 'value') >= 0",
    ];
    const parameters: Record<string, unknown> = {
      projectId: query.projectId,
      environment: query.environment,
      fromMs: String(query.from),
      toMs: String(query.to),
      rowLimit: query.limit + 1,
    };
    if (query.metric !== undefined) {
      conditions.push("JSONExtractString(payload_json, 'metric') = {metric:String}");
      parameters.metric = query.metric;
    }
    if (query.pagePath !== undefined) {
      conditions.push('page_path = {pagePath:String}');
      parameters.pagePath = query.pagePath;
    }
    if (query.release !== undefined) {
      conditions.push('release_version = {releaseVersion:String}');
      parameters.releaseVersion = query.release;
    }
    const cursorClause = query.cursor
      ? `HAVING last_seen_ms < {cursorLastSeen:UInt64}
          OR (last_seen_ms = {cursorLastSeen:UInt64} AND metric < {cursorMetric:String})
          OR (last_seen_ms = {cursorLastSeen:UInt64} AND metric = {cursorMetric:String} AND page_path < {cursorPagePath:String})`
      : '';
    if (query.cursor) {
      parameters.cursorLastSeen = String(query.cursor.lastSeen);
      parameters.cursorMetric = query.cursor.metric;
      parameters.cursorPagePath = query.cursor.pagePath;
    }
    const result = await this.#client.query({
      query: `
        SELECT
          JSONExtractString(payload_json, 'metric') AS metric,
          JSONExtractString(payload_json, 'unit') AS unit,
          page_path,
          count() AS sample_count,
          uniqExactIf(session_id, session_id != '') AS affected_session_count,
          avg(JSONExtractFloat(payload_json, 'value')) AS average_value,
          quantileExact(0.75)(JSONExtractFloat(payload_json, 'value')) AS p75_value,
          quantileExact(0.95)(JSONExtractFloat(payload_json, 'value')) AS p95_value,
          countIf(JSONExtractString(payload_json, 'rating') = 'good') AS good_count,
          countIf(JSONExtractString(payload_json, 'rating') = 'needs_improvement') AS needs_improvement_count,
          countIf(JSONExtractString(payload_json, 'rating') = 'poor') AS poor_count,
          min(timestamp_ms) AS first_seen_ms,
          max(timestamp_ms) AS last_seen_ms,
          argMax(toString(event_id), tuple(timestamp_ms, event_id)) AS latest_event_id,
          argMax(release_version, tuple(timestamp_ms, event_id)) AS latest_release
        FROM ${CLICKHOUSE_EVENTS_TABLE} FINAL
        WHERE ${conditions.join('\n          AND ')}
        GROUP BY metric, unit, page_path
        ${cursorClause}
        ORDER BY last_seen_ms DESC, metric DESC, page_path DESC
        LIMIT {rowLimit:UInt16}
      `,
      query_params: parameters,
      format: 'JSONEachRow',
    });
    const rows = z.array(rowSchema).parse(await result.json());
    const data = rows.slice(0, query.limit).map(toGroup);
    const last = data.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodePerformanceCursor({
            lastSeen: last.lastSeen,
            metric: last.metric,
            pagePath: last.pagePath ?? '',
          })
        : undefined;
    return { data, ...(nextCursor ? { nextCursor } : {}) };
  }
}
