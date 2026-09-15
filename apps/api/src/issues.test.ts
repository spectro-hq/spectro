import { describe, expect, it } from 'vitest';

import {
  decodeIssueCursor,
  encodeIssueCursor,
  InvalidIssueCursorError,
  issueListQuerySchema,
} from './issues.js';

describe('issue list request validation', () => {
  it('applies bounded defaults and rejects invalid ranges', () => {
    expect(
      issueListQuerySchema.parse({
        environment: 'production',
        from: '1789368000000',
        to: '1789368060000',
      }),
    ).toEqual({
      environment: 'production',
      from: 1_789_368_000_000,
      to: 1_789_368_060_000,
      limit: 50,
    });
    expect(
      issueListQuerySchema.safeParse({ environment: 'production', from: '20', to: '10' }).success,
    ).toBe(false);
  });
});

describe('issue query cursors', () => {
  it('round-trips aggregate ordering identity and rejects malformed values', () => {
    const cursor = {
      lastSeen: 1_789_368_060_000,
      fingerprint: '0123456789abcdef0123456789abcdef',
    };
    expect(decodeIssueCursor(encodeIssueCursor(cursor))).toEqual(cursor);
    expect(() => decodeIssueCursor('not-a-cursor')).toThrow(InvalidIssueCursorError);
  });
});
