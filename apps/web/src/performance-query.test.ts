import { describe, expect, it } from 'vitest';

import { buildPerformanceQueryUrl, parsePerformanceSearch } from './performance-query.js';

describe('performance query client', () => {
  it('parses shareable filters with safe defaults', () => {
    expect(
      parsePerformanceSearch({
        project: 'prj_checkout',
        environment: 'staging',
        range: '6h',
        source: 'live',
        metric: 'lcp',
        pagePath: '/checkout',
      }),
    ).toEqual({
      project: 'prj_checkout',
      environment: 'staging',
      range: '6h',
      source: 'live',
      metric: 'lcp',
      pagePath: '/checkout',
    });
  });

  it('encodes filters without credentials', () => {
    expect(
      buildPerformanceQueryUrl({
        projectId: 'prj_checkout',
        environment: 'production',
        from: 100,
        to: 200,
        metric: 'inp',
        pagePath: '/checkout',
        release: 'web@1.4.2',
      }),
    ).toBe(
      '/v1/projects/prj_checkout/performance?environment=production&from=100&to=200&limit=50&metric=inp&pagePath=%2Fcheckout&release=web%401.4.2',
    );
  });
});
