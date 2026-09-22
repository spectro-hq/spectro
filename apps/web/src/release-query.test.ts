import { describe, expect, it } from 'vitest';

import { buildReleaseQueryUrl, parseReleaseSearch } from './release-query.js';

describe('release query', () => {
  it('parses stable URL state', () => {
    expect(
      parseReleaseSearch({
        project: 'prj_store',
        environment: 'staging',
        range: '6h',
        source: 'live',
      }),
    ).toEqual({
      project: 'prj_store',
      environment: 'staging',
      range: '6h',
      source: 'live',
    });
  });

  it('builds a bounded API URL', () => {
    expect(
      buildReleaseQueryUrl({
        projectId: 'prj checkout',
        environment: 'production',
        from: 100,
        to: 200,
        limit: 10,
      }),
    ).toBe('/v1/projects/prj%20checkout/releases?environment=production&from=100&to=200&limit=10');
  });
});
