import type { NetworkPayload } from '@spectro/protocol';

import { sanitizePageUrl } from './lifecycle.js';
import { sanitizeNetworkMethod, sanitizeNetworkUrl } from './network-url.js';

export interface BrowserNetworkObservation {
  requestUrl: string;
  navigationUrl?: string;
  method: string;
  start: number;
  duration: number;
  initiator: NetworkPayload['initiator'];
  status?: number;
  success: boolean;
}

export interface BrowserNetworkSubscriptionOptions {
  captureFetch: boolean;
  captureXhr: boolean;
  captureResourceTiming: boolean;
}

export interface BrowserNetworkRuntime {
  subscribe(
    listener: (observation: BrowserNetworkObservation) => void,
    report: (error: unknown) => void,
    options: BrowserNetworkSubscriptionOptions,
  ): () => void;
}

interface Subscriber {
  listener: (observation: BrowserNetworkObservation) => void;
  report: (error: unknown) => void;
  captureFetch: boolean;
  captureXhr: boolean;
  captureResourceTiming: boolean;
}

interface OpenXhr {
  method: string;
  requestUrl: string;
}

interface PendingXhr extends OpenXhr {
  navigationUrl?: string;
  start: number;
  subscribers: ReadonlySet<Subscriber>;
}

function readProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function readString(value: object, key: string): string | undefined {
  const candidate = readProperty(value, key);
  return typeof candidate === 'string' ? candidate : undefined;
}

function now(): number {
  try {
    const value = globalThis.performance?.now();
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function currentNavigationUrl(): string | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    return sanitizePageUrl(window.location.href)?.url;
  } catch {
    return undefined;
  }
}

function requestDetails(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  navigationUrl: string | undefined,
): OpenXhr | undefined {
  try {
    let rawUrl: string | undefined;
    let requestMethod: string | undefined;
    if (typeof input === 'string') {
      rawUrl = input;
    } else if (typeof URL !== 'undefined' && input instanceof URL) {
      rawUrl = input.href;
    } else if (typeof input === 'object' && input !== null) {
      rawUrl = readString(input, 'url');
      requestMethod = readString(input, 'method');
    }
    if (rawUrl === undefined) return undefined;
    const requestUrl = sanitizeNetworkUrl(rawUrl, navigationUrl);
    const method = sanitizeNetworkMethod(init?.method ?? requestMethod ?? 'GET');
    if (requestUrl === undefined || method === undefined) return undefined;
    return {
      requestUrl,
      method,
    };
  } catch {
    return undefined;
  }
}

function boundedStatus(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 599
    ? Number(value)
    : undefined;
}

export class NetworkInstrumentationBridge implements BrowserNetworkRuntime {
  readonly #subscribers = new Set<Subscriber>();
  readonly #openXhrs = new WeakMap<XMLHttpRequest, OpenXhr>();
  readonly #pendingXhrs = new WeakMap<XMLHttpRequest, PendingXhr>();
  readonly #seenResourceEntries = new WeakSet<object>();
  #restoreFetch: (() => void) | undefined;
  #restoreXhr: (() => void) | undefined;
  #resourceObserver: PerformanceObserver | undefined;

  subscribe(
    listener: (observation: BrowserNetworkObservation) => void,
    report: (error: unknown) => void,
    options: BrowserNetworkSubscriptionOptions,
  ): () => void {
    const subscriber: Subscriber = {
      listener,
      report,
      captureFetch: options.captureFetch,
      captureXhr: options.captureXhr,
      captureResourceTiming: options.captureResourceTiming,
    };
    this.#subscribers.add(subscriber);
    this.#syncInstrumentation();

    return () => {
      this.#subscribers.delete(subscriber);
      this.#syncInstrumentation();
    };
  }

  #syncInstrumentation(): void {
    const subscribers = [...this.#subscribers];
    if (subscribers.some((subscriber) => subscriber.captureFetch)) {
      try {
        this.#installFetch();
      } catch (error) {
        this.#report(error);
      }
    } else {
      this.#stopFetch();
    }
    if (subscribers.some((subscriber) => subscriber.captureXhr)) {
      try {
        this.#installXhr();
      } catch (error) {
        this.#report(error);
      }
    } else {
      this.#stopXhr();
    }
    if (subscribers.some((subscriber) => subscriber.captureResourceTiming)) {
      this.#startResourceObserver();
    } else {
      this.#stopResourceObserver();
    }
  }

  #stopXhr(): void {
    const restoreXhr = this.#restoreXhr;
    this.#restoreXhr = undefined;
    try {
      restoreXhr?.();
    } catch (error) {
      this.#report(error);
    }
  }

  #stopFetch(): void {
    const restoreFetch = this.#restoreFetch;
    this.#restoreFetch = undefined;
    try {
      restoreFetch?.();
    } catch (error) {
      this.#report(error);
    }
  }

  #installFetch(): void {
    if (this.#restoreFetch !== undefined || typeof globalThis.fetch !== 'function') return;
    const original = globalThis.fetch;
    const wrapped: typeof globalThis.fetch = (input, init) => {
      const start = now();
      const navigationUrl = currentNavigationUrl();
      const details = requestDetails(input, init, navigationUrl);
      const subscribers = new Set(this.#subscribers);
      let request: Promise<Response>;
      try {
        request = original(input, init);
      } catch (error) {
        if (details !== undefined) {
          this.#dispatch(
            {
              ...details,
              ...(navigationUrl === undefined ? {} : { navigationUrl }),
              start,
              duration: Math.max(0, now() - start),
              initiator: 'fetch',
              success: false,
            },
            subscribers,
          );
        }
        throw error;
      }

      if (details !== undefined) {
        try {
          void request.then(
            (response) => {
              try {
                const status = boundedStatus(response.status);
                this.#dispatch(
                  {
                    ...details,
                    ...(navigationUrl === undefined ? {} : { navigationUrl }),
                    start,
                    duration: Math.max(0, now() - start),
                    initiator: 'fetch',
                    ...(status === undefined ? {} : { status }),
                    success: response.ok,
                  },
                  subscribers,
                );
              } catch (error) {
                this.#report(error, subscribers);
              }
            },
            () => {
              this.#dispatch(
                {
                  ...details,
                  ...(navigationUrl === undefined ? {} : { navigationUrl }),
                  start,
                  duration: Math.max(0, now() - start),
                  initiator: 'fetch',
                  success: false,
                },
                subscribers,
              );
            },
          );
        } catch (error) {
          this.#report(error, subscribers);
        }
      }
      return request;
    };

    globalThis.fetch = wrapped;
    this.#restoreFetch = () => {
      if (globalThis.fetch === wrapped) globalThis.fetch = original;
    };
  }

  #installXhr(): void {
    if (this.#restoreXhr !== undefined || typeof XMLHttpRequest === 'undefined') return;
    const prototype = XMLHttpRequest.prototype;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    const rememberOpen = (request: XMLHttpRequest, method: string, url: string | URL): void => {
      try {
        const navigationUrl = currentNavigationUrl();
        const requestUrl = sanitizeNetworkUrl(String(url), navigationUrl);
        const normalizedMethod = sanitizeNetworkMethod(method);
        if (requestUrl === undefined || normalizedMethod === undefined) {
          this.#openXhrs.delete(request);
        } else {
          this.#openXhrs.set(request, { method: normalizedMethod, requestUrl });
        }
      } catch (error) {
        this.#openXhrs.delete(request);
        this.#report(error);
      }
    };
    const sendWithInstrumentation = (
      request: XMLHttpRequest,
      body: Document | XMLHttpRequestBodyInit | null | undefined,
    ): void => {
      const details = this.#openXhrs.get(request);
      if (details === undefined) {
        originalSend.call(request, body ?? null);
        return;
      }

      const navigationUrl = currentNavigationUrl();
      const pending: PendingXhr = {
        ...details,
        ...(navigationUrl === undefined ? {} : { navigationUrl }),
        start: now(),
        subscribers: new Set(this.#subscribers),
      };
      this.#pendingXhrs.set(request, pending);
      const complete = () => this.#completeXhr(request);
      try {
        request.addEventListener('loadend', complete, { once: true });
      } catch (error) {
        this.#pendingXhrs.delete(request);
        this.#report(error, pending.subscribers);
        originalSend.call(request, body ?? null);
        return;
      }
      try {
        originalSend.call(request, body ?? null);
      } catch (error) {
        request.removeEventListener('loadend', complete);
        this.#pendingXhrs.delete(request);
        throw error;
      }
    };

    function wrappedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
      rememberOpen(this, method, url);
    }

    function wrappedSend(
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ): void {
      sendWithInstrumentation(this, body);
    }

    prototype.open = wrappedOpen;
    try {
      prototype.send = wrappedSend;
    } catch (error) {
      if (prototype.open === wrappedOpen) prototype.open = originalOpen;
      throw error;
    }
    this.#restoreXhr = () => {
      if (prototype.open === wrappedOpen) prototype.open = originalOpen;
      if (prototype.send === wrappedSend) prototype.send = originalSend;
    };
  }

  #completeXhr(request: XMLHttpRequest): void {
    const pending = this.#pendingXhrs.get(request);
    this.#pendingXhrs.delete(request);
    if (pending === undefined) return;
    try {
      const status = boundedStatus(request.status);
      this.#dispatch(
        {
          requestUrl: pending.requestUrl,
          method: pending.method,
          ...(pending.navigationUrl === undefined ? {} : { navigationUrl: pending.navigationUrl }),
          start: pending.start,
          duration: Math.max(0, now() - pending.start),
          initiator: 'xhr',
          ...(status === undefined ? {} : { status }),
          success: status !== undefined && status >= 200 && status < 300,
        },
        pending.subscribers,
      );
    } catch (error) {
      this.#report(error, pending.subscribers);
    }
  }

  #startResourceObserver(): void {
    if (this.#resourceObserver !== undefined || typeof PerformanceObserver === 'undefined') return;
    if (!PerformanceObserver.supportedEntryTypes?.includes('resource')) return;
    try {
      const observer = new PerformanceObserver((list) => {
        try {
          for (const entry of list.getEntries()) this.#captureResource(entry);
        } catch (error) {
          this.#report(error);
        }
      });
      observer.observe({ type: 'resource', buffered: true });
      this.#resourceObserver = observer;
    } catch (error) {
      this.#report(error);
    }
  }

  #stopResourceObserver(): void {
    const observer = this.#resourceObserver;
    this.#resourceObserver = undefined;
    if (observer === undefined) return;
    try {
      observer.disconnect();
    } catch (error) {
      this.#report(error);
    }
  }

  #captureResource(entry: PerformanceEntry): void {
    if (this.#seenResourceEntries.has(entry)) return;
    this.#seenResourceEntries.add(entry);
    try {
      const initiatorType = readString(entry, 'initiatorType')?.toLowerCase();
      if (
        initiatorType === 'fetch' ||
        initiatorType === 'xmlhttprequest' ||
        initiatorType === 'beacon'
      ) {
        return;
      }
      const navigationUrl = currentNavigationUrl();
      const requestUrl = sanitizeNetworkUrl(entry.name, navigationUrl);
      if (requestUrl === undefined) return;
      const status = boundedStatus(readProperty(entry, 'responseStatus'));
      this.#dispatch({
        requestUrl,
        ...(navigationUrl === undefined ? {} : { navigationUrl }),
        method: 'GET',
        start: Math.max(0, entry.startTime),
        duration: Math.max(0, entry.duration),
        initiator: 'resource',
        ...(status === undefined || status === 0 ? {} : { status }),
        success: status === undefined || status === 0 || (status >= 200 && status < 300),
      });
    } catch (error) {
      this.#report(error);
    }
  }

  #dispatch(observation: BrowserNetworkObservation, recipients?: ReadonlySet<Subscriber>): void {
    for (const subscriber of this.#subscribers) {
      if (recipients !== undefined && !recipients.has(subscriber)) continue;
      if (observation.initiator === 'fetch' && !subscriber.captureFetch) continue;
      if (observation.initiator === 'xhr' && !subscriber.captureXhr) continue;
      if (observation.initiator === 'resource' && !subscriber.captureResourceTiming) continue;
      try {
        subscriber.listener(observation);
      } catch (error) {
        try {
          subscriber.report(error);
        } catch {
          // Subscriber reporting must not affect the host application.
        }
      }
    }
  }

  #report(error: unknown, recipients?: ReadonlySet<Subscriber>): void {
    for (const subscriber of this.#subscribers) {
      if (recipients !== undefined && !recipients.has(subscriber)) continue;
      try {
        subscriber.report(error);
      } catch {
        // Subscriber reporting must not affect instrumentation cleanup.
      }
    }
  }
}

const bridge = new NetworkInstrumentationBridge();

export function createBrowserNetworkRuntime(): BrowserNetworkRuntime | undefined {
  return typeof window === 'undefined' ? undefined : bridge;
}
