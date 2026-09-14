import type { MetricWithAttribution } from 'web-vitals/attribution';

import { subscribeToWebVitals } from './web-vitals-bridge.js';

export interface LongTaskObservation {
  duration: number;
  startTime: number;
  navigationUrl: string;
}

export interface NavigationTimingObservation {
  navigationUrl: string;
  navigationType: string;
  duration: number;
  redirectDuration: number;
  dnsDuration: number;
  connectionDuration: number;
  tlsDuration: number;
  requestDuration: number;
  responseDuration: number;
  domInteractive: number;
  domContentLoaded: number;
  loadEvent: number;
}

export interface BrowserPerformanceRuntime {
  subscribeToWebVitals(
    listener: (metric: MetricWithAttribution) => void,
    report: (error: unknown) => void,
  ): () => void;
  subscribeToLongTasks(
    listener: (observation: LongTaskObservation) => void,
    report: (error: unknown) => void,
  ): () => void;
  subscribeToNavigationTiming(
    listener: (observation: NavigationTimingObservation) => void,
    report: (error: unknown) => void,
  ): () => void;
}

function duration(start: number, end: number): number {
  return Math.max(0, end - start);
}

function navigationObservation(entry: PerformanceNavigationTiming): NavigationTimingObservation {
  return {
    navigationUrl: entry.name,
    navigationType: entry.type,
    duration: Math.max(0, entry.duration),
    redirectDuration: duration(entry.redirectStart, entry.redirectEnd),
    dnsDuration: duration(entry.domainLookupStart, entry.domainLookupEnd),
    connectionDuration: duration(entry.connectStart, entry.connectEnd),
    tlsDuration:
      entry.secureConnectionStart > 0 ? duration(entry.secureConnectionStart, entry.connectEnd) : 0,
    requestDuration: duration(entry.requestStart, entry.responseStart),
    responseDuration: duration(entry.responseStart, entry.responseEnd),
    domInteractive: Math.max(0, entry.domInteractive),
    domContentLoaded: Math.max(0, entry.domContentLoadedEventEnd),
    loadEvent: Math.max(0, entry.loadEventEnd),
  };
}

export function createBrowserPerformanceRuntime(): BrowserPerformanceRuntime | undefined {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof performance === 'undefined'
  ) {
    return undefined;
  }

  return {
    subscribeToWebVitals,
    subscribeToLongTasks(listener, report) {
      if (
        typeof PerformanceObserver === 'undefined' ||
        !PerformanceObserver.supportedEntryTypes?.includes('longtask')
      ) {
        return () => {};
      }

      const observer = new PerformanceObserver((list) => {
        try {
          for (const entry of list.getEntries()) {
            listener({
              duration: entry.duration,
              startTime: entry.startTime,
              navigationUrl: window.location.href,
            });
          }
        } catch (error) {
          report(error);
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      return () => observer.disconnect();
    },
    subscribeToNavigationTiming(listener, report) {
      let active = true;
      let timer: number | undefined;
      const emit = () => {
        if (!active) return;
        try {
          const entry = performance.getEntriesByType('navigation')[0];
          if (entry !== undefined) listener(navigationObservation(entry));
        } catch (error) {
          report(error);
        }
      };
      const schedule = () => {
        timer = window.setTimeout(emit, 0);
      };

      if (document.readyState === 'complete') {
        schedule();
      } else {
        window.addEventListener('load', schedule, { once: true });
      }

      return () => {
        active = false;
        window.removeEventListener('load', schedule);
        if (timer !== undefined) window.clearTimeout(timer);
      };
    },
  };
}
