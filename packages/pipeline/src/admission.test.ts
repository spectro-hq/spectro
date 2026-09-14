import { describe, expect, it } from 'vitest';

import { ENVELOPE_VERSION, EVENT_VERSION, type Envelope } from '@spectro/protocol';

import {
  InvalidAdmittedEnvelopeError,
  createAdmissionMetadata,
  createEnvelopeId,
  decodeAdmittedEnvelope,
  encodeEnvelope,
} from './admission.js';

const envelope: Envelope = {
  version: ENVELOPE_VERSION,
  sentAt: 1_789_368_123_456,
  items: [
    {
      type: 'event',
      payload: {
        id: '01994f36-017a-78db-82af-8d463d754f1e',
        type: 'custom',
        name: 'checkout_started',
        version: EVENT_VERSION,
        timestamp: 1_789_368_123_456,
        context: {
          sdk: { name: '@spectro/browser', version: '0.1.0' },
          project: { id: 'prj_checkout' },
          environment: 'production',
        },
        payload: { properties: { amount: 399 } },
      },
    },
  ],
};

describe('admission envelope codec', () => {
  it('derives a deterministic identity and round-trips a validated envelope', () => {
    const metadata = createAdmissionMetadata(envelope, 1_789_368_124_000);

    expect(createEnvelopeId(envelope)).toMatch(/^[0-9a-f]{32}$/u);
    expect(decodeAdmittedEnvelope(encodeEnvelope(envelope), metadata)).toEqual({
      ...metadata,
      envelope,
    });
  });

  it('changes identity when ordered event identity changes', () => {
    const changed: Envelope = {
      ...envelope,
      items: [
        {
          type: 'event',
          payload: {
            ...envelope.items[0]!.payload,
            id: '01994f37-7dce-7ce7-9868-d83e9eae69d2',
          },
        },
      ],
    };

    expect(createEnvelopeId(changed)).not.toBe(createEnvelopeId(envelope));
  });

  it('rejects malformed or identity-mismatched broker data', () => {
    const metadata = createAdmissionMetadata(envelope, 1_789_368_124_000);

    expect(() => decodeAdmittedEnvelope(new Uint8Array([255]), metadata)).toThrow(
      InvalidAdmittedEnvelopeError,
    );
    expect(() =>
      decodeAdmittedEnvelope(encodeEnvelope(envelope), { ...metadata, envelopeId: '0'.repeat(32) }),
    ).toThrow('identity does not match');
  });
});
