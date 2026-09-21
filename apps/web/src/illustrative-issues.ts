import type { ErrorIssue, IssueSearch } from './issue-query.js';

const fingerprints = {
  checkout: '6f87a1e0c93a4b156f87a1e0c93a4b15',
  promise: 'a92bd74e198fa340a92bd74e198fa340',
  resource: '14e8c21d7a50bc4614e8c21d7a50bc46',
  cart: 'c4d13e9a226be817c4d13e9a226be817',
} as const;

export function createIllustrativeIssues(anchor: number, search: IssueSearch): ErrorIssue[] {
  const issues: ErrorIssue[] = [
    {
      fingerprint: fingerprints.checkout,
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'id')",
      occurrenceCount: 28,
      affectedSessionCount: 17,
      affectedUserCount: 14,
      firstSeen: anchor - 21 * 60 * 60 * 1_000,
      lastSeen: anchor - 42_000,
      latestEventId: '01994f36-0188-7450-a24f-7bbed18796a1',
      latestPagePath: '/checkout',
      latestRelease: 'web@1.4.2',
      status: 'open',
    },
    {
      fingerprint: fingerprints.promise,
      name: 'PaymentUnavailableError',
      message: 'Payment provider rejected the confirmation request',
      occurrenceCount: 11,
      affectedSessionCount: 8,
      affectedUserCount: 7,
      firstSeen: anchor - 14 * 60 * 60 * 1_000,
      lastSeen: anchor - 18 * 60_000,
      latestEventId: '01994f36-0186-7450-a24f-7bbed18796a1',
      latestPagePath: '/checkout/payment',
      latestRelease: 'web@1.4.2',
      status: 'open',
    },
    {
      fingerprint: fingerprints.resource,
      name: 'ResourceError',
      message: 'Script resource failed to load',
      occurrenceCount: 7,
      affectedSessionCount: 6,
      affectedUserCount: 6,
      firstSeen: anchor - 8 * 60 * 60 * 1_000,
      lastSeen: anchor - 47 * 60_000,
      latestEventId: '01994f36-0184-7450-a24f-7bbed18796a1',
      latestPagePath: '/products/spectro-kit',
      latestRelease: 'web@1.4.1',
      status: 'resolved',
    },
    {
      fingerprint: fingerprints.cart,
      name: 'CartStateError',
      message: 'Cart state could not be reconciled',
      occurrenceCount: 3,
      affectedSessionCount: 2,
      affectedUserCount: 2,
      firstSeen: anchor - 3 * 60 * 60 * 1_000,
      lastSeen: anchor - 93 * 60_000,
      latestEventId: '01994f36-0182-7450-a24f-7bbed18796a1',
      latestPagePath: '/cart',
      latestRelease: 'web@1.4.1',
      status: 'ignored',
    },
  ];
  return issues.filter(
    (issue) =>
      (search.name === undefined || search.name === 'runtime_error') &&
      (search.release === undefined || issue.latestRelease === search.release) &&
      (search.status === undefined || issue.status === search.status),
  );
}
