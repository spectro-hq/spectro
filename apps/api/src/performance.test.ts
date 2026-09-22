import { describe, expect, it } from 'vitest';

import {
  decodePerformanceCursor,
  encodePerformanceCursor,
  InvalidPerformanceCursorError,
  performanceListQuerySchema,
} from './performance.js';

describe('performance query contract', () => {
  it('validates bounded filters and defaults', () => {
    expect(
      performanceListQuerySchema.parse({
        environment: 'production',
        from: '100',
        to: '200',
        metric: 'lcp',
      }),
    ).toEqual({ environment: 'production', from: 100, to: 200, metric: 'lcp', limit: 50 });
    expect(
      performanceListQuerySchema.safeParse({
        environment: 'production',
        from: 200,
        to: 100,
      }).success,
    ).toBe(false);
  });

  it('round trips opaque cursors and rejects malformed values', () => {
    const cursor = { lastSeen: 200, metric: 'inp' as const, pagePath: '/checkout' };
    expect(decodePerformanceCursor(encodePerformanceCursor(cursor))).toEqual(cursor);
    expect(() => decodePerformanceCursor('not-a-cursor')).toThrow(InvalidPerformanceCursorError);
  });
});
