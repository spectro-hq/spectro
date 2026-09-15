import { afterAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

import { createClient } from '@clickhouse/client';

import { createApiApp } from './app.js';
import { StaticProjectAuthorizer } from './auth.js';
import { ClickHouseIssueQueryStore } from './clickhouse-issues.js';

const client = createClient({
  url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
});

afterAll(async () => {
  await client.close();
});

function errorRow(input: {
  readonly id: string;
  readonly projectId: string;
  readonly timestamp: number;
  readonly fingerprint: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly userId?: string;
}): Record<string, unknown> {
  const context = {
    sdk: { name: '@spectro/api-integration', version: '0.1.0' },
    project: { id: input.projectId },
    environment: 'integration',
    ...(input.sessionId === undefined ? {} : { session: { id: input.sessionId } }),
    ...(input.userId === undefined
      ? {}
      : { user: { id: input.userId, anonymousId: `anon_${input.userId}` } }),
    page: {
      id: 'page_checkout',
      url: 'https://shop.example/checkout',
      path: '/checkout',
    },
    release: { version: 'web@1.4.2' },
  };
  return {
    event_id: input.id,
    event_version: 1,
    event_type: 'error',
    event_name: 'runtime_error',
    timestamp_ms: String(input.timestamp),
    envelope_sent_at_ms: String(input.timestamp + 1),
    processed_at_ms: String(input.timestamp + 2),
    processing_version: 1,
    project_id: input.projectId,
    environment: 'integration',
    sdk_name: '@spectro/api-integration',
    sdk_version: '0.1.0',
    session_id: input.sessionId ?? '',
    user_id: input.userId ?? '',
    anonymous_id: input.userId === undefined ? '' : `anon_${input.userId}`,
    page_id: 'page_checkout',
    page_url: 'https://shop.example/checkout',
    page_path: '/checkout',
    release_version: 'web@1.4.2',
    trace_id: '',
    tags: {},
    error_fingerprint: input.fingerprint,
    context_json: JSON.stringify(context),
    payload_json: JSON.stringify({
      mechanism: 'runtime',
      name: 'CheckoutError',
      message: input.message,
      handled: false,
    }),
  };
}

describe('error issue API with ClickHouse', () => {
  it('groups repeated fingerprints and walks stable aggregate pages', async () => {
    const projectId = `prj_issues_${uuidv7().replaceAll('-', '')}`;
    const timestamp = 1_789_372_900_000;
    const primaryFingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const secondaryFingerprint = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const tertiaryFingerprint = 'cccccccccccccccccccccccccccccccc';
    const latestPrimaryId = uuidv7();

    await client.insert({
      table: 'spectro.events_v1',
      values: [
        errorRow({
          id: uuidv7(),
          projectId,
          timestamp: timestamp - 20,
          fingerprint: primaryFingerprint,
          message: 'Checkout failed on first attempt',
          sessionId: 'ses_one',
          userId: 'usr_one',
        }),
        errorRow({
          id: latestPrimaryId,
          projectId,
          timestamp,
          fingerprint: primaryFingerprint,
          message: 'Checkout failed on retry',
          sessionId: 'ses_two',
          userId: 'usr_two',
        }),
        errorRow({
          id: uuidv7(),
          projectId,
          timestamp: timestamp - 10,
          fingerprint: secondaryFingerprint,
          message: 'Payment service unavailable',
        }),
        errorRow({
          id: uuidv7(),
          projectId,
          timestamp: timestamp - 30,
          fingerprint: tertiaryFingerprint,
          message: 'Cart state invalid',
        }),
      ],
      format: 'JSONEachRow',
    });

    const app = createApiApp({
      authorizer: new StaticProjectAuthorizer({ projectId, token: 'issue-secret' }),
      issueStore: new ClickHouseIssueQueryStore(client),
    });
    const baseUrl = `/v1/projects/${projectId}/issues?environment=integration&from=${timestamp - 100}&to=${timestamp + 1}&release=web%401.4.2&limit=2`;

    const firstResponse = await app.inject({
      method: 'GET',
      url: baseUrl,
      headers: { authorization: 'Bearer issue-secret' },
    });
    expect(firstResponse.statusCode).toBe(200);
    const firstPage = firstResponse.json<{
      data: Array<{
        fingerprint: string;
        message: string;
        occurrenceCount: number;
        affectedSessionCount: number;
        affectedUserCount: number;
        latestEventId: string;
      }>;
      nextCursor: string;
    }>();
    expect(firstPage.data).toEqual([
      expect.objectContaining({
        fingerprint: primaryFingerprint,
        message: 'Checkout failed on retry',
        occurrenceCount: 2,
        affectedSessionCount: 2,
        affectedUserCount: 2,
        latestEventId: latestPrimaryId,
      }),
      expect.objectContaining({ fingerprint: secondaryFingerprint, occurrenceCount: 1 }),
    ]);
    expect(firstPage.nextCursor).toBeTypeOf('string');

    const secondResponse = await app.inject({
      method: 'GET',
      url: `${baseUrl}&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      headers: { authorization: 'Bearer issue-secret' },
    });
    await app.close();

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json()).toEqual({
      data: [expect.objectContaining({ fingerprint: tertiaryFingerprint, occurrenceCount: 1 })],
    });
  });
});
