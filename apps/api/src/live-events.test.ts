import { describe, expect, it, vi } from 'vitest';
import { resolveLiveQuery, liveCursor, type LiveEventStore } from './live-events.js';
import { createApiApp } from './app.js';
import { StaticProjectAuthorizer } from './auth.js';
import type { EventListItem } from './events.js';

const now = 1_800_000_000_000;
const item: EventListItem = {
  event: {
    id: '01994f36-017a-78db-82af-8d463d754f1e',
    version: 1,
    type: 'custom',
    name: 'test_arrival',
    timestamp: now - 100_000,
    context: {
      sdk: { name: 'test', version: '1' },
      project: { id: 'prj_test' },
      environment: 'test',
    },
    payload: { properties: {} },
  },
  processing: { version: 1, envelopeSentAt: now - 10, processedAt: now - 1 },
};
describe('live observation query contract', () => {
  it('defaults to a bounded recent processing window', () => {
    expect(resolveLiveQuery('prj_test', { environment: 'test' }, now)).toEqual({
      projectId: 'prj_test',
      environment: 'test',
      from: now - 60_000,
      to: now,
    });
  });
  it.each([
    { from: '' },
    { from: '-1' },
    { from: '1.5' },
    { from: '9007199254740992' },
    { from: 0 },
    { from: now, to: now - 1 },
    { to: now + 6000 },
    { name: 'Bad Event' },
    { type: 'unknown' },
    { extra: 'ignored' },
  ])('rejects invalid or unbounded inputs %j', (input) => {
    expect(() => resolveLiveQuery('prj_test', { environment: 'test', ...input }, now)).toThrow(
      /.+/,
    );
  });
  it('binds cursors to all filters and the fixed processing window', () => {
    const query = resolveLiveQuery(
      'prj_test',
      { environment: 'test', type: 'custom', sessionId: 'session' },
      now,
    );
    const cursor = liveCursor(query, item);
    const base = {
      environment: 'test',
      type: 'custom',
      sessionId: 'session',
      from: query.from,
      to: query.to,
      cursor,
    };
    expect(resolveLiveQuery('prj_test', base, now).cursor).toEqual({
      eventId: item.event.id,
      processedAt: now - 1,
    });
    for (const patch of [
      { environment: 'other' },
      { type: 'page' },
      { name: 'other' },
      { sessionId: 'other' },
      { from: query.from - 1 },
      { cursor: 'malformed' },
    ])
      expect(() => resolveLiveQuery('prj_test', { ...base, ...patch }, now)).toThrow(/.+/);
    expect(() => resolveLiveQuery('prj_other', base, now)).toThrow('Cursor scope mismatch');
    expect(() => resolveLiveQuery('prj_test', { environment: 'test', cursor }, now)).toThrow(
      'Cursor needs a window',
    );
  });
  it('authorizes before accessing storage and sanitizes service failures', async () => {
    const list = vi.fn<LiveEventStore['list']>(async () => {
      throw new Error('private storage payload');
    });
    const app = createApiApp({
      authorizer: new StaticProjectAuthorizer({ projectId: 'prj_test', token: 'read-token' }),
      liveStore: { list },
    });
    try {
      expect((await app.inject('/v1/projects/prj_test/live?environment=test')).statusCode).toBe(
        401,
      );
      expect(
        (
          await app.inject({
            url: '/v1/projects/prj_other/live?environment=test',
            headers: { authorization: 'Bearer read-token' },
          })
        ).statusCode,
      ).toBe(403);
      expect(list).not.toHaveBeenCalled();
      const result = await app.inject({
        url: '/v1/projects/prj_test/live?environment=test',
        headers: { authorization: 'Bearer read-token' },
      });
      expect(result.statusCode).toBe(503);
      expect(result.body).not.toContain('private');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(
        (
          await app.inject({
            url: '/v1/projects/prj_test/live?environment=test&from=0',
            headers: { authorization: 'Bearer read-token' },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
