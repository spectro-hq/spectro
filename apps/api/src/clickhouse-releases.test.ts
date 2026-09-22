import { describe, expect, it } from 'vitest';

import {
  ClickHouseReleaseQueryStore,
  type ClickHouseReleaseQueryClient,
} from './clickhouse-releases.js';
import { decodeReleaseCursor } from './releases.js';

describe('ClickHouseReleaseQueryStore', () => {
  it('aggregates release signals with a stable cursor', async () => {
    let captured:
      | { readonly query: string; readonly query_params: Record<string, unknown> }
      | undefined;
    const client: ClickHouseReleaseQueryClient = {
      query: async (request) => {
        captured = request;
        return {
          json: async () => [
            {
              release_version: 'web@1.4.2',
              event_count: '120',
              error_count: '7',
              affected_session_count: '81',
              poor_performance_count: '9',
              network_failure_count: '4',
              first_seen_ms: '100',
              last_seen_ms: '190',
              latest_event_id: 'evt_190',
            },
            {
              release_version: 'web@1.4.1',
              event_count: '90',
              error_count: '2',
              affected_session_count: '63',
              poor_performance_count: '3',
              network_failure_count: '1',
              first_seen_ms: '80',
              last_seen_ms: '180',
              latest_event_id: 'evt_180',
            },
          ],
        };
      },
    };
    const result = await new ClickHouseReleaseQueryStore(client).list({
      projectId: 'prj_checkout',
      environment: 'production',
      from: 100,
      to: 200,
      limit: 1,
    });
    expect(result.data[0]).toEqual({
      release: 'web@1.4.2',
      eventCount: 120,
      errorCount: 7,
      affectedSessionCount: 81,
      poorPerformanceCount: 9,
      networkFailureCount: 4,
      firstSeen: 100,
      lastSeen: 190,
      latestEventId: 'evt_190',
    });
    expect(decodeReleaseCursor(result.nextCursor ?? '')).toEqual({
      lastSeen: 190,
      release: 'web@1.4.2',
    });
    expect(captured?.query).toContain('GROUP BY release_version');
    expect(captured?.query).toContain("event_type = 'error'");
    expect(captured?.query_params).toMatchObject({ rowLimit: 2 });
  });
});
