import { afterAll, describe, expect, it } from 'vitest';

import { createClient } from '@clickhouse/client';

import { createApiApp } from './app.js';
import { StaticProjectAuthorizer } from './auth.js';
import { ClickHouseEventQueryStore } from './clickhouse-events.js';

const client = createClient({
  url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
});

afterAll(async () => {
  await client.close();
});

function eventRow(input: {
  readonly id: string;
  readonly projectId: string;
  readonly timestamp: number;
}): Record<string, unknown> {
  const context = {
    sdk: { name: '@spectro/api-integration', version: '0.1.0' },
    project: { id: input.projectId },
    environment: 'integration',
  };
  return {
    event_id: input.id,
    event_version: 1,
    event_type: 'custom',
    event_name: 'query_api_integration',
    timestamp_ms: String(input.timestamp),
    envelope_sent_at_ms: String(input.timestamp + 1),
    processed_at_ms: String(input.timestamp + 2),
    processing_version: 1,
    project_id: input.projectId,
    environment: 'integration',
    sdk_name: '@spectro/api-integration',
    sdk_version: '0.1.0',
    session_id: '',
    user_id: '',
    anonymous_id: '',
    page_id: '',
    page_url: '',
    page_path: '',
    release_version: '',
    trace_id: '',
    tags: {},
    error_fingerprint: '',
    context_json: JSON.stringify(context),
    payload_json: JSON.stringify({ properties: { boundary: 'real-clickhouse' } }),
  };
}

describe('event query API with ClickHouse', () => {
  it('isolates projects, converges replays, and walks stable cursor pages', async () => {
    const timestamp = 1_789_372_800_000;
    const firstId = '01994f36-017d-7b85-899b-fc860c547575';
    const secondId = '01994f36-017c-78db-82af-8d463d754f1e';
    const firstRow = eventRow({ id: firstId, projectId: 'prj_api_integration', timestamp });
    await client.insert({
      table: 'spectro.events_v1',
      values: [
        firstRow,
        firstRow,
        eventRow({ id: secondId, projectId: 'prj_api_integration', timestamp }),
        eventRow({
          id: '01994f36-017e-7450-a24f-7bbed18796a1',
          projectId: 'prj_api_other',
          timestamp,
        }),
      ],
      format: 'JSONEachRow',
    });

    const app = createApiApp({
      authorizer: new StaticProjectAuthorizer({
        projectId: 'prj_api_integration',
        token: 'integration-secret',
      }),
      eventStore: new ClickHouseEventQueryStore(client),
    });
    const baseUrl =
      '/v1/projects/prj_api_integration/events?environment=integration&from=1789372799999&to=1789372800001&name=query_api_integration&limit=1';
    const firstResponse = await app.inject({
      method: 'GET',
      url: baseUrl,
      headers: { authorization: 'Bearer integration-secret' },
    });

    expect(firstResponse.statusCode).toBe(200);
    const firstPage = firstResponse.json<{
      data: Array<{ event: { id: string } }>;
      nextCursor: string;
    }>();
    expect(firstPage.data.map((item) => item.event.id)).toEqual([firstId]);
    expect(firstPage.nextCursor).toBeTypeOf('string');

    const secondResponse = await app.inject({
      method: 'GET',
      url: `${baseUrl}&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      headers: { authorization: 'Bearer integration-secret' },
    });
    await app.close();

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json()).toEqual({
      data: [
        expect.objectContaining({
          event: expect.objectContaining({ id: secondId }),
        }),
      ],
    });
  });
});
