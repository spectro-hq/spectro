import { describe, expect, it, vi } from 'vitest';
import type { CLSMetricWithAttribution } from 'web-vitals/attribution';

import {
  createSafeTargetName,
  WebVitalsBridge,
  type WebVitalListener,
  type WebVitalRegistration,
} from '../src/web-vitals-bridge.js';

const metric: CLSMetricWithAttribution = {
  name: 'CLS',
  value: 0.05,
  rating: 'good',
  delta: 0.05,
  id: 'v6-cls-bridge',
  entries: [],
  navigationType: 'navigate',
  navigationId: 1,
  navigationURL: 'https://app.example/',
  attribution: { largestShiftValue: 0.05 },
};

describe('WebVitalsBridge', () => {
  it('registers once and only dispatches to current subscribers', () => {
    const callbacks: WebVitalListener[] = [];
    const registration: WebVitalRegistration = {
      register(listener, options) {
        callbacks.push(listener);
        expect(options.reportSoftNavs).toBe(true);
        expect(options.generateTarget).toBe(createSafeTargetName);
      },
      softNavigations: true,
    };
    const bridge = new WebVitalsBridge([registration]);
    const first = vi.fn<WebVitalListener>();
    const second = vi.fn<WebVitalListener>();

    const unsubscribeFirst = bridge.subscribe(first, vi.fn<(error: unknown) => void>());
    const unsubscribeSecond = bridge.subscribe(second, vi.fn<(error: unknown) => void>());
    expect(callbacks).toHaveLength(1);

    callbacks[0]?.(metric);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    unsubscribeFirst();
    callbacks[0]?.(metric);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribeSecond();
  });

  it('contains one registration failure and continues registering other metrics', () => {
    const report = vi.fn<(error: unknown) => void>();
    const successful = vi.fn<WebVitalRegistration['register']>();
    const bridge = new WebVitalsBridge([
      {
        register() {
          throw new Error('unsupported observer');
        },
        softNavigations: true,
      },
      { register: successful, softNavigations: false },
    ]);

    expect(() => bridge.subscribe(vi.fn<WebVitalListener>(), report)).not.toThrow();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'unsupported observer' }),
    );
    expect(successful).toHaveBeenCalledOnce();
    expect(successful.mock.calls[0]?.[1]).not.toHaveProperty('reportSoftNavs');
  });
});

describe('createSafeTargetName', () => {
  it('returns only explicit valid monitor IDs', () => {
    const monitored = { getAttribute: () => 'checkout-button' };
    const privateTarget = { getAttribute: () => 'email@example.com' };
    const hostile = {
      getAttribute() {
        throw new Error('DOM unavailable');
      },
    };

    expect(createSafeTargetName(monitored)).toBe('monitor:checkout-button');
    expect(createSafeTargetName(privateTarget)).toBe('element');
    expect(createSafeTargetName(hostile)).toBe('element');
    expect(createSafeTargetName(null)).toBe('element');
  });
});
