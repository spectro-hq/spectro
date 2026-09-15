import type { CaptureInput } from '@spectro/types';

import type {
  BrowserInteractionObservation,
  BrowserInteractionRuntime,
} from './interaction-runtime.js';
import { sanitizeMonitorId, sanitizeTargetToken } from './monitor-target.js';

export interface BrowserInteractionOptions {
  captureClicks?: boolean;
  captureFormSubmits?: boolean;
  captureCoordinates?: boolean;
}

export interface InteractionCaptureHost {
  activity(): void;
  capture(input: CaptureInput<'interaction'>): string | undefined;
  report(error: unknown): void;
}

function finiteCoordinates(
  coordinates: BrowserInteractionObservation['coordinates'],
): { x: number; y: number } | undefined {
  if (
    coordinates === undefined ||
    !Number.isFinite(coordinates.x) ||
    !Number.isFinite(coordinates.y)
  ) {
    return undefined;
  }
  return { x: coordinates.x, y: coordinates.y };
}

export class BrowserInteractionCapture {
  readonly #host: InteractionCaptureHost;
  readonly #runtime: BrowserInteractionRuntime | undefined;
  readonly #options: BrowserInteractionOptions;
  #cleanup: (() => void) | undefined;

  constructor(
    host: InteractionCaptureHost,
    runtime: BrowserInteractionRuntime | undefined,
    options: BrowserInteractionOptions = {},
  ) {
    this.#host = host;
    this.#runtime = runtime;
    this.#options = options;
  }

  start(): void {
    if (this.#cleanup !== undefined || this.#runtime === undefined) return;
    this.#cleanup = this.#runtime.subscribe(
      (observation) => this.#runSafely(() => this.#capture(observation)),
      (error) => this.#report(error),
      {
        captureClicks: this.#options.captureClicks !== false,
        captureFormSubmits: this.#options.captureFormSubmits !== false,
        captureCoordinates: this.#options.captureCoordinates === true,
      },
    );
  }

  stop(): void {
    const cleanup = this.#cleanup;
    this.#cleanup = undefined;
    if (cleanup !== undefined) this.#runSafely(cleanup);
  }

  #capture(observation: BrowserInteractionObservation): void {
    const monitorId = sanitizeMonitorId(observation.target.monitorId);
    if (monitorId === undefined || !this.#isEnabled(observation.kind)) return;
    const tag = sanitizeTargetToken(observation.target.tag);
    const role = sanitizeTargetToken(observation.target.role);
    const coordinates =
      this.#options.captureCoordinates === true
        ? finiteCoordinates(observation.coordinates)
        : undefined;
    this.#host.activity();
    this.#host.capture({
      type: 'interaction',
      name: observation.kind === 'click' ? 'element_click' : 'form_submit',
      payload: {
        target: {
          monitorId,
          ...(tag === undefined ? {} : { tag }),
          ...(role === undefined ? {} : { role }),
        },
        ...(coordinates === undefined ? {} : { coordinates }),
      },
    });
  }

  #isEnabled(kind: BrowserInteractionObservation['kind']): boolean {
    return kind === 'click'
      ? this.#options.captureClicks !== false
      : this.#options.captureFormSubmits !== false;
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
