import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type AttributionReportOpts,
  type MetricWithAttribution,
} from 'web-vitals/attribution';

export type WebVitalListener = (metric: MetricWithAttribution) => void;
export type WebVitalErrorListener = (error: unknown) => void;

export interface WebVitalRegistration {
  register(listener: WebVitalListener, options: AttributionReportOpts): void;
  softNavigations: boolean;
}

const MONITOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;

export function createSafeTargetName(node: unknown): string {
  if (typeof node !== 'object' || node === null) return 'element';
  try {
    const getAttribute: unknown = Reflect.get(node, 'getAttribute');
    if (typeof getAttribute !== 'function') return 'element';
    const monitorId: unknown = Reflect.apply(getAttribute, node, ['data-spectro-monitor-id']);
    return typeof monitorId === 'string' && MONITOR_ID_PATTERN.test(monitorId)
      ? `monitor:${monitorId}`
      : 'element';
  } catch {
    return 'element';
  }
}

const DEFAULT_REGISTRATIONS: WebVitalRegistration[] = [
  {
    register: (listener, options) => onCLS((metric) => listener(metric), options),
    softNavigations: true,
  },
  {
    register: (listener, options) => onFCP((metric) => listener(metric), options),
    softNavigations: true,
  },
  {
    register: (listener, options) => onINP((metric) => listener(metric), options),
    softNavigations: true,
  },
  {
    register: (listener, options) => onLCP((metric) => listener(metric), options),
    softNavigations: true,
  },
  {
    register: (listener, options) => onTTFB((metric) => listener(metric), options),
    softNavigations: false,
  },
];

interface Subscriber {
  listener: WebVitalListener;
  report: WebVitalErrorListener;
}

export class WebVitalsBridge {
  readonly #registrations: WebVitalRegistration[];
  readonly #subscribers = new Set<Subscriber>();
  #started = false;

  constructor(registrations: WebVitalRegistration[] = DEFAULT_REGISTRATIONS) {
    this.#registrations = registrations;
  }

  subscribe(listener: WebVitalListener, report: WebVitalErrorListener): () => void {
    const subscriber = { listener, report };
    this.#subscribers.add(subscriber);
    this.#start();
    return () => this.#subscribers.delete(subscriber);
  }

  #start(): void {
    if (this.#started) return;
    this.#started = true;
    for (const registration of this.#registrations) {
      try {
        registration.register((metric) => this.#dispatch(metric), {
          generateTarget: createSafeTargetName,
          ...(registration.softNavigations ? { reportSoftNavs: true } : {}),
        });
      } catch (error) {
        this.#report(error);
      }
    }
  }

  #dispatch(metric: MetricWithAttribution): void {
    for (const subscriber of this.#subscribers) {
      try {
        subscriber.listener(metric);
      } catch (error) {
        try {
          subscriber.report(error);
        } catch {
          // Subscriber reporting must not affect other SDK instances.
        }
      }
    }
  }

  #report(error: unknown): void {
    for (const subscriber of this.#subscribers) {
      try {
        subscriber.report(error);
      } catch {
        // Subscriber reporting must not affect registration of other metrics.
      }
    }
  }
}

const bridge = new WebVitalsBridge();

export function subscribeToWebVitals(
  listener: WebVitalListener,
  report: WebVitalErrorListener,
): () => void {
  return bridge.subscribe(listener, report);
}
