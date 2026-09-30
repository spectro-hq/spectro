import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchObservation } from './live-query.js';
import { parseExplorerSearch, EventQueryError } from './event-query.js';
import { createIllustrativePage } from './illustrative-events.js';

afterEach(() => vi.unstubAllGlobals());
const search = parseExplorerSearch({
  project: 'prj_test',
  environment: 'test',
  source: 'live',
  type: 'error',
  name: 'runtime_error',
  sessionId: 'ses_test',
});
const input = { search, token: 'local-read-token', signal: new AbortController().signal };
const item = createIllustrativePage(1_800_000_000_000, 'prj_test', 'test').data[0]!;
const page = { data: [item], from: 100, to: 200, observedAt: 210 };
function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
describe('live query transport', () => {
  it('drains a fixed snapshot, sends scoped filters and keeps credentials out of URLs', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...page, nextCursor: 'opaque' }))
      .mockResolvedValueOnce(response({ ...page, data: [], observedAt: 250 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchObservation(input)).toEqual({
      data: [item],
      observedAt: 200,
      truncated: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/projects/prj_test/live?environment=test&type=error&name=runtime_error&sessionId=ses_test',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain('&from=100&to=200&cursor=opaque');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      signal: input.signal,
      headers: { authorization: 'Bearer local-read-token' },
    });
  });
  it('caps each drain at five pages and reports incomplete observation', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ ...page, nextCursor: 'next' }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchObservation(input)).truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it('fails closed for another scope or a malformed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        response({
          ...page,
          data: [
            {
              ...item,
              event: {
                ...item.event,
                context: { ...item.event.context, environment: 'another' },
              },
            },
          ],
        }),
      ),
    );
    await expect(fetchObservation(input)).rejects.toThrow('scope mismatch');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response({ data: [] })));
    await expect(fetchObservation(input)).rejects.toThrow(/from|to|observedAt/);
  });
  it('exposes authentication failure without returning private server messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private token detail', { status: 401 })),
    );
    await expect(fetchObservation(input)).rejects.toEqual(
      expect.objectContaining<EventQueryError>({
        name: 'EventQueryError',
        status: 401,
        message: 'Live observation could not be updated.',
      }),
    );
  });
});
