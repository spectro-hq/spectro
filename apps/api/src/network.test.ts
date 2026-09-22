import { describe, expect, it } from 'vitest';

import {
  decodeNetworkCursor,
  encodeNetworkCursor,
  InvalidNetworkCursorError,
  networkListQuerySchema,
} from './network.js';

describe('network query contract', () => {
  it('parses bounded filters and boolean input', () => {
    const result = networkListQuerySchema.parse({
      environment: 'production',
      from: '100',
      to: '200',
      initiator: 'fetch',
      method: 'POST',
      success: 'false',
    });
    expect(result).toMatchObject({ from: 100, to: 200, success: false, limit: 50 });
  });

  it('rejects lowercase methods and oversized windows', () => {
    expect(() =>
      networkListQuerySchema.parse({ environment: 'production', from: 0, to: 1, method: 'get' }),
    ).toThrow('uppercase HTTP method');
    expect(() =>
      networkListQuerySchema.parse({
        environment: 'production',
        from: 0,
        to: 32 * 24 * 60 * 60 * 1_000,
      }),
    ).toThrow('query range must not exceed 31 days');
  });

  it('round trips opaque cursors and rejects malformed values', () => {
    const cursor = {
      lastSeen: 42,
      initiator: 'xhr' as const,
      method: 'GET',
      url: 'https://api.example/items',
      pagePath: '/items',
    };
    expect(decodeNetworkCursor(encodeNetworkCursor(cursor))).toEqual(cursor);
    expect(() => decodeNetworkCursor('invalid')).toThrow(InvalidNetworkCursorError);
  });
});
