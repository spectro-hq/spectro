import { describe, expect, it } from 'vitest';

import { decodeReleaseCursor, encodeReleaseCursor, releaseListQuerySchema } from './releases.js';

describe('release query contract', () => {
  it('parses a bounded window and cursor', () => {
    expect(
      releaseListQuerySchema.parse({ environment: 'production', from: '100', to: '200' }),
    ).toEqual({ environment: 'production', from: 100, to: 200, limit: 20 });
    const cursor = encodeReleaseCursor({ lastSeen: 190, release: 'web@1.4.2' });
    expect(decodeReleaseCursor(cursor)).toEqual({ lastSeen: 190, release: 'web@1.4.2' });
  });

  it('rejects ranges beyond 31 days', () => {
    expect(
      releaseListQuerySchema.safeParse({ environment: 'production', from: 0, to: 32 * 86_400_000 })
        .success,
    ).toBe(false);
  });
});
