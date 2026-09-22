import { describe, expect, it } from 'vitest';

import {
  ClickHousePerformanceQueryStore,
  type ClickHousePerformanceQueryClient,
} from './clickhouse-performance.js';
import { decodePerformanceCursor, type PerformanceListQuery } from './performance.js';

function query(overrides: Partial<PerformanceListQuery> = {}): PerformanceListQuery {
  return {
    projectId: 'prj_checkout',
    environment: 'production',
    from: 100,
    to: 200,
    limit: 1,
    ...overrides,
  };
}

function row(metric: 'lcp' | 'inp', lastSeen: number): Record<string, unknown> {
  return {
    metric,
    unit: 'ms',
    page_path: '/checkout',
    sample_count: '8',
    affected_session_count: '3',
    average_value: '2100.5',
    p75_value: 2400,
    p95_value: '3100',
    good_count: 4,
    needs_improvement_count: '3',
    poor_count: 1,
    first_seen_ms: '100',
    last_seen_ms: String(lastSeen),
    latest_event_id: '01994f36-017d-7b85-899b-fc860c547575',
    latest_release: 'web@1.4.2',
  };
}

describe('ClickHousePerformanceQueryStore', () => {
  it('aggregates with parameterized filters and a stable cursor', async () => {
    let captured:
      | { readonly query: string; readonly query_params: Record<string, unknown> }
      | undefined;
    const client: ClickHousePerformanceQueryClient = {
      query: async (request) => {
        captured = request;
        return { json: async () => [row('lcp', 190), row('inp', 180)] };
      },
    };
    const result = await new ClickHousePerformanceQueryStore(client).list(
      query({ metric: 'lcp', release: "web'quoted" }),
    );
    expect(result.data[0]).toEqual({
      metric: 'lcp',
      unit: 'ms',
      pagePath: '/checkout',
      sampleCount: 8,
      affectedSessionCount: 3,
      average: 2100.5,
      p75: 2400,
      p95: 3100,
      goodCount: 4,
      needsImprovementCount: 3,
      poorCount: 1,
      firstSeen: 100,
      lastSeen: 190,
      latestEventId: '01994f36-017d-7b85-899b-fc860c547575',
      latestRelease: 'web@1.4.2',
    });
    expect(decodePerformanceCursor(result.nextCursor ?? '')).toEqual({
      lastSeen: 190,
      metric: 'lcp',
      pagePath: '/checkout',
    });
    expect(captured?.query).toContain("event_type = 'performance'");
    expect(captured?.query).toContain('GROUP BY metric, unit, page_path');
    expect(captured?.query).not.toContain("web'quoted");
    expect(captured?.query_params).toMatchObject({
      metric: 'lcp',
      releaseVersion: "web'quoted",
      rowLimit: 2,
    });
  });
});
