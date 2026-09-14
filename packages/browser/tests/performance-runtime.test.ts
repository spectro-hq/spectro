import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserPerformanceRuntime } from '../src/performance-runtime.js';
import type {
  LongTaskObservation,
  NavigationTimingObservation,
} from '../src/performance-runtime.js';

afterEach(() => vi.unstubAllGlobals());

describe('browser performance runtime', () => {
  it('adapts and disconnects native long-task observations', () => {
    let observerCallback: ((list: { getEntries(): PerformanceEntry[] }) => void) | undefined;
    const disconnect = vi.fn<() => void>();
    const observe = vi.fn<(options: PerformanceObserverInit) => void>();
    class FakePerformanceObserver {
      static supportedEntryTypes = ['longtask'];

      constructor(callback: (list: { getEntries(): PerformanceEntry[] }) => void) {
        observerCallback = callback;
      }

      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('window', { location: { href: 'https://app.example/orders?token=private' } });
    vi.stubGlobal('document', { readyState: 'loading' });
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
    const runtime = createBrowserPerformanceRuntime();
    const listener = vi.fn<(observation: LongTaskObservation) => void>();

    const cleanup = runtime?.subscribeToLongTasks(listener, vi.fn<(error: unknown) => void>());
    observerCallback?.({
      getEntries: () => [
        { name: 'self', entryType: 'longtask', startTime: 120, duration: 75, toJSON: () => ({}) },
      ],
    });

    expect(observe).toHaveBeenCalledWith({ type: 'longtask', buffered: true });
    expect(listener).toHaveBeenCalledWith({
      duration: 75,
      startTime: 120,
      navigationUrl: 'https://app.example/orders?token=private',
    });
    cleanup?.();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('reports a navigation summary after load and cancels scheduled work on cleanup', () => {
    const loadListeners = new Set<() => void>();
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const navigationEntry = {
      name: 'https://app.example/checkout?token=private',
      type: 'reload',
      duration: 1_500,
      redirectStart: 0,
      redirectEnd: 0,
      domainLookupStart: 10,
      domainLookupEnd: 20,
      connectStart: 20,
      connectEnd: 50,
      secureConnectionStart: 30,
      requestStart: 50,
      responseStart: 150,
      responseEnd: 350,
      domInteractive: 900,
      domContentLoadedEventEnd: 1_100,
      loadEventEnd: 1_500,
    };
    vi.stubGlobal('window', {
      addEventListener: (_type: string, listener: () => void) => loadListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => loadListeners.delete(listener),
      setTimeout(callback: () => void) {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id: number) => timers.delete(id),
    });
    vi.stubGlobal('document', { readyState: 'loading' });
    vi.stubGlobal('performance', { getEntriesByType: () => [navigationEntry] });
    const runtime = createBrowserPerformanceRuntime();
    const listener = vi.fn<(observation: NavigationTimingObservation) => void>();
    const cleanup = runtime?.subscribeToNavigationTiming(
      listener,
      vi.fn<(error: unknown) => void>(),
    );

    for (const loadListener of loadListeners) loadListener();
    for (const timer of timers.values()) timer();

    expect(listener).toHaveBeenCalledWith({
      navigationUrl: 'https://app.example/checkout?token=private',
      navigationType: 'reload',
      duration: 1_500,
      redirectDuration: 0,
      dnsDuration: 10,
      connectionDuration: 30,
      tlsDuration: 20,
      requestDuration: 100,
      responseDuration: 200,
      domInteractive: 900,
      domContentLoaded: 1_100,
      loadEvent: 1_500,
    });

    cleanup?.();
    expect(loadListeners.size).toBe(0);
    expect(timers.size).toBe(0);
  });
});
