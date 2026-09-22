import { z } from 'zod';

import {
  encodeNetworkCursor,
  networkInitiatorSchema,
  type NetworkGroup,
  type NetworkListPage,
  type NetworkListQuery,
  type NetworkQueryStore,
} from './network.js';

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
  initiator: networkInitiatorSchema,
  method: z.string().regex(/^[A-Z]{1,16}$/),
  request_url: z.string().min(1).max(2_048),
  page_path: z.string().max(2_048),
  request_count: unsignedInteger,
  failure_count: unsignedInteger,
  affected_session_count: unsignedInteger,
  average_duration: finiteNumber,
  p75_duration: finiteNumber,
  p95_duration: finiteNumber,
  status_2xx_count: unsignedInteger,
  status_3xx_count: unsignedInteger,
  status_4xx_count: unsignedInteger,
  status_5xx_count: unsignedInteger,
  transport_failure_count: unsignedInteger,
  first_seen_ms: unsignedInteger,
  last_seen_ms: unsignedInteger,
  latest_event_id: z.string(),
  latest_status: unsignedInteger,
  latest_release: z.string().max(128),
});

export interface ClickHouseNetworkQueryClient {
  query(request: {
    readonly query: string;
    readonly query_params: Record<string, unknown>;
    readonly format: 'JSONEachRow';
  }): Promise<{ json(): Promise<unknown> }>;
}

function toGroup(row: z.infer<typeof rowSchema>): NetworkGroup {
  return {
    initiator: row.initiator,
    method: row.method,
    url: row.request_url,
    ...(row.page_path ? { pagePath: row.page_path } : {}),
    requestCount: row.request_count,
    failureCount: row.failure_count,
    affectedSessionCount: row.affected_session_count,
    averageDuration: row.average_duration,
    p75Duration: row.p75_duration,
    p95Duration: row.p95_duration,
    status2xxCount: row.status_2xx_count,
    status3xxCount: row.status_3xx_count,
    status4xxCount: row.status_4xx_count,
    status5xxCount: row.status_5xx_count,
    transportFailureCount: row.transport_failure_count,
    firstSeen: row.first_seen_ms,
    lastSeen: row.last_seen_ms,
    latestEventId: row.latest_event_id,
    ...(row.latest_status > 0 ? { latestStatus: row.latest_status } : {}),
    ...(row.latest_release ? { latestRelease: row.latest_release } : {}),
  };
}

export class ClickHouseNetworkQueryStore implements NetworkQueryStore {
  readonly #client: ClickHouseNetworkQueryClient;

  constructor(client: ClickHouseNetworkQueryClient) {
    this.#client = client;
  }

  async list(query: NetworkListQuery): Promise<NetworkListPage> {
    const conditions = [
      'project_id = {projectId:String}',
      'environment = {environment:String}',
      "event_type = 'network'",
      'timestamp_ms >= {fromMs:UInt64}',
      'timestamp_ms <= {toMs:UInt64}',
      "JSONExtractString(payload_json, 'initiator') IN ('fetch', 'xhr', 'resource')",
      "JSONExtractString(payload_json, 'request', 'method') != ''",
      "JSONExtractString(payload_json, 'request', 'url') != ''",
      "JSONExtractFloat(payload_json, 'timing', 'duration') >= 0",
    ];
    const parameters: Record<string, unknown> = {
      projectId: query.projectId,
      environment: query.environment,
      fromMs: String(query.from),
      toMs: String(query.to),
      rowLimit: query.limit + 1,
    };
    if (query.initiator !== undefined) {
      conditions.push("JSONExtractString(payload_json, 'initiator') = {initiator:String}");
      parameters.initiator = query.initiator;
    }
    if (query.method !== undefined) {
      conditions.push("JSONExtractString(payload_json, 'request', 'method') = {method:String}");
      parameters.method = query.method;
    }
    if (query.success !== undefined) {
      conditions.push("JSONExtractBool(payload_json, 'success') = {success:Bool}");
      parameters.success = query.success;
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
      ? `HAVING tuple(last_seen_ms, initiator, method, request_url, page_path)
          < tuple({cursorLastSeen:UInt64}, {cursorInitiator:String}, {cursorMethod:String}, {cursorUrl:String}, {cursorPagePath:String})`
      : '';
    if (query.cursor) {
      parameters.cursorLastSeen = String(query.cursor.lastSeen);
      parameters.cursorInitiator = query.cursor.initiator;
      parameters.cursorMethod = query.cursor.method;
      parameters.cursorUrl = query.cursor.url;
      parameters.cursorPagePath = query.cursor.pagePath;
    }
    const result = await this.#client.query({
      query: `
        SELECT
          JSONExtractString(payload_json, 'initiator') AS initiator,
          JSONExtractString(payload_json, 'request', 'method') AS method,
          JSONExtractString(payload_json, 'request', 'url') AS request_url,
          page_path,
          count() AS request_count,
          countIf(NOT JSONExtractBool(payload_json, 'success')) AS failure_count,
          uniqExactIf(session_id, session_id != '') AS affected_session_count,
          avg(JSONExtractFloat(payload_json, 'timing', 'duration')) AS average_duration,
          quantileExact(0.75)(JSONExtractFloat(payload_json, 'timing', 'duration')) AS p75_duration,
          quantileExact(0.95)(JSONExtractFloat(payload_json, 'timing', 'duration')) AS p95_duration,
          countIf(JSONExtractUInt(payload_json, 'response', 'status') BETWEEN 200 AND 299) AS status_2xx_count,
          countIf(JSONExtractUInt(payload_json, 'response', 'status') BETWEEN 300 AND 399) AS status_3xx_count,
          countIf(JSONExtractUInt(payload_json, 'response', 'status') BETWEEN 400 AND 499) AS status_4xx_count,
          countIf(JSONExtractUInt(payload_json, 'response', 'status') BETWEEN 500 AND 599) AS status_5xx_count,
          countIf(NOT JSONExtractBool(payload_json, 'success') AND JSONExtractUInt(payload_json, 'response', 'status') = 0) AS transport_failure_count,
          min(timestamp_ms) AS first_seen_ms,
          max(timestamp_ms) AS last_seen_ms,
          argMax(toString(event_id), tuple(timestamp_ms, event_id)) AS latest_event_id,
          argMax(JSONExtractUInt(payload_json, 'response', 'status'), tuple(timestamp_ms, event_id)) AS latest_status,
          argMax(release_version, tuple(timestamp_ms, event_id)) AS latest_release
        FROM ${CLICKHOUSE_EVENTS_TABLE} FINAL
        WHERE ${conditions.join('\n          AND ')}
        GROUP BY initiator, method, request_url, page_path
        ${cursorClause}
        ORDER BY last_seen_ms DESC, initiator DESC, method DESC, request_url DESC, page_path DESC
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
        ? encodeNetworkCursor({
            lastSeen: last.lastSeen,
            initiator: last.initiator,
            method: last.method,
            url: last.url,
            pagePath: last.pagePath ?? '',
          })
        : undefined;
    return { data, ...(nextCursor ? { nextCursor } : {}) };
  }
}
