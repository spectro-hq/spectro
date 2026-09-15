import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildIssueQueryUrl, fetchIssuePage, parseIssueSearch } from './issue-query.js';

afterEach(() => vi.unstubAllGlobals());

describe('parseIssueSearch', () => {
  it('keeps valid shareable issue filters and applies safe defaults', () => {
    expect(
      parseIssueSearch({
        project: 'prj_storefront',
        environment: 'staging',
        range: '7d',
        source: 'live',
        name: 'runtime_error',
      }),
    ).toEqual({
      project: 'prj_storefront',
      environment: 'staging',
      range: '7d',
      source: 'live',
      name: 'runtime_error',
    });
    expect(parseIssueSearch({ project: '../issues' })).toMatchObject({
      project: 'prj_checkout',
      range: '24h',
      source: 'illustrative',
    });
  });
});

describe('issue query client', () => {
  it('keeps credentials out of the URL and validates the response', async () => {
    const url = buildIssueQueryUrl({
      projectId: 'prj_checkout',
      environment: 'production',
      from: 100,
      to: 200,
      release: 'web@1.4.2',
      limit: 25,
    });
    expect(url).toBe(
      '/v1/projects/prj_checkout/issues?environment=production&from=100&to=200&limit=25&release=web%401.4.2',
    );

    const page = { data: [] };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchIssuePage({
        query: { projectId: 'prj_checkout', environment: 'production', from: 100, to: 200 },
        token: 'local-secret',
      }),
    ).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(expect.not.stringContaining('local-secret'), {
      headers: { authorization: 'Bearer local-secret' },
    });
  });
});
