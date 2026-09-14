import { SpectroClient } from '@spectro/core';
import type { EventContext, JSONObject } from '@spectro/protocol';
import type { FlushResult, SpectroClientOptions, SpectroClientPublic } from '@spectro/types';

import {
  BrowserErrorCapture,
  type BrowserErrorOptions,
  type CaptureExceptionOptions,
} from './error.js';
import { createBrowserErrorRuntime } from './error-runtime.js';
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
  lifecycle?: false | BrowserLifecycleOptions;
  network?: false | BrowserNetworkOptions;
  performance?: false | BrowserPerformanceOptions;
}

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
  readonly #errorCapture: BrowserErrorCapture;
  readonly #lifecycle: SessionPageLifecycle | undefined;
  readonly #networkCapture: BrowserNetworkCapture;
  readonly #performanceCapture: BrowserPerformanceCapture;
  #destroyed = false;

  constructor(options: BrowserClientOptions) {
    this.#core = new SpectroClient(options, new FetchTransport(options));
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
      options.network === false ? undefined : createBrowserNetworkRuntime(),
      options.endpoint,
      networkOptions,
    );

    try {
      this.#lifecycle?.start();
      this.#errorCapture.start();
      this.#performanceCapture.start();
      this.#networkCapture.start();
    } catch (error) {
      this.#networkCapture.stop();
      this.#performanceCapture.stop();
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

  flush(): Promise<FlushResult> {
    if (this.#destroyed) return Promise.resolve({ sent: 0, remaining: 0 });
    return this.#core.flush();
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
    this.#networkCapture.stop();
    this.#performanceCapture.stop();
    this.#errorCapture.stop();
    this.#lifecycle?.stop();
    if (client === this) client = undefined;
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

export async function flush(): Promise<FlushResult> {
  if (!client) {
    return { sent: 0, remaining: 0 };
  }
  return client.flush();
}

export function destroy(): void {
  client?.destroy();
}

export { FetchTransport } from './transport.js';
export { DEFAULT_SESSION_TIMEOUT_MS } from './lifecycle.js';
export type { BrowserErrorOptions, CaptureExceptionOptions } from './error.js';
export type { BrowserPerformanceOptions } from './performance.js';
export type { BrowserNetworkOptions } from './network.js';
export type { FetchTransportOptions } from './transport.js';
export type { JSONObject, SpectroClientOptions, SpectroClientPublic };
