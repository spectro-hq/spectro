import type { PerformanceGroup, PerformancePage, PerformanceSearch } from './performance-query.js';

const groups: readonly Omit<PerformanceGroup, 'firstSeen' | 'lastSeen'>[] = [
  {
    metric: 'lcp',
    unit: 'ms',
    pagePath: '/checkout',
    sampleCount: 184,
    affectedSessionCount: 151,
    average: 2_384,
    p75: 2_761,
    p95: 3_842,
    goodCount: 108,
    needsImprovementCount: 57,
    poorCount: 19,
    latestEventId: '01994f36-0185-7215-9a0a-bb7f26797324',
    latestRelease: 'web@1.4.2',
  },
  {
    metric: 'inp',
    unit: 'ms',
    pagePath: '/checkout',
    sampleCount: 126,
    affectedSessionCount: 110,
    average: 192,
    p75: 238,
    p95: 418,
    goodCount: 83,
    needsImprovementCount: 31,
    poorCount: 12,
    latestEventId: '01994f36-0186-78db-82af-8d463d754f1e',
    latestRelease: 'web@1.4.2',
  },
  {
    metric: 'cls',
    unit: 'score',
    pagePath: '/cart',
    sampleCount: 203,
    affectedSessionCount: 176,
    average: 0.08,
    p75: 0.12,
    p95: 0.29,
    goodCount: 142,
    needsImprovementCount: 44,
    poorCount: 17,
    latestEventId: '01994f36-0185-7215-9a0a-bb7f26797324',
    latestRelease: 'web@1.4.2',
  },
  {
    metric: 'ttfb',
    unit: 'ms',
    pagePath: '/products/aurora',
    sampleCount: 98,
    affectedSessionCount: 92,
    average: 684,
    p75: 812,
    p95: 1_204,
    goodCount: 49,
    needsImprovementCount: 38,
    poorCount: 11,
    latestEventId: '01994f36-0185-7215-9a0a-bb7f26797324',
    latestRelease: 'web@1.4.1',
  },
];

export function createIllustrativePerformance(
  anchor: number,
  search: PerformanceSearch,
): PerformancePage {
  const data = groups
    .map((group, index) => ({
      ...group,
      firstSeen: anchor - (index + 2) * 18 * 60_000,
      lastSeen: anchor - (index + 1) * 4 * 60_000,
    }))
    .filter(
      (group) =>
        (search.metric === undefined || group.metric === search.metric) &&
        (search.pagePath === undefined || group.pagePath === search.pagePath) &&
        (search.release === undefined || group.latestRelease === search.release),
    );
  return { data };
}
