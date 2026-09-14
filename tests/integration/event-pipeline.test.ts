import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

import { createClient } from '@clickhouse/client';
import { connect } from '@nats-io/transport-node';
import { createIngestApp } from '@spectro/ingest';
import {
  JetStreamAdmissionSink,
  JetStreamAdmissionSource,
  ensureJetStreamPipeline,
} from '@spectro/pipeline';
import {
  ClickHouseProcessedEventWriter,
  EventProcessor,
  ProcessorWorker,
} from '@spectro/processor';
import { ENVELOPE_VERSION, EVENT_VERSION, type Envelope } from '@spectro/protocol';

const describeIntegration = process.env.SPECTRO_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('durable event pipeline', () => {
  it('admits through JetStream, processes, persists, and acknowledges one envelope', async () => {
    const connection = await connect({
      servers: process.env.SPECTRO_NATS_URL ?? 'nats://localhost:4222',
      name: 'spectro-integration-test',
    });
    const clickhouse = createClient({
      url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
      username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
      password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
      database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
    });
    await ensureJetStreamPipeline(connection);
    const app = createIngestApp({
      apiKey: 'sp_integration',
      store: new JetStreamAdmissionSink(connection, () => 1_789_368_124_000),
    });

    try {
      const customEventId = uuidv7();
      const errorEventId = uuidv7();
      const envelope: Envelope = {
        version: ENVELOPE_VERSION,
        sentAt: 1_789_368_123_456,
        items: [
          {
            type: 'event',
            payload: {
              id: customEventId,
              type: 'custom',
              name: 'durable_pipeline_verified',
              version: EVENT_VERSION,
              timestamp: 1_789_368_123_456,
              context: {
                sdk: { name: '@spectro/integration-test', version: '0.1.0' },
                project: { id: 'prj_durable_pipeline' },
                environment: 'test',
              },
              payload: { properties: { source: 'real-boundary-test' } },
            },
          },
          {
            type: 'event',
            payload: {
              id: errorEventId,
              type: 'error',
              name: 'runtime_error',
              version: EVENT_VERSION,
              timestamp: 1_789_368_123_457,
              context: {
                sdk: { name: '@spectro/browser', version: '0.1.0' },
                project: { id: 'prj_durable_pipeline' },
                environment: 'test',
                session: { id: 'ses_integration', startedAt: 1_789_368_100_000 },
                page: {
                  id: 'page_integration',
                  url: 'https://app.example/checkout',
                  path: '/checkout',
                },
              },
              payload: {
                mechanism: 'runtime',
                name: 'CheckoutError',
                message: 'Checkout failed for order 48291',
                handled: false,
                stack: [
                  {
                    filename: 'https://app.example/assets/app.js',
                    function: 'submitOrder',
                    line: 12,
                    column: 34,
                  },
                ],
              },
            },
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/envelope',
        headers: { 'x-spectro-key': 'sp_integration' },
        payload: envelope,
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: 2 });

      const source = await JetStreamAdmissionSource.create(connection);
      const writer = new ClickHouseProcessedEventWriter(clickhouse);
      const worker = new ProcessorWorker(source, new EventProcessor(writer));
      await expect(worker.runOnce(2_000)).resolves.toMatchObject({
        status: 'processed',
        processed: 2,
      });

      const result = await clickhouse.query({
        query: `
          SELECT
            count() AS count,
            countIf(event_name = 'runtime_error' AND error_fingerprint != '') AS fingerprinted
          FROM spectro.events_v1 FINAL
          WHERE event_id IN ({customEventId:UUID}, {errorEventId:UUID})
        `,
        query_params: { customEventId, errorEventId },
        format: 'JSONEachRow',
      });
      await expect(result.json<{ count: number; fingerprinted: number }>()).resolves.toEqual([
        { count: 2, fingerprinted: 1 },
      ]);
    } finally {
      await app.close();
      await connection.drain();
      await clickhouse.close();
    }
  });
});
