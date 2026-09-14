import { SpectroClient } from '@spectro/core';
import type { EventContext, JSONObject } from '@spectro/protocol';
import type { FlushResult, SpectroClientOptions, SpectroClientPublic } from '@spectro/types';

import { SessionPageLifecycle, type SessionPageLifecycleOptions } from './lifecycle.js';
import { createBrowserLifecycleRuntime } from './runtime.js';
import { FetchTransport } from './transport.js';

export interface BrowserLifecycleOptions {
  sessionTimeoutMs?: number;
}

export interface BrowserClientOptions extends SpectroClientOptions {
  fetch?: typeof globalThis.fetch;
  lifecycle?: false | BrowserLifecycleOptions;
}

export interface BrowserClientPublic extends SpectroClientPublic {
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
  readonly #lifecycle: SessionPageLifecycle | undefined;
  #destroyed = false;

  constructor(options: BrowserClientOptions) {
    this.#core = new SpectroClient(options, new FetchTransport(options));
    const runtime = createBrowserLifecycleRuntime();
    if (runtime !== undefined && options.lifecycle !== false) {
      const lifecycleOptions: SessionPageLifecycleOptions = {
        projectId: options.projectId,
        environment: options.environment,
        ...(options.lifecycle?.sessionTimeoutMs === undefined
          ? {}
          : { sessionTimeoutMs: options.lifecycle.sessionTimeoutMs }),
      };
      this.#lifecycle = new SessionPageLifecycle(
        {
          capture: (input) => this.#core.capture(input),
          updateContext: (context) => this.#core.updateContext(context),
          report: (error) => reportSafely(options.onError, error),
        },
        runtime,
        lifecycleOptions,
      );
      this.#lifecycle.start();
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

  getContext(): EventContext {
    return this.#core.getContext();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
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
export type { FetchTransportOptions } from './transport.js';
export type { JSONObject, SpectroClientOptions, SpectroClientPublic };
