import { describe, expect, it } from 'vitest';
import type {
  CLSMetricWithAttribution,
  LCPMetricWithAttribution,
  MetricWithAttribution,
} from 'web-vitals/attribution';

import type { CaptureInput } from '@spectro/types';

import { BrowserPerformanceCapture } from '../src/performance.js';
import type {
  BrowserPerformanceRuntime,
  LongTaskObservation,
  NavigationTimingObservation,
} from '../src/performance-runtime.js';

class FakePerformanceRuntime implements BrowserPerformanceRuntime {
  webVitalsListener: ((metric: MetricWithAttribution) => void) | undefined;
  longTaskListener: ((observation: LongTaskObservation) => void) | undefined;
  navigationListener: ((observation: NavigationTimingObservation) => void) | undefined;
  subscriptions = { webVitals: 0, longTasks: 0, navigation: 0 };
  cleanups = 0;

  subscribeToWebVitals(listener: (metric: MetricWithAttribution) => void): () => void {
    this.subscriptions.webVitals += 1;
    this.webVitalsListener = listener;
    return () => {
      this.webVitalsListener = undefined;
      this.cleanups += 1;
    };
  }

  subscribeToLongTasks(listener: (observation: LongTaskObservation) => void): () => void {
    this.subscriptions.longTasks += 1;
    this.longTaskListener = listener;
    return () => {
      this.longTaskListener = undefined;
      this.cleanups += 1;
    };
  }

  subscribeToNavigationTiming(
    listener: (observation: NavigationTimingObservation) => void,
  ): () => void {
    this.subscriptions.navigation += 1;
    this.navigationListener = listener;
    return () => {
      this.navigationListener = undefined;
      this.cleanups += 1;
    };
  }
}

function lcpMetric(): LCPMetricWithAttribution {
  return {
    name: 'LCP',
    value: 2_500,
    rating: 'needs-improvement',
    delta: 2_500,
    id: 'v6-lcp-1',
    entries: [],
    navigationType: 'navigate',
    navigationId: 1,
    navigationStartTime: 0,
    navigationURL: 'https://app.example/checkout?token=private',
    attribution: {
      target: 'monitor:hero',
      url: 'https://cdn.example/hero.jpg?token=private',
      timeToFirstByte: 100,
      resourceLoadDelay: 50,
      resourceLoadDuration: 700,
      elementRenderDelay: 1_650,
    },
  };
}

function createHarness(runtime = new FakePerformanceRuntime()) {
  const captured: Array<{
    input: CaptureInput<'performance'>;
    navigationUrl?: string;
  }> = [];
  const errors: Error[] = [];
  const plugin = new BrowserPerformanceCapture(
    {
      capture(input, navigationUrl) {
        captured.push({ input, ...(navigationUrl === undefined ? {} : { navigationUrl }) });
        return `event_${captured.length}`;
      },
      report(error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      },
    },
    runtime,
  );
  return { captured, errors, plugin, runtime };
}

describe('BrowserPerformanceCapture', () => {
  it('maps Web Vitals and keeps only allowlisted primitive attribution', () => {
    const harness = createHarness();
    harness.plugin.start();
    harness.runtime.webVitalsListener?.(lcpMetric());

    expect(harness.captured).toEqual([
      {
        navigationUrl: 'https://app.example/checkout?token=private',
        input: {
          type: 'performance',
          name: 'web_vital_lcp',
          payload: {
            metric: 'lcp',
            value: 2_500,
            unit: 'ms',
            rating: 'needs_improvement',
            navigationType: 'navigate',
            attribution: {
              metricId: 'v6-lcp-1',
              delta: 2_500,
              navigationId: 1,
              navigationStartTime: 0,
              target: 'monitor:hero',
              timeToFirstByte: 100,
              resourceLoadDelay: 50,
              resourceLoadDuration: 700,
              elementRenderDelay: 1_650,
            },
          },
        },
      },
    ]);
    expect(JSON.stringify(harness.captured[0]?.input)).not.toContain('hero.jpg');
    expect(JSON.stringify(harness.captured[0]?.input)).not.toContain('token=private');
  });

  it('uses score units for CLS', () => {
    const harness = createHarness();
    harness.plugin.start();
    const metric: CLSMetricWithAttribution = {
      name: 'CLS',
      value: 0.12,
      rating: 'poor',
      delta: 0.12,
      id: 'v6-cls-1',
      entries: [],
      navigationType: 'soft-navigation',
      navigationId: 2,
      navigationURL: 'https://app.example/orders',
      attribution: {
        largestShiftTarget: 'element',
        largestShiftTime: 800,
        largestShiftValue: 0.12,
        loadState: 'complete',
      },
    };

    harness.runtime.webVitalsListener?.(metric);

    expect(harness.captured[0]).toMatchObject({
      navigationUrl: 'https://app.example/orders',
      input: {
        name: 'web_vital_cls',
        payload: { metric: 'cls', value: 0.12, unit: 'score', rating: 'poor' },
      },
    });
  });

  it('captures bounded native long-task and navigation summaries', () => {
    const harness = createHarness();
    harness.plugin.start();

    harness.runtime.longTaskListener?.({
      duration: 75,
      startTime: 420,
      navigationUrl: 'https://app.example/checkout',
    });
    harness.runtime.navigationListener?.({
      navigationUrl: 'https://app.example/checkout',
      navigationType: 'reload',
      duration: 1_500,
      redirectDuration: 0,
      dnsDuration: 10,
      connectionDuration: 20,
      tlsDuration: 15,
      requestDuration: 100,
      responseDuration: 200,
      domInteractive: 900,
      domContentLoaded: 1_100,
      loadEvent: 1_500,
    });

    expect(harness.captured).toMatchObject([
      {
        input: {
          name: 'long_task',
          payload: {
            metric: 'long_task',
            value: 75,
            unit: 'ms',
            attribution: { startTime: 420 },
          },
        },
      },
      {
        input: {
          name: 'navigation_timing',
          payload: {
            metric: 'navigation',
            value: 1_500,
            unit: 'ms',
            navigationType: 'reload',
            attribution: { dnsDuration: 10, loadEvent: 1_500 },
          },
        },
      },
    ]);
  });

  it('supports category opt-outs and cleans subscriptions', () => {
    const runtime = new FakePerformanceRuntime();
    const plugin = new BrowserPerformanceCapture(
      { capture: () => undefined, report: () => {} },
      runtime,
      { captureWebVitals: false, captureLongTasks: true, captureNavigationTiming: false },
    );

    plugin.start();
    expect(runtime.subscriptions).toEqual({ webVitals: 0, longTasks: 1, navigation: 0 });
    plugin.stop();
    expect(runtime.cleanups).toBe(1);
  });
});
