import { createClient } from '@clickhouse/client';
import { v7 } from 'uuid';
import { afterAll, describe, expect, it } from 'vitest';
import { createApiApp } from './app.js';
import { StaticProjectAuthorizer } from './auth.js';
import { ClickHouseLiveEventStore } from './clickhouse-live.js';
import type { LivePage } from './live-events.js';

const client = createClient({
  url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
});
afterAll(() => client.close());
function row(
  id: string,
  projectId: string,
  processed: number,
  environment = 'live_integration',
): Record<string, unknown> {
  const timestamp = processed - 24 * 60 * 60_000;
  const context = {
    sdk: { name: 'live-integration', version: '1' },
    project: { id: projectId },
    environment,
    session: { id: 'ses_live_integration' },
  };
  return {
    event_id: id,
    event_version: 1,
    event_type: 'custom',
    event_name: 'live_integration_arrival',
    timestamp_ms: String(timestamp),
    envelope_sent_at_ms: String(processed - 1),
    processed_at_ms: String(processed),
    processing_version: 1,
    project_id: projectId,
    environment,
    sdk_name: 'live-integration',
    sdk_version: '1',
    session_id: 'ses_live_integration',
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
describe('Live API with real ClickHouse', () => {
  it('observes late events, isolates scope, converges replay and drains timestamp ties without omissions', async () => {
    const projectId = `prj_live_${v7().replaceAll('-', '')}`;
    const processed = Date.now() - 1000;
    // oxlint-disable-next-line unicorn/no-array-sort -- Fresh fixture IDs; the checker targets ES2022 without toSorted.
    const ids = Array.from({ length: 120 }, () => v7()).sort((left, right) =>
      right.localeCompare(left),
    );
    const replay = row(ids[0]!, projectId, processed);
    await client.insert({
      table: 'spectro.events_v1',
      format: 'JSONEachRow',
      values: [
        ...ids.map((id) => row(id, projectId, processed)),
        replay,
        row(v7(), `${projectId}_other`, processed),
        row(v7(), projectId, processed, 'other_environment'),
        row(v7(), projectId, processed - 61_000),
      ],
    });
    const app = createApiApp({
      authorizer: new StaticProjectAuthorizer({ projectId, token: 'live-integration-read' }),
      liveStore: new ClickHouseLiveEventStore(client),
    });
    const headers = { authorization: 'Bearer live-integration-read' };
    const url = `/v1/projects/${projectId}/live?environment=live_integration&from=${processed - 60_000}&to=${processed + 500}&type=custom&name=live_integration_arrival&sessionId=ses_live_integration`;
    try {
      const started = Date.now();
      const first = await app.inject({ url, headers });
      expect(first.statusCode).toBe(200);
      const page = first.json<LivePage>();
      expect(page.data).toHaveLength(100);
      expect(page.data[0]?.event.timestamp).toBe(processed - 24 * 60 * 60_000);
      expect(page.data[0]?.processing.processedAt).toBe(processed);
      const next = await app.inject({ url: `${url}&cursor=${page.nextCursor}`, headers });
      expect(next.statusCode).toBe(200);
      const second = next.json<LivePage>();
      expect(second.data).toHaveLength(20);
      expect(second.nextCursor).toBeUndefined();
      const receivedIds = [...page.data, ...second.data].map((item) => item.event.id);
      expect(receivedIds).toHaveLength(ids.length);
      expect(new Set(receivedIds)).toEqual(new Set(ids));
      expect(Date.now() - started).toBeLessThan(5000);
      expect(
        (
          await app.inject({
            url:
              url.replace('live_integration&', 'other_environment&') + `&cursor=${page.nextCursor}`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
