import type { MetricWithAttribution } from 'web-vitals/attribution';

import type { JSONObject, PerformancePayload } from '@spectro/protocol';
import type { CaptureInput } from '@spectro/types';

import type {
  BrowserPerformanceRuntime,
  LongTaskObservation,
  NavigationTimingObservation,
} from './performance-runtime.js';

const MAX_ATTRIBUTION_STRING_LENGTH = 256;

const ATTRIBUTION_KEYS = {
  CLS: ['largestShiftTarget', 'largestShiftTime', 'largestShiftValue', 'loadState'],
  FCP: ['timeToFirstByte', 'firstByteToFCP', 'loadState'],
  INP: [
    'interactionTarget',
    'interactionTime',
    'interactionType',
    'nextPaintTime',
    'inputDelay',
    'processingDuration',
    'presentationDelay',
    'loadState',
    'totalScriptDuration',
    'totalStyleAndLayoutDuration',
    'totalPaintDuration',
    'totalUnattributedDuration',
  ],
  LCP: [
    'target',
    'timeToFirstByte',
    'resourceLoadDelay',
    'resourceLoadDuration',
    'elementRenderDelay',
  ],
  TTFB: [
    'waitingDuration',
    'cacheDuration',
    'dnsDuration',
    'connectionDuration',
    'requestDuration',
  ],
} as const;

export interface BrowserPerformanceOptions {
  captureWebVitals?: boolean;
  captureLongTasks?: boolean;
  captureNavigationTiming?: boolean;
}

export interface PerformanceCaptureHost {
  capture(input: CaptureInput<'performance'>, navigationUrl?: string): string | undefined;
  report(error: unknown): void;
}

function addSafeScalar(output: JSONObject, key: string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    output[key] = value;
  } else if (typeof value === 'string') {
    output[key] = value.slice(0, MAX_ATTRIBUTION_STRING_LENGTH);
  } else if (typeof value === 'boolean' || value === null) {
    output[key] = value;
  }
}

function readProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function webVitalAttribution(metric: MetricWithAttribution): JSONObject {
  const attribution: JSONObject = {};
  addSafeScalar(attribution, 'metricId', metric.id);
  addSafeScalar(attribution, 'delta', metric.delta);
  addSafeScalar(attribution, 'navigationId', metric.navigationId);
  addSafeScalar(attribution, 'navigationInteractionId', metric.navigationInteractionId);
  addSafeScalar(attribution, 'navigationStartTime', metric.navigationStartTime);
  for (const key of ATTRIBUTION_KEYS[metric.name]) {
    addSafeScalar(attribution, key, readProperty(metric.attribution, key));
  }
  return attribution;
}

function protocolMetric(name: MetricWithAttribution['name']): PerformancePayload['metric'] {
  switch (name) {
    case 'CLS':
      return 'cls';
    case 'FCP':
      return 'fcp';
    case 'INP':
      return 'inp';
    case 'LCP':
      return 'lcp';
    case 'TTFB':
      return 'ttfb';
  }
}

function protocolRating(
  rating: MetricWithAttribution['rating'],
): NonNullable<PerformancePayload['rating']> {
  return rating === 'needs-improvement' ? 'needs_improvement' : rating;
}

function webVitalInput(metric: MetricWithAttribution): CaptureInput<'performance'> | undefined {
  if (!Number.isFinite(metric.value) || metric.value < 0) return undefined;
  const name = protocolMetric(metric.name);
  return {
    type: 'performance',
    name: `web_vital_${name}`,
    payload: {
      metric: name,
      value: metric.value,
      unit: name === 'cls' ? 'score' : 'ms',
      rating: protocolRating(metric.rating),
      navigationType: metric.navigationType.slice(0, 64),
      attribution: webVitalAttribution(metric),
    },
  };
}

function navigationAttribution(observation: NavigationTimingObservation): JSONObject {
  const attribution: JSONObject = {};
  const fields: Array<keyof NavigationTimingObservation> = [
    'redirectDuration',
    'dnsDuration',
    'connectionDuration',
    'tlsDuration',
    'requestDuration',
    'responseDuration',
    'domInteractive',
    'domContentLoaded',
    'loadEvent',
  ];
  for (const field of fields) addSafeScalar(attribution, field, observation[field]);
  return attribution;
}

export class BrowserPerformanceCapture {
  readonly #host: PerformanceCaptureHost;
  readonly #runtime: BrowserPerformanceRuntime | undefined;
  readonly #options: BrowserPerformanceOptions;
  readonly #cleanups: Array<() => void> = [];
  #started = false;

  constructor(
    host: PerformanceCaptureHost,
    runtime: BrowserPerformanceRuntime | undefined,
    options: BrowserPerformanceOptions = {},
  ) {
    this.#host = host;
    this.#runtime = runtime;
    this.#options = options;
  }

  start(): void {
    if (this.#started || this.#runtime === undefined) return;
    this.#started = true;
    try {
      if (this.#options.captureWebVitals !== false) {
        this.#cleanups.push(
          this.#runtime.subscribeToWebVitals(
            (metric) => this.#runSafely(() => this.#captureWebVital(metric)),
            (error) => this.#report(error),
          ),
        );
      }
      if (this.#options.captureLongTasks !== false) {
        this.#cleanups.push(
          this.#runtime.subscribeToLongTasks(
            (observation) => this.#runSafely(() => this.#captureLongTask(observation)),
            (error) => this.#report(error),
          ),
        );
      }
      if (this.#options.captureNavigationTiming !== false) {
        this.#cleanups.push(
          this.#runtime.subscribeToNavigationTiming(
            (observation) => this.#runSafely(() => this.#captureNavigation(observation)),
            (error) => this.#report(error),
          ),
        );
      }
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    for (let index = this.#cleanups.length - 1; index >= 0; index -= 1) {
      const cleanup = this.#cleanups[index];
      if (cleanup === undefined) continue;
      this.#runSafely(cleanup);
    }
    this.#cleanups.length = 0;
    this.#started = false;
  }

  #captureWebVital(metric: MetricWithAttribution): void {
    const input = webVitalInput(metric);
    if (input !== undefined) this.#host.capture(input, metric.navigationURL);
  }

  #captureLongTask(observation: LongTaskObservation): void {
    if (!Number.isFinite(observation.duration) || observation.duration < 0) return;
    const attribution: JSONObject = {};
    addSafeScalar(attribution, 'startTime', observation.startTime);
    this.#host.capture(
      {
        type: 'performance',
        name: 'long_task',
        payload: {
          metric: 'long_task',
          value: observation.duration,
          unit: 'ms',
          attribution,
        },
      },
      observation.navigationUrl,
    );
  }

  #captureNavigation(observation: NavigationTimingObservation): void {
    if (!Number.isFinite(observation.duration) || observation.duration < 0) return;
    this.#host.capture(
      {
        type: 'performance',
        name: 'navigation_timing',
        payload: {
          metric: 'navigation',
          value: observation.duration,
          unit: 'ms',
          navigationType: observation.navigationType.slice(0, 64),
          attribution: navigationAttribution(observation),
        },
      },
      observation.navigationUrl,
    );
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
