import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NetworkInstrumentationBridge,
  type BrowserNetworkObservation,
} from '../src/network-runtime.js';

afterEach(() => {
  vi.unstubAllGlobals();
  FakePerformanceObserver.current = undefined;
});

class FakeXmlHttpRequest extends EventTarget {
  status = 0;
  opened:
    | {
        method: string;
        url: string | URL;
        async: boolean;
        username: string | null;
        password: string | null;
      }
    | undefined;
  sentBody: Document | XMLHttpRequestBodyInit | null = null;

  open(
    method: string,
    url: string | URL,
    async = true,
    username: string | null = null,
    password: string | null = null,
  ): void {
    this.opened = { method, url, async, username, password };
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null): void {
    this.sentBody = body;
  }

  complete(status: number): void {
    this.status = status;
    this.dispatchEvent(new Event('loadend'));
  }
}

class FakePerformanceObserver implements PerformanceObserver {
  static readonly supportedEntryTypes = ['resource'];
  static current: FakePerformanceObserver | undefined;
  readonly observe = vi.fn<PerformanceObserver['observe']>();
  readonly disconnect = vi.fn<PerformanceObserver['disconnect']>();
  readonly #callback: PerformanceObserverCallback;

  constructor(callback: PerformanceObserverCallback) {
    this.#callback = callback;
    FakePerformanceObserver.current = this;
  }

  takeRecords(): PerformanceEntryList {
    return [];
  }

  emit(entries: PerformanceEntry[]): void {
    const list: PerformanceObserverEntryList = {
      getEntries: () => entries,
      getEntriesByName: (name) => entries.filter((entry) => entry.name === name),
      getEntriesByType: (type) => entries.filter((entry) => entry.entryType === type),
    };
    this.#callback(list, this);
  }
}

function resourceEntry(
  name: string,
  initiatorType: string,
  responseStatus?: number,
): PerformanceEntry {
  const entry: PerformanceEntry = {
    name,
    entryType: 'resource',
    startTime: 20,
    duration: 30,
    toJSON: () => ({}),
  };
  Object.defineProperties(entry, {
    initiatorType: { value: initiatorType },
    ...(responseStatus === undefined ? {} : { responseStatus: { value: responseStatus } }),
  });
  return entry;
}

function subscribe(
  bridge: NetworkInstrumentationBridge,
  observations: BrowserNetworkObservation[],
  captureResourceTiming = false,
): () => void {
  return bridge.subscribe(
    (observation) => observations.push(observation),
    () => {},
    { captureFetch: true, captureXhr: true, captureResourceTiming },
  );
}

describe('NetworkInstrumentationBridge', () => {
  it('does not patch browser globals when every category is disabled', () => {
    const originalFetch = vi.fn<typeof fetch>();
    const originalOpen = FakeXmlHttpRequest.prototype.open;
    const originalSend = FakeXmlHttpRequest.prototype.send;
    vi.stubGlobal('window', { location: { href: 'https://app.example/' } });
    vi.stubGlobal('fetch', originalFetch);
    vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
    const bridge = new NetworkInstrumentationBridge();

    const cleanup = bridge.subscribe(
      () => {},
      () => {},
      { captureFetch: false, captureXhr: false, captureResourceTiming: false },
    );

    expect(globalThis.fetch).toBe(originalFetch);
    expect(FakeXmlHttpRequest.prototype.open).toBe(originalOpen);
    expect(FakeXmlHttpRequest.prototype.send).toBe(originalSend);
    expect(FakePerformanceObserver.current).toBeUndefined();
    cleanup();
  });

  it('observes Fetch without replacing its promise or exposing a private URL', async () => {
    const response = new Response(null, { status: 503 });
    const originalPromise = Promise.resolve(response);
    const originalFetch = vi.fn<typeof fetch>().mockReturnValue(originalPromise);
    const clock = vi.fn<() => number>().mockReturnValueOnce(10).mockReturnValueOnce(42);
    vi.stubGlobal('window', {
      location: { href: 'https://app.example/checkout?cart=private#summary' },
    });
    vi.stubGlobal('performance', { now: clock });
    vi.stubGlobal('fetch', originalFetch);
    const bridge = new NetworkInstrumentationBridge();
    const observations: BrowserNetworkObservation[] = [];
    const cleanup = subscribe(bridge, observations);

    const returned = globalThis.fetch('/api/orders?token=private', {
      method: 'POST',
      headers: { authorization: 'Bearer private' },
      body: 'private body',
    });
    expect(returned).toBe(originalPromise);
    await returned;
    await Promise.resolve();

    expect(observations).toEqual([
      {
        requestUrl: 'https://app.example/api/orders',
        navigationUrl: 'https://app.example/checkout',
        method: 'POST',
        start: 10,
        duration: 32,
        initiator: 'fetch',
        status: 503,
        success: false,
      },
    ]);
    expect(originalFetch).toHaveBeenCalledWith(
      '/api/orders?token=private',
      expect.objectContaining({ body: 'private body' }),
    );

    cleanup();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('preserves Fetch rejection and does not deliver an old request to a new subscriber', async () => {
    let rejectRequest: ((reason?: unknown) => void) | undefined;
    const request = new Promise<Response>((_resolve, reject) => {
      rejectRequest = reject;
    });
    const originalFetch = vi.fn<typeof fetch>().mockReturnValue(request);
    vi.stubGlobal('window', { location: { href: 'https://app.example/start' } });
    vi.stubGlobal('performance', { now: () => 5 });
    vi.stubGlobal('fetch', originalFetch);
    const bridge = new NetworkInstrumentationBridge();
    const first: BrowserNetworkObservation[] = [];
    const second: BrowserNetworkObservation[] = [];
    const cleanupFirst = subscribe(bridge, first);

    const returned = globalThis.fetch('/slow');
    cleanupFirst();
    const cleanupSecond = subscribe(bridge, second);
    rejectRequest?.(new Error('offline'));
    await expect(returned).rejects.toThrow('offline');
    await Promise.resolve();

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    cleanupSecond();
  });

  it('captures a Fetch rejection without changing the rejected value', async () => {
    const failure = new Error('offline');
    const originalFetch = vi.fn<typeof fetch>().mockRejectedValue(failure);
    vi.stubGlobal('window', { location: { href: 'https://app.example/start' } });
    vi.stubGlobal('performance', {
      now: vi.fn<() => number>().mockReturnValueOnce(7).mockReturnValueOnce(12),
    });
    vi.stubGlobal('fetch', originalFetch);
    const bridge = new NetworkInstrumentationBridge();
    const observations: BrowserNetworkObservation[] = [];
    const cleanup = subscribe(bridge, observations);

    const returned = globalThis.fetch('/offline');
    await expect(returned).rejects.toBe(failure);
    await Promise.resolve();

    expect(observations).toEqual([
      {
        requestUrl: 'https://app.example/offline',
        navigationUrl: 'https://app.example/start',
        method: 'GET',
        start: 7,
        duration: 5,
        initiator: 'fetch',
        failureKind: 'network',
        success: false,
      },
    ]);
    cleanup();
  });

  it('classifies Fetch aborts and timeouts without changing the rejected promise', async () => {
    const failure = new DOMException('aborted', 'AbortError');
    const timeout = new DOMException('timed out', 'TimeoutError');
    const originalFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(timeout);
    vi.stubGlobal('window', { location: { href: 'https://app.example/start' } });
    vi.stubGlobal('performance', { now: () => 5 });
    vi.stubGlobal('fetch', originalFetch);
    const bridge = new NetworkInstrumentationBridge();
    const observations: BrowserNetworkObservation[] = [];
    const cleanup = subscribe(bridge, observations);

    const returned = globalThis.fetch('/cancelled');
    await expect(returned).rejects.toBe(failure);
    await Promise.resolve();
    const timedOut = globalThis.fetch('/timed-out');
    await expect(timedOut).rejects.toBe(timeout);
    await Promise.resolve();

    expect(observations[0]).toMatchObject({ failureKind: 'aborted', success: false });
    expect(observations[1]).toMatchObject({ failureKind: 'timeout', success: false });
    cleanup();
  });

  it('observes XMLHttpRequest and restores the original methods', () => {
    const originalOpen = FakeXmlHttpRequest.prototype.open;
    const originalSend = FakeXmlHttpRequest.prototype.send;
    vi.stubGlobal('window', { location: { href: 'https://app.example/orders?private=1' } });
    vi.stubGlobal('performance', {
      now: vi.fn<() => number>().mockReturnValueOnce(100).mockReturnValueOnce(150),
    });
    vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
    const bridge = new NetworkInstrumentationBridge();
    const observations: BrowserNetworkObservation[] = [];
    const cleanup = subscribe(bridge, observations);
    const request = new FakeXmlHttpRequest();

    request.open('put', '/api/orders/42?token=private');
    request.send('private body');
    request.complete(204);

    expect(request.opened).toMatchObject({ method: 'put', async: true });
    expect(request.sentBody).toBe('private body');
    expect(observations).toEqual([
      {
        requestUrl: 'https://app.example/api/orders/42',
        navigationUrl: 'https://app.example/orders',
        method: 'PUT',
        start: 100,
        duration: 50,
        initiator: 'xhr',
        status: 204,
        success: true,
      },
    ]);

    cleanup();
    expect(FakeXmlHttpRequest.prototype.open).toBe(originalOpen);
    expect(FakeXmlHttpRequest.prototype.send).toBe(originalSend);
  });

  it('captures XMLHttpRequest network failure with status zero', () => {
    vi.stubGlobal('window', { location: { href: 'https://app.example/start' } });
    vi.stubGlobal('performance', { now: () => 10 });
    vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
    const bridge = new NetworkInstrumentationBridge();
    const observations: BrowserNetworkObservation[] = [];
    const cleanup = subscribe(bridge, observations);
    const request = new FakeXmlHttpRequest();

    request.open('GET', 'https://api.example/unavailable');
    request.send();
    request.complete(0);

    expect(observations).toEqual([
      expect.objectContaining({
        requestUrl: 'https://api.example/unavailable',
        initiator: 'xhr',
        status: 0,
        success: false,
      }),
    ]);
    cleanup();
  });

  it('keeps Resource Timing opt-in and ignores Fetch duplicates', () => {
    vi.stubGlobal('window', { location: { href: 'https://app.example/start?private=1' } });
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
    const bridge = new NetworkInstrumentationBridge();
    const observations: BrowserNetworkObservation[] = [];
    const cleanup = subscribe(bridge, observations, true);
    const image = resourceEntry('https://cdn.example/hero.png?signature=private', 'img', 200);

    FakePerformanceObserver.current?.emit([
      image,
      image,
      resourceEntry('https://api.example/orders', 'fetch', 200),
    ]);

    expect(observations).toEqual([
      {
        requestUrl: 'https://cdn.example/hero.png',
        navigationUrl: 'https://app.example/start',
        method: 'GET',
        start: 20,
        duration: 30,
        initiator: 'resource',
        status: 200,
        success: true,
      },
    ]);
    cleanup();
    expect(FakePerformanceObserver.current?.disconnect).toHaveBeenCalledOnce();
  });
});
