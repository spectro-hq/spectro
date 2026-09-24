import { describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

import { createClient } from '@clickhouse/client';
import { connect } from '@nats-io/transport-node';
import { ClickHouseEventQueryStore, createApiApp, StaticProjectAuthorizer } from '@spectro/api';
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
    const projectId = `prj_pipeline_${uuidv7().replaceAll('-', '')}`;
    await ensureJetStreamPipeline(connection);
    const ingestApp = createIngestApp({
      apiKey: 'sp_integration',
      store: new JetStreamAdmissionSink(connection, () => 1_789_368_124_000),
    });
    const apiApp = createApiApp({
      authorizer: new StaticProjectAuthorizer({
        projectId,
        token: 'integration-query-secret',
      }),
      eventStore: new ClickHouseEventQueryStore(clickhouse),
    });

    try {
      const customEventId = uuidv7();
      const errorEventId = uuidv7();
      const performanceEventId = uuidv7();
      const networkEventId = uuidv7();
      const interactionEventId = uuidv7();
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
                project: { id: projectId },
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
                project: { id: projectId },
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
          {
            type: 'event',
            payload: {
              id: performanceEventId,
              type: 'performance',
              name: 'web_vital_lcp',
              version: EVENT_VERSION,
              timestamp: 1_789_368_123_458,
              context: {
                sdk: { name: '@spectro/browser', version: '0.1.0' },
                project: { id: projectId },
                environment: 'test',
                session: { id: 'ses_integration', startedAt: 1_789_368_100_000 },
                page: {
                  id: 'page_integration',
                  url: 'https://app.example/checkout',
                  path: '/checkout',
                },
              },
              payload: {
                metric: 'lcp',
                value: 2_500,
                unit: 'ms',
                rating: 'needs_improvement',
                navigationType: 'navigate',
                attribution: {
                  metricId: 'v6-lcp-integration',
                  timeToFirstByte: 100,
                  elementRenderDelay: 1_650,
                  target: 'monitor:hero',
                },
              },
            },
          },
          {
            type: 'event',
            payload: {
              id: networkEventId,
              type: 'network',
              name: 'fetch_request',
              version: EVENT_VERSION,
              timestamp: 1_789_368_123_459,
              context: {
                sdk: { name: '@spectro/browser', version: '0.1.0' },
                project: { id: projectId },
                environment: 'test',
                session: { id: 'ses_integration', startedAt: 1_789_368_100_000 },
                page: {
                  id: 'page_integration',
                  url: 'https://app.example/checkout',
                  path: '/checkout',
                },
              },
              payload: {
                request: { method: 'POST', url: 'https://api.example/orders' },
                response: { status: 503 },
                timing: { start: 420, duration: 87 },
                initiator: 'fetch',
                success: false,
              },
            },
          },
          {
            type: 'event',
            payload: {
              id: interactionEventId,
              type: 'interaction',
              name: 'element_click',
              version: EVENT_VERSION,
              timestamp: 1_789_368_123_460,
              context: {
                sdk: { name: '@spectro/browser', version: '0.1.0' },
                project: { id: projectId },
                environment: 'test',
                session: { id: 'ses_integration', startedAt: 1_789_368_100_000 },
                page: {
                  id: 'page_integration',
                  url: 'https://app.example/checkout',
                  path: '/checkout',
                },
              },
              payload: {
                target: { monitorId: 'submit_order', tag: 'button', role: 'button' },
              },
            },
          },
        ],
      };

      const response = await ingestApp.inject({
        method: 'POST',
        url: '/v1/envelope',
        headers: { 'x-spectro-key': 'sp_integration' },
        payload: envelope,
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: 5 });

      const source = await JetStreamAdmissionSource.create(connection);
      const writer = new ClickHouseProcessedEventWriter(clickhouse);
      const worker = new ProcessorWorker(source, new EventProcessor(writer));
      await vi.waitFor(
        async () => {
          // A concurrently running processor may consume this durable message first.
          await worker.runOnce(1_000);
          const result = await clickhouse.query({
            query: `
          SELECT
            count() AS count,
            countIf(event_name = 'runtime_error' AND error_fingerprint != '') AS fingerprinted,
            countIf(event_type = 'performance' AND event_name = 'web_vital_lcp') AS performance_count,
            countIf(event_type = 'network' AND event_name = 'fetch_request') AS network_count,
            countIf(event_type = 'interaction' AND event_name = 'element_click') AS interaction_count
          FROM spectro.events_v1 FINAL
          WHERE event_id IN ({customEventId:UUID}, {errorEventId:UUID}, {performanceEventId:UUID}, {networkEventId:UUID}, {interactionEventId:UUID})
        `,
            query_params: {
              customEventId,
              errorEventId,
              performanceEventId,
              networkEventId,
              interactionEventId,
            },
            format: 'JSONEachRow',
          });
          await expect(
            result.json<{
              count: number;
              fingerprinted: number;
              performance_count: number;
              network_count: number;
              interaction_count: number;
            }>(),
          ).resolves.toEqual([
            {
              count: 5,
              fingerprinted: 1,
              performance_count: 1,
              network_count: 1,
              interaction_count: 1,
            },
          ]);
        },
        { interval: 100, timeout: 8_000 },
      );

      const baseQuery = `/v1/projects/${projectId}/events?environment=test&from=1789368123455&to=1789368123461&limit=2`;
      const firstPageResponse = await apiApp.inject({
        method: 'GET',
        url: baseQuery,
        headers: { authorization: 'Bearer integration-query-secret' },
      });
      expect(firstPageResponse.statusCode).toBe(200);
      const firstPage = firstPageResponse.json<{
        data: Array<{ event: { id: string; name: string } }>;
        nextCursor: string;
      }>();
      expect(firstPage.data).toEqual([
        expect.objectContaining({
          event: expect.objectContaining({ id: interactionEventId, name: 'element_click' }),
        }),
        expect.objectContaining({
          event: expect.objectContaining({ id: networkEventId, name: 'fetch_request' }),
        }),
      ]);
      expect(firstPage.nextCursor).toBeTypeOf('string');

      const secondPageResponse = await apiApp.inject({
        method: 'GET',
        url: `${baseQuery}&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
        headers: { authorization: 'Bearer integration-query-secret' },
      });
      expect(secondPageResponse.statusCode).toBe(200);
      expect(
        secondPageResponse
          .json<{ data: Array<{ event: { id: string } }> }>()
          .data.map((item) => item.event.id),
      ).toEqual([performanceEventId, errorEventId]);

      const errorResponse = await apiApp.inject({
        method: 'GET',
        url: `${baseQuery}&type=error&name=runtime_error&sessionId=ses_integration&pageId=page_integration`,
        headers: { authorization: 'Bearer integration-query-secret' },
      });
      expect(errorResponse.statusCode).toBe(200);
      expect(errorResponse.json()).toEqual({
        data: [
          expect.objectContaining({
            event: expect.objectContaining({
              id: errorEventId,
              name: 'runtime_error',
              context: expect.objectContaining({
                session: expect.objectContaining({ id: 'ses_integration' }),
                page: expect.objectContaining({ id: 'page_integration' }),
              }),
            }),
            processing: expect.objectContaining({ errorFingerprint: expect.any(String) }),
          }),
        ],
      });

      const unauthorizedResponse = await apiApp.inject({
        method: 'GET',
        url: baseQuery,
      });
      expect(unauthorizedResponse.statusCode).toBe(401);
      expect(unauthorizedResponse.json()).toEqual({
        error: { code: 'unauthorized', message: 'Authentication is required.' },
      });

      const forbiddenResponse = await apiApp.inject({
        method: 'GET',
        url: baseQuery,
        headers: { authorization: 'Bearer wrong-secret' },
      });
      expect(forbiddenResponse.statusCode).toBe(403);
      expect(forbiddenResponse.body).not.toContain('wrong-secret');
    } finally {
      await ingestApp.close();
      await apiApp.close();
      await connection.drain();
      await clickhouse.close();
    }
  }, 12_000);
});
