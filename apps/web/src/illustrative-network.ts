import type { NetworkGroup, NetworkPage, NetworkSearch } from './network-query.js';
import { TIME_RANGES } from './event-query.js';

const groups = [
  {
    initiator: 'fetch',
    method: 'POST',
    url: 'https://api.shop.example/checkout',
    pagePath: '/checkout',
    requestCount: 184,
    failureCount: 23,
    affectedSessionCount: 151,
    averageDuration: 486,
    p75Duration: 612,
    p95Duration: 1280,
    status2xxCount: 161,
    status3xxCount: 0,
    status4xxCount: 18,
    status5xxCount: 3,
    transportFailureCount: 2,
    latestStatus: 422,
    latestRelease: 'web@1.4.2',
    eventId: '01994f36-0187-7b85-899b-fc860c547575',
    offset: 4 * 60_000,
  },
  {
    initiator: 'xhr',
    method: 'GET',
    url: 'https://api.shop.example/cart',
    pagePath: '/cart',
    requestCount: 236,
    failureCount: 11,
    affectedSessionCount: 202,
    averageDuration: 238,
    p75Duration: 318,
    p95Duration: 744,
    status2xxCount: 225,
    status3xxCount: 0,
    status4xxCount: 4,
    status5xxCount: 5,
    transportFailureCount: 2,
    latestStatus: 503,
    latestRelease: 'web@1.4.2',
    eventId: '01994f36-0182-7776-845e-92122d2fe0a9',
    offset: 11 * 60_000,
  },
  {
    initiator: 'fetch',
    method: 'GET',
    url: 'https://api.shop.example/products/aurora',
    pagePath: '/products/aurora',
    requestCount: 128,
    failureCount: 3,
    affectedSessionCount: 116,
    averageDuration: 192,
    p75Duration: 246,
    p95Duration: 521,
    status2xxCount: 125,
    status3xxCount: 0,
    status4xxCount: 2,
    status5xxCount: 0,
    transportFailureCount: 1,
    latestStatus: 200,
    latestRelease: 'web@1.4.1',
    eventId: '01994f36-0180-7776-845e-92122d2fe0a9',
    offset: 18 * 60_000,
  },
] as const;

export function createIllustrativeNetwork(anchor: number, search: NetworkSearch): NetworkPage {
  const windowMilliseconds = TIME_RANGES[search.range].milliseconds;
  const data: NetworkGroup[] = groups
    .map((group) => {
      const fullSpan = 20 * 60_000;
      const observedSpan = Math.min(fullSpan, Math.max(0, windowMilliseconds - group.offset));
      const scale = observedSpan / fullSpan;
      const scaled = (value: number): number => Math.round(value * scale);
      const status2xxCount = scaled(group.status2xxCount);
      const status3xxCount = scaled(group.status3xxCount);
      const status4xxCount = scaled(group.status4xxCount);
      const status5xxCount = scaled(group.status5xxCount);
      const transportFailureCount = scaled(group.transportFailureCount);
      const requestCount =
        status2xxCount + status3xxCount + status4xxCount + status5xxCount + transportFailureCount;
      return {
        initiator: group.initiator,
        method: group.method,
        url: group.url,
        pagePath: group.pagePath,
        requestCount,
        failureCount: status4xxCount + status5xxCount + transportFailureCount,
        affectedSessionCount: Math.min(requestCount, scaled(group.affectedSessionCount)),
        averageDuration: group.averageDuration,
        p75Duration: group.p75Duration,
        p95Duration: group.p95Duration,
        status2xxCount,
        status3xxCount,
        status4xxCount,
        status5xxCount,
        transportFailureCount,
        firstSeen: anchor - group.offset - observedSpan,
        lastSeen: anchor - group.offset,
        latestEventId: group.eventId,
        latestStatus: group.latestStatus,
        latestRelease: group.latestRelease,
      };
    })
    .filter((group) => anchor - group.lastSeen <= windowMilliseconds)
    .filter((group) => search.initiator === undefined || group.initiator === search.initiator)
    .filter((group) => search.method === undefined || group.method === search.method)
    .filter(
      (group) =>
        search.success === undefined ||
        (search.success ? group.requestCount > group.failureCount : group.failureCount > 0),
    )
    .filter((group) => search.pagePath === undefined || group.pagePath === search.pagePath)
    .filter((group) => search.release === undefined || group.latestRelease === search.release);
  return { data };
}
