import { describe, expect, it } from 'vitest';
import { ClickHouseLiveEventStore } from './clickhouse-live.js';
import { resolveLiveQuery } from './live-events.js';
import type { ClickHouseJsonEachRowClient } from './clickhouse-shared.js';

function row(index: number, large = false): Record<string, unknown> {
  return {
    event_id: `01994f36-017a-78db-82af-${String(index).padStart(12, '0')}`,
    event_version: 1,
    event_type: 'custom',
    event_name: 'live_test',
    timestamp_ms: '100',
    envelope_sent_at_ms: '200',
    processed_at_ms: '300',
    processing_version: 1,
    project_id: 'prj_test',
    environment: 'test',
    error_fingerprint: '',
    context_json: JSON.stringify({
      sdk: { name: 'test', version: '1' },
      project: { id: 'prj_test' },
      environment: 'test',
    }),
    payload_json: JSON.stringify({
      properties: large
        ? Object.fromEntries(
            Array.from({ length: 25 }, (_, key) => [String(key), '字'.repeat(600)]),
          )
        : {},
    }),
  };
}
describe('ClickHouse live store', () => {
  it('parameterizes user values, limits scan work and paginates processing timestamp ties', async () => {
    let captured: Parameters<ClickHouseJsonEachRowClient['query']>[0] | undefined;
    const store = new ClickHouseLiveEventStore({
      query: async (request) => {
        captured = request;
        return { json: async () => Array.from({ length: 101 }, (_, index) => row(101 - index)) };
      },
    });
    const query = resolveLiveQuery(
      'prj_test',
      {
        environment: 'test',
        from: 0,
        to: 400,
        type: 'custom',
        name: 'live_test',
        sessionId: "session'quoted",
      },
      400,
    );
    const page = await store.list(query);
    expect(page.data).toHaveLength(100);
    expect(captured?.query).toContain('processed_at_ms >= {from:UInt64}');
    expect(captured?.query).toContain('ORDER BY processed_at_ms DESC, event_id DESC LIMIT 101');
    expect(captured?.query).toContain('max_execution_time = 2');
    expect(captured?.query).toContain("read_overflow_mode = 'throw'");
    expect(captured?.query).not.toContain("session'quoted");
    expect(captured?.query_params.session).toBe("session'quoted");
    const next = resolveLiveQuery(
      'prj_test',
      {
        environment: 'test',
        from: 0,
        to: 400,
        type: 'custom',
        name: 'live_test',
        sessionId: "session'quoted",
        cursor: page.nextCursor,
      },
      400,
    );
    expect(next.cursor?.eventId).toBe(page.data.at(-1)?.event.id);
    await store.list(next);
    expect(captured?.query).toContain(
      '(processed_at_ms, event_id) < ({processed:UInt64}, {id:UUID})',
    );
  });
  it('caps UTF-8 response bytes and preserves a cursor for remaining rows', async () => {
    const store = new ClickHouseLiveEventStore({
      query: async () => ({
        json: async () => Array.from({ length: 100 }, (_, index) => row(100 - index, true)),
      }),
    });
    const query = resolveLiveQuery('prj_test', { environment: 'test', from: 0, to: 400 }, 400);
    const page = await store.list(query);
    expect(page.data.length).toBeLessThan(100);
    expect(Buffer.byteLength(JSON.stringify(page.data))).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(page.nextCursor).toBeTypeOf('string');
  });
  it('rejects protocol-invalid rows and typed/context scope mismatches atomically', async () => {
    await Promise.all(
      [
        { ...row(1), payload_json: '{invalid' },
        { ...row(1), project_id: 'prj_other' },
      ].map(async (malformed) => {
        const store = new ClickHouseLiveEventStore({
          query: async () => ({ json: async () => [row(2), malformed] }),
        });
        await expect(
          store.list(resolveLiveQuery('prj_test', { environment: 'test', from: 0, to: 400 }, 400)),
        ).rejects.toThrow('Stored event failed protocol validation');
      }),
    );
  });
});
