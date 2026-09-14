import { afterAll, describe, expect, it } from 'vitest';

import { createClient } from '@clickhouse/client';
import { EVENT_VERSION, type SpectroEvent } from '@spectro/protocol';

import { ClickHouseProcessedEventWriter } from './clickhouse.js';
import type { ProcessedEvent } from './processor.js';

const clickhouseUrl = process.env.SPECTRO_CLICKHOUSE_URL;
const describeWithClickHouse = clickhouseUrl === undefined ? describe.skip : describe;
const client = createClient({
  url: clickhouseUrl ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
});

afterAll(async () => {
  await client.close();
});

describeWithClickHouse('ClickHouseProcessedEventWriter integration', () => {
  it('persists a processed event and converges an at-least-once replay', async () => {
    const event: SpectroEvent<'custom'> = {
      id: '01994f36-017a-78db-82af-8d463d754f1e',
      type: 'custom',
      name: 'clickhouse_integration',
      version: EVENT_VERSION,
      timestamp: 1_789_368_123_456,
      context: {
        sdk: { name: '@spectro/integration-test', version: '0.1.0' },
        project: { id: 'prj_clickhouse_integration' },
        environment: 'test',
      },
      payload: { properties: { source: 'integration' } },
    };
    const processed: ProcessedEvent = {
      event,
      processing: {
        version: 1,
        envelopeSentAt: 1_789_368_124_000,
        processedAt: 1_789_368_130_000,
      },
    };
    const writer = new ClickHouseProcessedEventWriter(client);

    await writer.append([processed]);
    await writer.append([processed]);

    const result = await client.query({
      query: `
        SELECT count() AS count
        FROM spectro.events_v1 FINAL
        WHERE event_id = {eventId:UUID}
      `,
      query_params: { eventId: event.id },
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ count: number }>();

    expect(rows).toEqual([{ count: 1 }]);
  });
});
