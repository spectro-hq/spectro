import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIllustrativeNetwork } from './illustrative-network.js';
import {
  buildNetworkQueryUrl,
  fetchNetworkPage,
  formatNetworkTarget,
  parseNetworkSearch,
} from './network-query.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('network query helpers', () => {
  it('parses shareable filters without accepting loose values', () => {
    expect(
      parseNetworkSearch({
        project: 'prj_store',
        environment: 'staging',
        range: '6h',
        source: 'live',
        initiator: 'xhr',
        method: 'POST',
        success: 'false',
      }),
    ).toMatchObject({ initiator: 'xhr', method: 'POST', success: false });
    expect(parseNetworkSearch({ method: 'post', success: 'maybe' })).not.toHaveProperty('method');
  });

  it('builds an encoded authorized query path', () => {
    expect(
      buildNetworkQueryUrl({
        projectId: 'prj_store',
        environment: 'production',
        from: 100,
        to: 200,
        initiator: 'fetch',
        method: 'GET',
        success: false,
        pagePath: '/checkout',
      }),
    ).toBe(
      '/v1/projects/prj_store/network?environment=production&from=100&to=200&limit=50&initiator=fetch&method=GET&success=false&pagePath=%2Fcheckout',
    );
  });

  it('formats sanitized targets without throwing on malformed stored values', () => {
    expect(formatNetworkTarget('https://api.shop.example/checkout')).toBe(
      'api.shop.example/checkout',
    );
    expect(formatNetworkTarget('not a valid url')).toBe('not a valid url');
  });

  it('sends credentials in the authorization header and validates responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          {
            initiator: 'resource',
            method: 'GET',
            url: 'https://cdn.example/app.js',
            requestCount: 1,
            failureCount: 0,
            affectedSessionCount: 1,
            averageDuration: 20,
            p75Duration: 20,
            p95Duration: 20,
            status2xxCount: 0,
            status3xxCount: 0,
            status4xxCount: 0,
            status5xxCount: 0,
            transportFailureCount: 0,
            firstSeen: 100,
            lastSeen: 100,
            latestEventId: 'evt_resource',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchNetworkPage({
      query: { projectId: 'prj_store', environment: 'production', from: 0, to: 100 },
      token: 'secret',
    });
    expect(result.data[0]?.latestStatus).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/projects/prj_store/network?'),
      expect.objectContaining({ headers: { authorization: 'Bearer secret' } }),
    );
  });

  it('rejects malformed responses and surfaces stable API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json({ data: [{}] })),
    );
    await expect(
      fetchNetworkPage({
        query: { projectId: 'prj_store', environment: 'production', from: 0, to: 100 },
        token: 'secret',
      }),
    ).rejects.toThrow('Invalid input');

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json(
          { error: { message: 'Network query is temporarily unavailable.' } },
          { status: 503 },
        ),
      ),
    );
    await expect(
      fetchNetworkPage({
        query: { projectId: 'prj_store', environment: 'production', from: 0, to: 100 },
        token: 'secret',
      }),
    ).rejects.toThrow('Network query is temporarily unavailable.');
  });

  it('keeps illustrative groups inside the selected time window', () => {
    const anchor = 2_000_000;
    const narrow = createIllustrativeNetwork(anchor, parseNetworkSearch({ range: '15m' }));
    const wide = createIllustrativeNetwork(anchor, parseNetworkSearch({ range: '24h' }));
    expect(narrow.data).toHaveLength(2);
    expect(wide.data).toHaveLength(3);
    expect(narrow.data.every((group) => group.firstSeen >= anchor - 15 * 60_000)).toBe(true);
    expect(narrow.data[0]?.requestCount).toBeLessThan(wide.data[0]?.requestCount ?? 0);
    expect(
      narrow.data.every(
        (group) =>
          group.requestCount ===
          group.status2xxCount +
            group.status3xxCount +
            group.status4xxCount +
            group.status5xxCount +
            group.transportFailureCount,
      ),
    ).toBe(true);
    expect(
      narrow.data.every(
        (group) =>
          group.failureCount ===
          group.status4xxCount + group.status5xxCount + group.transportFailureCount,
      ),
    ).toBe(true);
  });
});
