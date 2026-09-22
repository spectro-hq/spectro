import type { ReleasePage, ReleaseSearch } from './release-query.js';

const releases = [
  {
    release: 'web@1.4.2',
    eventCount: 12_842,
    errorCount: 284,
    affectedSessionCount: 4_691,
    poorPerformanceCount: 196,
    networkFailureCount: 91,
    latestEventId: '01994f36-0187-7b85-899b-fc860c547575',
  },
  {
    release: 'web@1.4.1',
    eventCount: 10_318,
    errorCount: 102,
    affectedSessionCount: 3_924,
    poorPerformanceCount: 88,
    networkFailureCount: 43,
    latestEventId: '01994f36-0186-7450-a24f-7bbed18796a1',
  },
  {
    release: 'web@1.4.0',
    eventCount: 7_904,
    errorCount: 76,
    affectedSessionCount: 2_847,
    poorPerformanceCount: 61,
    networkFailureCount: 29,
    latestEventId: '01994f36-0185-7215-9a0a-bb7f26797324',
  },
] as const;

export function createIllustrativeReleases(anchor: number, _search: ReleaseSearch): ReleasePage {
  return {
    data: releases.map((release, index) => ({
      ...release,
      firstSeen: anchor - (index + 4) * 3 * 60 * 60_000,
      lastSeen: anchor - index * 47 * 60_000 - 4 * 60_000,
    })),
  };
}
