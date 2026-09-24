import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENVELOPE_VERSION, EVENT_VERSION, type Envelope } from '@spectro/protocol';

import { captureException, destroy, FetchTransport, flush, init, track } from '../src/index.js';

afterEach(() => {
  destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function installBrowserEvents(): { windowEvents: EventTarget; documentEvents: EventTarget } {
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  vi.stubGlobal('window', {
    location: { href: 'https://app.example/checkout' },
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  });
  return { windowEvents, documentEvents };
}

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

  it('automatically flushes queued events every five seconds', async () => {
    vi.useFakeTimers();
    installBrowserEvents();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 202 }));
    const initialized = init({
      projectId: 'prj_test',
      environment: 'test',
      endpoint: 'https://ingest.example',
      apiKey: 'sp_test',
      fetch: fetchMock,
      lifecycle: false,
      errors: false,
      interactions: false,
      network: false,
      performance: false,
    });

    initialized?.track('automatic_flush');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('keepalive');
  });

  it('flushes a bounded keepalive envelope when the page is hidden', async () => {
    const { documentEvents } = installBrowserEvents();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 202 }));
    const initialized = init({
      projectId: 'prj_test',
      environment: 'test',
      endpoint: 'https://ingest.example',
      apiKey: 'sp_test',
      fetch: fetchMock,
      lifecycle: false,
      errors: false,
      interactions: false,
      network: false,
      performance: false,
    });
    initialized?.track('hidden_page_flush');

    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    });
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    expect(fetchMock.mock.calls[0]?.[1]).toHaveProperty('keepalive', true);
  });

  it('uses pagehide to request keepalive delivery', async () => {
    const { windowEvents } = installBrowserEvents();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 202 }));
    const initialized = init({
      projectId: 'prj_test',
      environment: 'test',
      endpoint: 'https://ingest.example',
      apiKey: 'sp_test',
      fetch: fetchMock,
      lifecycle: false,
      errors: false,
      interactions: false,
      network: false,
      performance: false,
    });
    initialized?.track('pagehide_flush');

    windowEvents.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    expect(fetchMock.mock.calls[0]?.[1]).toHaveProperty('keepalive', true);
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

  it('captures application Fetch traffic without recursively capturing envelope delivery', async () => {
    const originalFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://ingest.example/v1/envelope') {
        return new Response(JSON.stringify({ accepted: 1 }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal('window', {
      location: { href: 'https://app.example/checkout?cart=private' },
      addEventListener: vi.fn<() => void>(),
      removeEventListener: vi.fn<() => void>(),
    });
    vi.stubGlobal('fetch', originalFetch);

    const initialized = init({
      projectId: 'prj_test',
      environment: 'test',
      endpoint: 'https://ingest.example',
      apiKey: 'sp_test',
      lifecycle: false,
      errors: false,
      performance: false,
    });
    expect(initialized).toBeDefined();
    expect(globalThis.fetch).not.toBe(originalFetch);

    await expect(
      globalThis.fetch('https://api.example/orders?authorization=private'),
    ).resolves.toMatchObject({ status: 503 });
    await expect(flush()).resolves.toEqual({ sent: 1, remaining: 0 });

    expect(originalFetch).toHaveBeenCalledTimes(2);
    const envelopeRequest = originalFetch.mock.calls[1];
    expect(envelopeRequest?.[0]).toBe('https://ingest.example/v1/envelope');
    const requestBody = envelopeRequest?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    const sent: unknown = JSON.parse(typeof requestBody === 'string' ? requestBody : '{}');
    expect(sent).toMatchObject({
      items: [
        {
          payload: {
            type: 'network',
            name: 'fetch_request',
            payload: {
              request: { method: 'GET', url: 'https://api.example/orders' },
              response: { status: 503 },
              initiator: 'fetch',
              success: false,
            },
          },
        },
      ],
    });
    expect(JSON.stringify(sent)).not.toContain('authorization');
    expect(JSON.stringify(sent)).not.toContain('private');

    initialized?.destroy();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('captures lifecycle events through the public browser API and restores History', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: 5 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const storage = new Map<string, string>();
    const location = { href: 'https://app.example/start?token=private' };
    const originalPushState = (_data: unknown, _unused: string, url?: string | URL | null) => {
      if (url !== undefined && url !== null) {
        location.href = new URL(String(url), location.href).href;
      }
    };
    const originalReplaceState = originalPushState;
    const history = { pushState: originalPushState, replaceState: originalReplaceState };
    const browserWindow = {
      location,
      history,
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    };
    const browserDocument = {
      title: 'Start',
      referrer: '',
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    };
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('document', browserDocument);

    const initialized = init({
      projectId: 'prj_test',
      environment: 'test',
      endpoint: 'https://ingest.example',
      apiKey: 'sp_test',
      fetch: fetchMock,
      performance: false,
    });
    expect(initialized).toBeDefined();
    expect(history.pushState).not.toBe(originalPushState);

    track('app_ready');
    captureException(new Error('Manual failure'));
    const runtimeError = new Event('error');
    Object.defineProperties(runtimeError, {
      message: { value: 'Runtime failure' },
      error: { value: new Error('Runtime failure') },
      filename: { value: 'https://app.example/app.js?token=private' },
      lineno: { value: 7 },
      colno: { value: 9 },
    });
    windowEvents.dispatchEvent(runtimeError);
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    const sent: unknown = JSON.parse(typeof requestBody === 'string' ? requestBody : '{}');
    expect(sent).toMatchObject({
      items: [
        { payload: { name: 'session_start' } },
        {
          payload: {
            name: 'page_view',
            context: { page: { url: 'https://app.example/start', path: '/start' } },
          },
        },
        { payload: { name: 'app_ready' } },
        { payload: { name: 'manual_error', payload: { handled: true } } },
        {
          payload: {
            name: 'runtime_error',
            payload: {
              handled: false,
              source: { url: 'https://app.example/app.js', line: 7, column: 9 },
            },
          },
        },
      ],
    });

    initialized?.destroy();
    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);
  });
});
