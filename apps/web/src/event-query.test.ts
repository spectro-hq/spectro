import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildEventQueryUrl,
  EventQueryError,
  fetchEventPage,
  parseExplorerSearch,
} from './event-query.js';

afterEach(() => vi.unstubAllGlobals());

describe('parseExplorerSearch', () => {
  it('keeps valid shareable filters and applies safe defaults', () => {
    expect(
      parseExplorerSearch({
        project: 'prj_storefront',
        environment: 'staging',
        range: '6h',
        source: 'live',
        type: 'error',
        event: '01994f36-0188-7450-a24f-7bbed18796a1',
      }),
    ).toEqual({
      project: 'prj_storefront',
      environment: 'staging',
      range: '6h',
      source: 'live',
      type: 'error',
      event: '01994f36-0188-7450-a24f-7bbed18796a1',
    });

    expect(parseExplorerSearch({ project: '../events', range: 'forever' })).toEqual({
      project: 'prj_checkout',
      environment: 'production',
      range: '30m',
      source: 'illustrative',
    });

    expect(parseExplorerSearch({ name: 'Runtime Error' }).name).toBeUndefined();
  });
});

describe('buildEventQueryUrl', () => {
  it('encodes supported filters and keeps authorization out of the URL', () => {
    const url = buildEventQueryUrl({
      projectId: 'prj_checkout',
      environment: 'production',
      from: 100,
      to: 200,
      type: 'network',
      release: 'web@1.4.2',
      cursor: 'opaque+cursor',
      limit: 25,
    });

    expect(url).toBe(
      '/v1/projects/prj_checkout/events?environment=production&from=100&to=200&limit=25&type=network&release=web%401.4.2&cursor=opaque%2Bcursor',
    );
    expect(url).not.toContain('authorization');
  });
});

describe('fetchEventPage', () => {
  it('sends the token in the authorization header and validates the response', async () => {
    const body = {
      data: [
        {
          event: {
            id: 'evt_1',
            type: 'custom',
            name: 'checkout_started',
            version: 1,
            timestamp: 100,
            context: {
              sdk: { name: '@spectro/browser', version: '0.1.0' },
              project: { id: 'prj_checkout' },
              environment: 'production',
            },
            payload: { cartSize: 2 },
          },
          processing: { version: 1, envelopeSentAt: 101, processedAt: 102 },
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchEventPage({
        query: {
          projectId: 'prj_checkout',
          environment: 'production',
          from: 0,
          to: 100,
        },
        token: 'local-token',
      }),
    ).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/projects/prj_checkout/events?environment=production&from=0&to=100&limit=50',
      { headers: { authorization: 'Bearer local-token' } },
    );
  });

  it('surfaces the stable API error message without exposing credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Project access denied.' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const result = fetchEventPage({
      query: {
        projectId: 'prj_checkout',
        environment: 'production',
        from: 0,
        to: 100,
      },
      token: 'never-include-me',
    });

    await expect(result).rejects.toEqual(
      expect.objectContaining<EventQueryError>({
        name: 'EventQueryError',
        message: 'Project access denied.',
        status: 403,
      }),
    );
  });
});
