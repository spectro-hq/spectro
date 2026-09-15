import { describe, expect, it } from 'vitest';

import { ClickHouseIssueQueryStore, type ClickHouseIssueQueryClient } from './clickhouse-issues.js';
import { decodeIssueCursor, type IssueListQuery } from './issues.js';

const firstFingerprint = 'fedcba9876543210fedcba9876543210';
const secondFingerprint = '0123456789abcdef0123456789abcdef';

function issueRow(fingerprint: string, lastSeen: number): Record<string, unknown> {
  return {
    error_fingerprint: fingerprint,
    error_name: 'CheckoutError',
    error_message: 'Checkout failed',
    occurrence_count: '7',
    affected_session_count: 3,
    affected_user_count: '2',
    first_seen_ms: String(lastSeen - 1_000),
    last_seen_ms: String(lastSeen),
    latest_event_id: '01994f36-017d-7b85-899b-fc860c547575',
    latest_page_path: '/checkout',
    latest_release: 'web@1.4.2',
  };
}

function issueQuery(overrides: Partial<IssueListQuery> = {}): IssueListQuery {
  return {
    projectId: 'prj_checkout',
    environment: 'production',
    from: 1_789_368_000_000,
    to: 1_789_368_100_000,
    limit: 1,
    ...overrides,
  };
}

describe('ClickHouseIssueQueryStore', () => {
  it('groups server fingerprints with parameterized filters and a stable cursor', async () => {
    let captured:
      | { readonly query: string; readonly query_params: Record<string, unknown> }
      | undefined;
    const client: ClickHouseIssueQueryClient = {
      query: async (request) => {
        captured = request;
        return {
          json: async () => [
            issueRow(firstFingerprint, 1_789_368_090_000),
            issueRow(secondFingerprint, 1_789_368_080_000),
          ],
        };
      },
    };

    const result = await new ClickHouseIssueQueryStore(client).list(
      issueQuery({ name: 'runtime_error', release: "web'quoted" }),
    );

    expect(result.data).toEqual([
      {
        fingerprint: firstFingerprint,
        name: 'CheckoutError',
        message: 'Checkout failed',
        occurrenceCount: 7,
        affectedSessionCount: 3,
        affectedUserCount: 2,
        firstSeen: 1_789_368_089_000,
        lastSeen: 1_789_368_090_000,
        latestEventId: '01994f36-017d-7b85-899b-fc860c547575',
        latestPagePath: '/checkout',
        latestRelease: 'web@1.4.2',
      },
    ]);
    expect(decodeIssueCursor(result.nextCursor ?? '')).toEqual({
      lastSeen: 1_789_368_090_000,
      fingerprint: firstFingerprint,
    });
    expect(captured?.query).toContain("event_type = 'error'");
    expect(captured?.query).toContain('GROUP BY error_fingerprint');
    expect(captured?.query).not.toContain("web'quoted");
    expect(captured?.query_params).toMatchObject({
      eventName: 'runtime_error',
      releaseVersion: "web'quoted",
      rowLimit: 2,
    });
  });

  it('applies the aggregate cursor after grouping', async () => {
    let sql = '';
    let parameters: Record<string, unknown> = {};
    const client: ClickHouseIssueQueryClient = {
      query: async (request) => {
        sql = request.query;
        parameters = request.query_params;
        return { json: async () => [] };
      },
    };

    await new ClickHouseIssueQueryStore(client).list(
      issueQuery({ cursor: { lastSeen: 100, fingerprint: secondFingerprint } }),
    );

    expect(sql).toContain('HAVING last_seen_ms < {cursorLastSeen:UInt64}');
    expect(parameters).toMatchObject({
      cursorLastSeen: '100',
      cursorFingerprint: secondFingerprint,
    });
  });
});
