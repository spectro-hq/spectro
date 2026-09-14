import { describe, expect, it } from 'vitest';

import {
  ENVELOPE_VERSION,
  EVENT_VERSION,
  MAX_ENVELOPE_STRUCTURE_DEPTH,
  isJsonDepthWithin,
  validateEnvelope,
  validateEvent,
  type Envelope,
  type SpectroEvent,
} from '../src/index.js';

const event: SpectroEvent<'custom'> = {
  id: '01994f34-b106-79a3-9865-d835ac0347a9',
  type: 'custom',
  name: 'checkout_started',
  version: EVENT_VERSION,
  timestamp: 1_789_368_123_456,
  context: {
    sdk: { name: '@spectro/browser', version: '0.1.0' },
    project: { id: 'prj_checkout' },
    environment: 'production',
    session: { id: 'ses_01' },
  },
  payload: {
    properties: { amount: 399, currency: 'CNY', items: 3 },
  },
};

describe('protocol validation', () => {
  it('accepts a valid custom event envelope', () => {
    const envelope: Envelope = {
      version: ENVELOPE_VERSION,
      sentAt: event.timestamp,
      items: [{ type: 'event', payload: event }],
    };

    expect(validateEvent(event)).toEqual({ success: true, data: event });
    expect(validateEnvelope(envelope)).toEqual({ success: true, data: envelope });
  });

  it('rejects non-snake-case event names', () => {
    const result = validateEvent({ ...event, name: 'checkoutStarted' });

    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.issues;
    expect(issues.some((issue) => issue.path === '/name')).toBe(true);
  });

  it('rejects a payload that does not match its event type', () => {
    const result = validateEvent({
      ...event,
      type: 'error',
      name: 'runtime_error',
    });

    expect(result.success).toBe(false);
  });

  it('rejects credentials embedded in event context', () => {
    const result = validateEvent({
      ...event,
      context: { ...event.context, apiKey: 'sp_secret' },
    });

    expect(result.success).toBe(false);
  });

  it('checks hostile nesting without recursive stack growth', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 10_000; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    expect(isJsonDepthWithin(root, MAX_ENVELOPE_STRUCTURE_DEPTH)).toBe(false);
    expect(validateEnvelope(root)).toMatchObject({
      success: false,
      issues: [{ keyword: 'maxDepth' }],
    });
  });
});
