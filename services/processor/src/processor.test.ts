import { describe, expect, it, vi } from 'vitest';

import {
  ENVELOPE_VERSION,
  EVENT_VERSION,
  type Envelope,
  type SpectroEvent,
} from '@spectro/protocol';

import { createErrorFingerprint } from './fingerprint.js';
import { EventProcessor, type ProcessedEvent, type ProcessedEventWriter } from './processor.js';

const context = {
  sdk: { name: '@spectro/browser', version: '0.1.0' },
  project: { id: 'prj_checkout' },
  environment: 'production',
};

function envelopeOf(...events: SpectroEvent[]): Envelope {
  return {
    version: ENVELOPE_VERSION,
    sentAt: 1_789_368_123_456,
    items: events.map((event) => ({ type: 'event', payload: event })),
  };
}

function errorEvent(message: string): SpectroEvent<'error'> {
  return {
    id: '01994f34-b106-79a3-9865-d835ac0347a9',
    type: 'error',
    name: 'runtime_error',
    version: EVENT_VERSION,
    timestamp: 1_789_368_123_456,
    context,
    payload: {
      mechanism: 'runtime',
      name: 'TypeError',
      message,
      handled: false,
      stack: [
        {
          filename: 'https://app.example/assets/checkout-9128.js?v=77',
          function: 'submitOrder',
          line: 928,
          column: 14,
          inApp: true,
        },
      ],
    },
  };
}

describe('error fingerprinting', () => {
  it('normalizes volatile identifiers without trusting a client-computed hash', () => {
    const first = errorEvent('Order 48291 failed for 01994f34-b106-79a3-9865-d835ac0347a9');
    const second = errorEvent('Order 78214 failed for 01994f36-017a-78db-82af-8d463d754f1e');

    expect(createErrorFingerprint(first.payload)).toBe(createErrorFingerprint(second.payload));
    expect(createErrorFingerprint(first.payload)).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('uses bounded client hints as grouping input but computes the final hash server-side', () => {
    const first = {
      ...errorEvent('message one'),
      payload: { ...errorEvent('message one').payload, fingerprint: ['checkout'] },
    };
    const second = {
      ...errorEvent('message two'),
      payload: { ...errorEvent('message two').payload, fingerprint: ['checkout'] },
    };

    expect(createErrorFingerprint(first.payload)).toBe(createErrorFingerprint(second.payload));
    expect(createErrorFingerprint(first.payload)).not.toBe('checkout');
  });
});

describe('EventProcessor', () => {
  it('writes an envelope as one processed batch with server metadata', async () => {
    const written: ProcessedEvent[][] = [];
    const writer: ProcessedEventWriter = {
      async append(events) {
        written.push([...events]);
      },
    };
    const customEvent: SpectroEvent<'custom'> = {
      id: '01994f36-017a-78db-82af-8d463d754f1e',
      type: 'custom',
      name: 'checkout_started',
      version: EVENT_VERSION,
      timestamp: 1_789_368_123_456,
      context,
      payload: { properties: { amount: 399 } },
    };
    const processor = new EventProcessor(writer, () => 1_789_368_130_000);

    await expect(
      processor.process(envelopeOf(customEvent, errorEvent('Checkout failed'))),
    ).resolves.toEqual({ processed: 2 });
    expect(written).toHaveLength(1);
    expect(written[0]?.[0]).toEqual({
      event: customEvent,
      processing: {
        version: 1,
        envelopeSentAt: 1_789_368_123_456,
        processedAt: 1_789_368_130_000,
      },
    });
    expect(written[0]?.[1]?.processing.errorFingerprint).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('does not report success when the durable writer rejects the batch', async () => {
    const failure = new Error('event plane unavailable');
    const append = vi.fn<ProcessedEventWriter['append']>().mockRejectedValue(failure);
    const processor = new EventProcessor({ append });

    await expect(processor.process(envelopeOf(errorEvent('Checkout failed')))).rejects.toBe(
      failure,
    );
    expect(append).toHaveBeenCalledOnce();
  });
});
