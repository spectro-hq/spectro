import { describe, expect, it } from 'vitest';

import {
  ClickHouseEventQueryStore,
  type ClickHouseQueryClient,
  StoredEventValidationError,
} from './clickhouse-events.js';
import { decodeEventCursor, type EventListQuery } from './events.js';

function row(input: {
  readonly id: string;
  readonly timestamp: number;
  readonly projectId?: string;
  readonly contextProjectId?: string;
}): Record<string, unknown> {
  const projectId = input.projectId ?? 'prj_checkout';
  return {
    event_id: input.id,
    event_version: 1,
    event_type: 'custom',
    event_name: 'checkout_completed',
    timestamp_ms: String(input.timestamp),
    envelope_sent_at_ms: String(input.timestamp + 1),
    processed_at_ms: String(input.timestamp + 2),
    processing_version: 1,
    project_id: projectId,
    environment: 'production',
    error_fingerprint: '',
    context_json: JSON.stringify({
      sdk: { name: '@spectro/browser', version: '0.1.0' },
      project: { id: input.contextProjectId ?? projectId },
      environment: 'production',
    }),
    payload_json: JSON.stringify({ properties: { order: 'bounded' } }),
  };
}

function query(overrides: Partial<EventListQuery> = {}): EventListQuery {
  return {
    projectId: 'prj_checkout',
    environment: 'production',
    from: 1_789_368_000_000,
    to: 1_789_368_100_000,
    limit: 1,
    ...overrides,
  };
}

describe('ClickHouseEventQueryStore', () => {
  it('uses parameterized filters and returns a stable keyset cursor', async () => {
    let capturedRequest:
      | {
          readonly query: string;
          readonly query_params: Record<string, unknown>;
          readonly format: 'JSONEachRow';
        }
      | undefined;
    const client: ClickHouseQueryClient = {
      query: async (request) => {
        capturedRequest = request;
        return {
          json: async () => [
            row({ id: '01994f36-017b-7b85-899b-fc860c547575', timestamp: 1_789_368_080_000 }),
            row({ id: '01994f36-017a-78db-82af-8d463d754f1e', timestamp: 1_789_368_070_000 }),
          ],
        };
      },
    };
    const store = new ClickHouseEventQueryStore(client);

    const result = await store.list(
      query({
        type: 'custom',
        name: 'checkout_completed',
        release: "release'one",
        sessionId: 'session-one',
        pageId: 'page-one',
      }),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.event.id).toBe('01994f36-017b-7b85-899b-fc860c547575');
    expect(decodeEventCursor(result.nextCursor ?? '')).toEqual({
      timestamp: 1_789_368_080_000,
      eventId: '01994f36-017b-7b85-899b-fc860c547575',
    });
    expect(capturedRequest?.query).toContain('FROM spectro.events_v1 FINAL');
    expect(capturedRequest?.query).toContain('release_version = {releaseVersion:String}');
    expect(capturedRequest?.query).not.toContain("release'one");
    expect(capturedRequest?.query_params).toMatchObject({
      projectId: 'prj_checkout',
      environment: 'production',
      eventType: 'custom',
      eventName: 'checkout_completed',
      releaseVersion: "release'one",
      sessionId: 'session-one',
      pageId: 'page-one',
      rowLimit: 2,
    });
  });

  it('adds the timestamp and event identity predicate for subsequent pages', async () => {
    let sql = '';
    let parameters: Record<string, unknown> = {};
    const client: ClickHouseQueryClient = {
      query: async (request) => {
        sql = request.query;
        parameters = request.query_params;
        return { json: async () => [] };
      },
    };
    const store = new ClickHouseEventQueryStore(client);

    await store.list(
      query({
        cursor: {
          timestamp: 1_789_368_080_000,
          eventId: '01994f36-017b-7b85-899b-fc860c547575',
        },
      }),
    );

    expect(sql).toContain('timestamp_ms < {cursorTimestamp:UInt64}');
    expect(sql).toContain('event_id < {cursorEventId:UUID}');
    expect(parameters).toMatchObject({
      cursorTimestamp: '1789368080000',
      cursorEventId: '01994f36-017b-7b85-899b-fc860c547575',
    });
  });

  it('fails closed when stored protocol context disagrees with typed project isolation', async () => {
    const client: ClickHouseQueryClient = {
      query: async () => ({
        json: async () => [
          row({
            id: '01994f36-017a-78db-82af-8d463d754f1e',
            timestamp: 1_789_368_070_000,
            contextProjectId: 'prj_other',
          }),
        ],
      }),
    };

    await expect(new ClickHouseEventQueryStore(client).list(query())).rejects.toBeInstanceOf(
      StoredEventValidationError,
    );
  });
});
