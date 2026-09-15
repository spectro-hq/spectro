import { describe, expect, it } from 'vitest';

import {
  decodeEventCursor,
  encodeEventCursor,
  eventListPathSchema,
  eventListQuerySchema,
  InvalidCursorError,
} from './events.js';

describe('event list request validation', () => {
  it('coerces bounded numeric query fields and applies the default page size', () => {
    const result = eventListQuerySchema.parse({
      environment: 'production',
      from: '1789368000000',
      to: '1789368060000',
      type: 'error',
    });

    expect(result).toEqual({
      environment: 'production',
      from: 1_789_368_000_000,
      to: 1_789_368_060_000,
      type: 'error',
      limit: 50,
    });
  });

  it('rejects inverted or unbounded time windows and unknown filters', () => {
    expect(
      eventListQuerySchema.safeParse({ environment: 'test', from: '20', to: '10' }).success,
    ).toBe(false);
    expect(
      eventListQuerySchema.safeParse({
        environment: 'test',
        from: '0',
        to: String(32 * 24 * 60 * 60 * 1_000),
      }).success,
    ).toBe(false);
    expect(
      eventListQuerySchema.safeParse({
        environment: 'test',
        from: '0',
        to: '1',
        typo: 'ignored',
      }).success,
    ).toBe(false);
  });

  it('rejects malformed project identifiers', () => {
    expect(eventListPathSchema.safeParse({ projectId: 'checkout' }).success).toBe(false);
  });
});

describe('event query cursors', () => {
  it('round-trips timestamp and UUIDv7 identity through an opaque value', () => {
    const cursor = {
      timestamp: 1_789_368_060_000,
      eventId: '01994f36-017a-78db-82af-8d463d754f1e',
    };

    expect(decodeEventCursor(encodeEventCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed and non-UUIDv7 cursors', () => {
    expect(() => decodeEventCursor('not-base64-json')).toThrow(InvalidCursorError);
    expect(() =>
      decodeEventCursor(
        Buffer.from(
          JSON.stringify({ timestamp: 1, eventId: '550e8400-e29b-41d4-a716-446655440000' }),
        ).toString('base64url'),
      ),
    ).toThrow(InvalidCursorError);
  });
});
