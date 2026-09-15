import { findMonitoredTarget, type MonitoredTarget } from './monitor-target.js';

export type BrowserInteractionKind = 'click' | 'submit';

export interface BrowserInteractionObservation {
  kind: BrowserInteractionKind;
  target: MonitoredTarget;
  coordinates?: { x: number; y: number };
}

export interface BrowserInteractionSubscriptionOptions {
  captureClicks: boolean;
  captureFormSubmits: boolean;
  captureCoordinates: boolean;
}

export interface BrowserInteractionRuntime {
  subscribe(
    listener: (observation: BrowserInteractionObservation) => void,
    report: (error: unknown) => void,
    options: BrowserInteractionSubscriptionOptions,
  ): () => void;
}

function readFiniteNumber(event: object, key: string): number | undefined {
  try {
    const value: unknown = Reflect.get(event, key);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function clickCoordinates(event: Event): { x: number; y: number } | undefined {
  const x = readFiniteNumber(event, 'clientX');
  const y = readFiniteNumber(event, 'clientY');
  return x === undefined || y === undefined ? undefined : { x, y };
}

function reportSafely(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error);
  } catch {
    // A customer error hook must not escape into the host event.
  }
}

export function createBrowserInteractionRuntime(): BrowserInteractionRuntime | undefined {
  if (typeof document === 'undefined') return undefined;

  return {
    subscribe(listener, report, options) {
      const cleanups: Array<() => void> = [];
      const addListener = (type: BrowserInteractionKind): void => {
        const eventListener = (event: Event) => {
          try {
            const target = findMonitoredTarget(event);
            if (target === undefined) return;
            const coordinates =
              type === 'click' && options.captureCoordinates ? clickCoordinates(event) : undefined;
            listener({
              kind: type,
              target,
              ...(coordinates === undefined ? {} : { coordinates }),
            });
          } catch (error) {
            reportSafely(report, error);
          }
        };
        try {
          document.addEventListener(type, eventListener, true);
          cleanups.push(() => document.removeEventListener(type, eventListener, true));
        } catch (error) {
          reportSafely(report, error);
        }
      };

      if (options.captureClicks) addListener('click');
      if (options.captureFormSubmits) addListener('submit');

      return () => {
        for (let index = cleanups.length - 1; index >= 0; index -= 1) {
          const cleanup = cleanups[index];
          if (cleanup === undefined) continue;
          try {
            cleanup();
          } catch (error) {
            reportSafely(report, error);
          }
        }
        cleanups.length = 0;
      };
    },
  };
}
