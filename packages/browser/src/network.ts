import type { NetworkPayload } from '@spectro/protocol';
import type { CaptureInput } from '@spectro/types';

import { sanitizePageUrl } from './lifecycle.js';
import type { BrowserNetworkObservation, BrowserNetworkRuntime } from './network-runtime.js';
import { sanitizeNetworkMethod, sanitizeNetworkUrl } from './network-url.js';

export interface BrowserNetworkOptions {
  captureFetch?: boolean;
  captureXhr?: boolean;
  captureResourceTiming?: boolean;
}

export interface NetworkCaptureHost {
  capture(input: CaptureInput<'network'>, navigationUrl?: string): string | undefined;
  report(error: unknown): void;
}

function normalizedTiming(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizedStatus(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= 599
    ? value
    : undefined;
}

function eventName(initiator: NetworkPayload['initiator']): string {
  if (initiator === 'fetch') return 'fetch_request';
  if (initiator === 'xhr') return 'xhr_request';
  return 'resource_request';
}

export class BrowserNetworkCapture {
  readonly #host: NetworkCaptureHost;
  readonly #runtime: BrowserNetworkRuntime | undefined;
  readonly #options: BrowserNetworkOptions;
  readonly #ingestionEndpoint: string;
  #cleanup: (() => void) | undefined;

  constructor(
    host: NetworkCaptureHost,
    runtime: BrowserNetworkRuntime | undefined,
    endpoint: string,
    options: BrowserNetworkOptions = {},
  ) {
    this.#host = host;
    this.#runtime = runtime;
    this.#options = options;
    this.#ingestionEndpoint = `${endpoint.replace(/\/$/u, '')}/v1/envelope`;
  }

  start(): void {
    if (this.#cleanup !== undefined || this.#runtime === undefined) return;
    this.#cleanup = this.#runtime.subscribe(
      (observation) => this.#runSafely(() => this.#capture(observation)),
      (error) => this.#report(error),
      {
        captureFetch: this.#options.captureFetch !== false,
        captureXhr: this.#options.captureXhr !== false,
        captureResourceTiming: this.#options.captureResourceTiming === true,
      },
    );
  }

  stop(): void {
    const cleanup = this.#cleanup;
    this.#cleanup = undefined;
    if (cleanup !== undefined) this.#runSafely(cleanup);
  }

  #capture(observation: BrowserNetworkObservation): void {
    if (!this.#isEnabled(observation.initiator)) return;
    const navigationUrl =
      observation.navigationUrl === undefined
        ? undefined
        : sanitizePageUrl(observation.navigationUrl)?.url;
    const url = sanitizeNetworkUrl(observation.requestUrl, navigationUrl);
    const ingestionUrl = sanitizeNetworkUrl(this.#ingestionEndpoint, navigationUrl);
    if (url === undefined || url === ingestionUrl) return;
    const method = sanitizeNetworkMethod(observation.method);
    const start = normalizedTiming(observation.start);
    const duration = normalizedTiming(observation.duration);
    if (method === undefined || start === undefined || duration === undefined) return;
    const status = normalizedStatus(observation.status);

    this.#host.capture(
      {
        type: 'network',
        name: eventName(observation.initiator),
        payload: {
          request: { method, url },
          ...(status === undefined ? {} : { response: { status } }),
          timing: { start, duration },
          initiator: observation.initiator,
          success: observation.success,
        },
      },
      navigationUrl,
    );
  }

  #isEnabled(initiator: NetworkPayload['initiator']): boolean {
    if (initiator === 'fetch') return this.#options.captureFetch !== false;
    if (initiator === 'xhr') return this.#options.captureXhr !== false;
    return this.#options.captureResourceTiming === true;
  }

  #runSafely(operation: () => void): void {
    try {
      operation();
    } catch (error) {
      this.#report(error);
    }
  }

  #report(error: unknown): void {
    try {
      this.#host.report(error);
    } catch {
      // Error reporting must not escape into the customer page.
    }
  }
}
