import { describe, expect, it, vi } from 'vitest';

import { ENVELOPE_VERSION, EVENT_VERSION, type Envelope } from '@spectro/protocol';

import { FetchTransport, init, track } from '../src/index.js';

const envelope: Envelope = {
  version: ENVELOPE_VERSION,
  sentAt: 1_789_368_123_456,
  items: [
    {
      type: 'event',
      payload: {
        id: '01994f34-b106-79a3-9865-d835ac0347a9',
        type: 'custom',
        name: 'checkout_started',
        version: EVENT_VERSION,
        timestamp: 1_789_368_123_456,
        context: {
          sdk: { name: '@spectro/browser', version: '0.1.0' },
          project: { id: 'prj_checkout' },
          environment: 'production',
        },
        payload: { properties: {} },
      },
    },
  ],
};

describe('FetchTransport', () => {
  it('sends credentials in a header rather than the envelope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const transport = new FetchTransport({
      endpoint: 'https://ingest.spectro.dev/',
      apiKey: 'sp_secret',
      fetch: fetchMock,
    });

    await expect(transport.send(envelope)).resolves.toEqual({ accepted: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ingest.spectro.dev/v1/envelope',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-spectro-key': 'sp_secret' }),
      }),
    );
    expect(JSON.stringify(envelope)).not.toContain('sp_secret');
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit).not.toHaveProperty('keepalive');
  });

  it('does not throw when track is called before initialization', () => {
    expect(() => track('early_event')).not.toThrow();
    expect(track('early_event')).toBeUndefined();
  });

  it('contains initialization failures and reports them through onError', () => {
    const errors: Error[] = [];

    expect(() =>
      init({
        projectId: 'prj_test',
        environment: 'test',
        endpoint: undefined as never,
        apiKey: 'sp_test',
        onError: (error) => errors.push(error),
      }),
    ).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});
