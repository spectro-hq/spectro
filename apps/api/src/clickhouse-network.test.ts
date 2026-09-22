import { describe, expect, it } from 'vitest';

import {
  ClickHouseNetworkQueryStore,
  type ClickHouseNetworkQueryClient,
} from './clickhouse-network.js';
import { decodeNetworkCursor, type NetworkListQuery } from './network.js';

function query(overrides: Partial<NetworkListQuery> = {}): NetworkListQuery {
  return {
    projectId: 'prj_checkout',
    environment: 'production',
    from: 100,
    to: 200,
    limit: 1,
    ...overrides,
  };
}

function row(url: string, lastSeen: number): Record<string, unknown> {
  return {
    initiator: 'fetch',
    method: 'POST',
    request_url: url,
    page_path: '/checkout',
    request_count: '12',
    failure_count: 3,
    affected_session_count: '8',
    average_duration: '320.5',
    p75_duration: 410,
    p95_duration: '820',
    status_2xx_count: 9,
    status_3xx_count: 0,
    status_4xx_count: 2,
    status_5xx_count: 0,
    transport_failure_count: 1,
    first_seen_ms: '100',
    last_seen_ms: String(lastSeen),
    latest_event_id: '01994f36-0187-7b85-899b-fc860c547575',
    latest_status: 422,
    latest_release: 'web@1.4.2',
  };
}

describe('ClickHouseNetworkQueryStore', () => {
  it('aggregates parameterized network groups and emits a stable cursor', async () => {
    let captured:
      | { readonly query: string; readonly query_params: Record<string, unknown> }
      | undefined;
    const client: ClickHouseNetworkQueryClient = {
      query: async (request) => {
        captured = request;
        return {
          json: async () => [
            row('https://api.example/checkout', 190),
            row('https://api.example/cart', 180),
          ],
        };
      },
    };
    const result = await new ClickHouseNetworkQueryStore(client).list(
      query({ method: 'POST', success: false, release: "web'quoted" }),
    );
    expect(result.data[0]).toMatchObject({
      initiator: 'fetch',
      method: 'POST',
      url: 'https://api.example/checkout',
      requestCount: 12,
      failureCount: 3,
      p95Duration: 820,
      transportFailureCount: 1,
      latestStatus: 422,
    });
    expect(decodeNetworkCursor(result.nextCursor ?? '')).toEqual({
      lastSeen: 190,
      initiator: 'fetch',
      method: 'POST',
      url: 'https://api.example/checkout',
      pagePath: '/checkout',
    });
    expect(captured?.query).toContain("event_type = 'network'");
    expect(captured?.query).toContain('GROUP BY initiator, method, request_url, page_path');
    expect(captured?.query).not.toContain("web'quoted");
    expect(captured?.query_params).toMatchObject({
      method: 'POST',
      success: false,
      releaseVersion: "web'quoted",
      rowLimit: 2,
    });
  });
});
