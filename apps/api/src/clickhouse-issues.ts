import { z } from 'zod';

import {
  encodeIssueCursor,
  type ErrorIssueSummary,
  type IssueListPage,
  type IssueListQuery,
  type IssueQueryStore,
} from './issues.js';

const CLICKHOUSE_EVENTS_TABLE = 'spectro.events_v1';

const integerSchema = z.union([z.string(), z.number()]).transform((value, context) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    context.addIssue({ code: 'custom', message: 'must be a safe unsigned integer' });
    return z.NEVER;
  }
  return parsed;
});

const issueRowSchema = z
  .object({
    error_fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
    error_name: z.string().max(256),
    error_message: z.string().min(1).max(2_048),
    occurrence_count: integerSchema,
    affected_session_count: integerSchema,
    affected_user_count: integerSchema,
    first_seen_ms: integerSchema,
    last_seen_ms: integerSchema,
    latest_event_id: z.string(),
    latest_page_path: z.string().max(2_048),
    latest_release: z.string().max(128),
  })
  .strict();

export interface ClickHouseIssueQueryClient {
  query(request: {
    readonly query: string;
    readonly query_params: Record<string, unknown>;
    readonly format: 'JSONEachRow';
  }): Promise<{ json(): Promise<unknown> }>;
}

function toIssue(row: z.infer<typeof issueRowSchema>): ErrorIssueSummary {
  return {
    fingerprint: row.error_fingerprint,
    ...(row.error_name.length > 0 ? { name: row.error_name } : {}),
    message: row.error_message,
    occurrenceCount: row.occurrence_count,
    affectedSessionCount: row.affected_session_count,
    affectedUserCount: row.affected_user_count,
    firstSeen: row.first_seen_ms,
    lastSeen: row.last_seen_ms,
    latestEventId: row.latest_event_id,
    ...(row.latest_page_path.length > 0 ? { latestPagePath: row.latest_page_path } : {}),
    ...(row.latest_release.length > 0 ? { latestRelease: row.latest_release } : {}),
  };
}

export class ClickHouseIssueQueryStore implements IssueQueryStore {
  readonly #client: ClickHouseIssueQueryClient;

  constructor(client: ClickHouseIssueQueryClient) {
    this.#client = client;
  }

  async list(query: IssueListQuery): Promise<IssueListPage> {
    const conditions = [
      'project_id = {projectId:String}',
      'environment = {environment:String}',
      "event_type = 'error'",
      "error_fingerprint != ''",
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

    if (query.name !== undefined) {
      conditions.push('event_name = {eventName:String}');
      parameters.eventName = query.name;
    }
    if (query.release !== undefined) {
      conditions.push('release_version = {releaseVersion:String}');
      parameters.releaseVersion = query.release;
    }

    const cursorClause =
      query.cursor === undefined
        ? ''
        : `HAVING last_seen_ms < {cursorLastSeen:UInt64}
          OR (last_seen_ms = {cursorLastSeen:UInt64} AND error_fingerprint < {cursorFingerprint:String})`;
    if (query.cursor !== undefined) {
      parameters.cursorLastSeen = String(query.cursor.lastSeen);
      parameters.cursorFingerprint = query.cursor.fingerprint;
    }

    const result = await this.#client.query({
      query: `
        SELECT
          error_fingerprint,
          argMax(JSONExtractString(payload_json, 'name'), tuple(timestamp_ms, event_id)) AS error_name,
          argMax(JSONExtractString(payload_json, 'message'), tuple(timestamp_ms, event_id)) AS error_message,
          count() AS occurrence_count,
          uniqExactIf(session_id, session_id != '') AS affected_session_count,
          uniqExactIf(if(user_id != '', concat('user:', user_id), concat('anonymous:', anonymous_id)), user_id != '' OR anonymous_id != '') AS affected_user_count,
          min(timestamp_ms) AS first_seen_ms,
          max(timestamp_ms) AS last_seen_ms,
          argMax(toString(event_id), tuple(timestamp_ms, event_id)) AS latest_event_id,
          argMax(page_path, tuple(timestamp_ms, event_id)) AS latest_page_path,
          argMax(release_version, tuple(timestamp_ms, event_id)) AS latest_release
        FROM ${CLICKHOUSE_EVENTS_TABLE} FINAL
        WHERE ${conditions.join('\n          AND ')}
        GROUP BY error_fingerprint
        ${cursorClause}
        ORDER BY last_seen_ms DESC, error_fingerprint DESC
        LIMIT {rowLimit:UInt16}
      `,
      query_params: parameters,
      format: 'JSONEachRow',
    });
    const rows = z.array(issueRowSchema).parse(await result.json());
    const data = rows.slice(0, query.limit).map(toIssue);
    const lastIssue = data.at(-1);
    const nextCursor =
      rows.length > query.limit && lastIssue
        ? encodeIssueCursor({
            lastSeen: lastIssue.lastSeen,
            fingerprint: lastIssue.fingerprint,
          })
        : undefined;

    return { data, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }
}
