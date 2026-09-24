import { SpectroClient } from '@spectro/core';
import type { EventContext, JSONObject } from '@spectro/protocol';
import type {
  CaptureOptions,
  FlushOptions,
  FlushResult,
  SpectroClientOptions,
  SpectroClientPublic,
} from '@spectro/types';
import { IndexedDbEventOutbox, type IndexedDbOutboxOptions } from './outbox.js';

import {
  BrowserErrorCapture,
  type BrowserErrorOptions,
  type CaptureExceptionOptions,
} from './error.js';
import { createBrowserErrorRuntime } from './error-runtime.js';
import { BrowserInteractionCapture, type BrowserInteractionOptions } from './interaction.js';
import { createBrowserInteractionRuntime } from './interaction-runtime.js';
import { SessionPageLifecycle, type SessionPageLifecycleOptions } from './lifecycle.js';
import { BrowserPerformanceCapture, type BrowserPerformanceOptions } from './performance.js';
import { createBrowserPerformanceRuntime } from './performance-runtime.js';
import { createBrowserLifecycleRuntime } from './runtime.js';
import { FetchTransport } from './transport.js';
import { BrowserNetworkCapture, type BrowserNetworkOptions } from './network.js';
import { createBrowserNetworkRuntime } from './network-runtime.js';

export interface BrowserLifecycleOptions {
  sessionTimeoutMs?: number;
}

export interface BrowserClientOptions extends SpectroClientOptions {
  errors?: false | BrowserErrorOptions;
  fetch?: typeof globalThis.fetch;
  interactions?: false | BrowserInteractionOptions;
  lifecycle?: false | BrowserLifecycleOptions;
  network?: false | BrowserNetworkOptions;
  performance?: false | BrowserPerformanceOptions;
  persistence?: false | IndexedDbOutboxOptions;
}

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

export interface BrowserClientPublic extends SpectroClientPublic {
  captureException(value: unknown, options?: CaptureExceptionOptions): string | undefined;
  destroy(): void;
}

let client: BrowserClient | undefined;

function reportSafely(onError: ((error: Error) => void) | undefined, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error('Unknown Spectro SDK error');
  try {
    onError?.(normalized);
  } catch {
    // A customer callback cannot be allowed to escape into the host application.
  }
}

class BrowserClient implements BrowserClientPublic {
  readonly #core: SpectroClient;
  readonly #onError: ((error: Error) => void) | undefined;
  readonly #errorCapture: BrowserErrorCapture;
  readonly #interactionCapture: BrowserInteractionCapture;
  readonly #lifecycle: SessionPageLifecycle | undefined;
  readonly #networkCapture: BrowserNetworkCapture;
  readonly #performanceCapture: BrowserPerformanceCapture;
  #destroyed = false;
  #flushTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  #urgentFlushTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  #batchFlushTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  #retryTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  #retryDelayMs = 1_000;
  #nextRetryAt = 0;
  readonly #pageHideListener = (): void => {
    void this.#flushSafely({ keepalive: true });
  };
  readonly #visibilityChangeListener = (): void => {
    if (document.visibilityState === 'hidden') this.#flushSafely({ keepalive: true });
  };
  readonly #onlineListener = (): void => {
    this.#clearTimer('retry');
    this.#retryDelayMs = 1_000;
    this.#nextRetryAt = 0;
    void this.#flushSafely({ priority: 'immediate' }).then((result) => {
      if (result.remaining > 0) return this.#flushSafely();
      return undefined;
    });
  };

  constructor(options: BrowserClientOptions) {
    this.#onError = options.onError;
    const durableQueue =
      options.persistence === false || typeof indexedDB === 'undefined'
        ? undefined
        : new IndexedDbEventOutbox(options.persistence);
    this.#core = new SpectroClient(options, new FetchTransport(options), {
      ...(durableQueue === undefined ? {} : { durableQueue }),
      onImmediateEvent: () => this.#scheduleUrgentFlush(),
      onBatchReady: () => this.#scheduleBatchFlush(),
      onTransportFailure: (_error, flushOptions) => this.#scheduleRetry(flushOptions),
    });
    const lifecycleRuntime = createBrowserLifecycleRuntime();
    let lifecycle: SessionPageLifecycle | undefined;
    if (lifecycleRuntime !== undefined && options.lifecycle !== false) {
      const lifecycleOptions: SessionPageLifecycleOptions = {
        projectId: options.projectId,
        environment: options.environment,
        ...(options.lifecycle?.sessionTimeoutMs === undefined
          ? {}
          : { sessionTimeoutMs: options.lifecycle.sessionTimeoutMs }),
      };
      lifecycle = new SessionPageLifecycle(
        {
          capture: (input) => this.#core.capture(input),
          updateContext: (context) => this.#core.updateContext(context),
          report: (error) => reportSafely(options.onError, error),
        },
        lifecycleRuntime,
        lifecycleOptions,
      );
    }
    this.#lifecycle = lifecycle;
    const errorOptions = options.errors === false ? {} : (options.errors ?? {});
    this.#errorCapture = new BrowserErrorCapture(
      {
        activity: () => this.#lifecycle?.touch(),
        capture: (input) => this.#core.capture(input),
        report: (error) => reportSafely(options.onError, error),
      },
      options.errors === false ? undefined : createBrowserErrorRuntime(),
      errorOptions,
    );
    const interactionOptions = options.interactions === false ? {} : (options.interactions ?? {});
    this.#interactionCapture = new BrowserInteractionCapture(
      {
        activity: () => this.#lifecycle?.touch(),
        capture: (input) => this.#core.capture(input),
        report: (error) => reportSafely(options.onError, error),
      },
      options.interactions === false ? undefined : createBrowserInteractionRuntime(),
      interactionOptions,
    );
    const performanceOptions = options.performance === false ? {} : (options.performance ?? {});
    this.#performanceCapture = new BrowserPerformanceCapture(
      {
        capture: (input, navigationUrl) => {
          const context = this.#lifecycle?.contextForNavigationUrl(navigationUrl);
          if (
            navigationUrl !== undefined &&
            this.#lifecycle !== undefined &&
            context === undefined
          ) {
            return undefined;
          }
          return this.#core.capture({
            ...input,
            ...(context === undefined ? {} : { context }),
          });
        },
        report: (error) => reportSafely(options.onError, error),
      },
      options.performance === false ? undefined : createBrowserPerformanceRuntime(),
      performanceOptions,
    );
    const networkOptions = options.network === false ? {} : (options.network ?? {});
    this.#networkCapture = new BrowserNetworkCapture(
      {
        capture: (input, navigationUrl, captureOptions?: CaptureOptions) => {
          const context = this.#lifecycle?.contextForNavigationUrl(navigationUrl);
          if (
            navigationUrl !== undefined &&
            this.#lifecycle !== undefined &&
            context === undefined
          ) {
            return undefined;
          }
          return this.#core.capture(
            {
              ...input,
              ...(context === undefined ? {} : { context }),
            },
            captureOptions,
          );
        },
        report: (error) => reportSafely(options.onError, error),
      },
      options.network === false ? undefined : createBrowserNetworkRuntime(),
      options.endpoint,
      networkOptions,
    );

    try {
      this.#lifecycle?.start();
      this.#errorCapture.start();
      this.#interactionCapture.start();
      this.#performanceCapture.start();
      this.#networkCapture.start();
      this.#startAutomaticFlush();
    } catch (error) {
      this.#networkCapture.stop();
      this.#performanceCapture.stop();
      this.#interactionCapture.stop();
      this.#errorCapture.stop();
      this.#lifecycle?.stop();
      throw error;
    }
  }

  track(name: string, properties: JSONObject = {}): string | undefined {
    if (this.#destroyed) return undefined;
    this.#lifecycle?.touch();
    return this.#core.track(name, properties);
  }

  flush(options?: FlushOptions): Promise<FlushResult> {
    if (this.#destroyed) return Promise.resolve({ sent: 0, remaining: 0 });
    return this.#core.flush(options);
  }

  captureException(value: unknown, options?: CaptureExceptionOptions): string | undefined {
    if (this.#destroyed) return undefined;
    return this.#errorCapture.captureException(value, options);
  }

  getContext(): EventContext {
    return this.#core.getContext();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#clearTimer('interval');
    this.#clearTimer('urgent');
    this.#clearTimer('batch');
    this.#clearTimer('retry');
    if (typeof window !== 'undefined')
      window.removeEventListener('pagehide', this.#pageHideListener);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.#onlineListener);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#visibilityChangeListener);
    }
    this.#networkCapture.stop();
    this.#performanceCapture.stop();
    this.#interactionCapture.stop();
    this.#errorCapture.stop();
    this.#lifecycle?.stop();
    if (client === this) client = undefined;
  }

  #startAutomaticFlush(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    this.#flushTimer = globalThis.setInterval(() => this.#flushSafely(), DEFAULT_FLUSH_INTERVAL_MS);
    window.addEventListener('pagehide', this.#pageHideListener);
    window.addEventListener('online', this.#onlineListener);
    document.addEventListener('visibilitychange', this.#visibilityChangeListener);
  }

  #flushSafely(options?: FlushOptions): Promise<FlushResult> {
    if (this.#destroyed) return Promise.resolve({ sent: 0, remaining: 0 });
    if (options?.keepalive !== true && !this.#isOnline()) {
      return Promise.resolve({ sent: 0, remaining: 0 });
    }
    if (options?.keepalive !== true && Date.now() < this.#nextRetryAt) {
      return Promise.resolve({ sent: 0, remaining: 0 });
    }
    return this.flush(options)
      .then((result) => {
        if (result.sent > 0) this.#resetRetry();
        return result;
      })
      .catch((error: unknown) => {
        reportSafely(this.#onError, error);
        return { sent: 0, remaining: 0 };
      });
  }

  #scheduleUrgentFlush(): void {
    if (this.#urgentFlushTimer !== undefined || this.#destroyed) return;
    this.#urgentFlushTimer = globalThis.setTimeout(() => {
      this.#urgentFlushTimer = undefined;
      void this.#flushSafely({ priority: 'immediate' });
    }, 100);
  }

  #scheduleBatchFlush(): void {
    if (this.#batchFlushTimer !== undefined || this.#destroyed) return;
    this.#batchFlushTimer = globalThis.setTimeout(() => {
      this.#batchFlushTimer = undefined;
      void this.#flushSafely({ priority: 'batch' });
    }, 100);
  }

  #scheduleRetry(options: FlushOptions): void {
    if (this.#destroyed || !this.#isOnline()) return;
    this.#clearTimer('retry');
    const delay = this.#retryDelayMs;
    this.#retryDelayMs = Math.min(this.#retryDelayMs * 2, 60_000);
    this.#nextRetryAt = Date.now() + delay;
    this.#retryTimer = globalThis.setTimeout(() => {
      this.#retryTimer = undefined;
      this.#nextRetryAt = 0;
      void this.#flushSafely(options);
    }, delay);
  }

  #resetRetry(): void {
    this.#clearTimer('retry');
    this.#retryDelayMs = 1_000;
    this.#nextRetryAt = 0;
  }

  #isOnline(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  #clearTimer(kind: 'interval' | 'urgent' | 'batch' | 'retry'): void {
    if (kind === 'interval' && this.#flushTimer !== undefined) {
      globalThis.clearInterval(this.#flushTimer);
      this.#flushTimer = undefined;
    } else if (kind === 'urgent' && this.#urgentFlushTimer !== undefined) {
      globalThis.clearTimeout(this.#urgentFlushTimer);
      this.#urgentFlushTimer = undefined;
    } else if (kind === 'batch' && this.#batchFlushTimer !== undefined) {
      globalThis.clearTimeout(this.#batchFlushTimer);
      this.#batchFlushTimer = undefined;
    } else if (kind === 'retry' && this.#retryTimer !== undefined) {
      globalThis.clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }
}

export function init(options: BrowserClientOptions): BrowserClientPublic | undefined {
  try {
    client?.destroy();
    client = new BrowserClient(options);
    return client;
  } catch (error) {
    client = undefined;
    reportSafely(options?.onError, error);
    return undefined;
  }
}

export function track(name: string, properties: JSONObject = {}): string | undefined {
  if (!client) {
    return undefined;
  }
  return client.track(name, properties);
}

export function captureException(
  value: unknown,
  options?: CaptureExceptionOptions,
): string | undefined {
  return client?.captureException(value, options);
}

export async function flush(options?: FlushOptions): Promise<FlushResult> {
  if (!client) {
    return { sent: 0, remaining: 0 };
  }
  return client.flush(options);
}

export function destroy(): void {
  client?.destroy();
}

export { FetchTransport } from './transport.js';
export { IndexedDbEventOutbox } from './outbox.js';
export { DEFAULT_SESSION_TIMEOUT_MS } from './lifecycle.js';
export type { CaptureOptions, DeliveryPriority, DurableEventQueue } from '@spectro/types';
export type { IndexedDbOutboxOptions } from './outbox.js';
export type { FlushOptions } from '@spectro/types';
export type { BrowserErrorOptions, CaptureExceptionOptions } from './error.js';
export type { BrowserInteractionOptions } from './interaction.js';
export type { BrowserPerformanceOptions } from './performance.js';
export type { BrowserNetworkOptions } from './network.js';
export type { FetchTransportOptions } from './transport.js';
export type { JSONObject, SpectroClientOptions, SpectroClientPublic };
