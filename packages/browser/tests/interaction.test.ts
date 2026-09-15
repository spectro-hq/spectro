import { describe, expect, it } from 'vitest';

import type { CaptureInput } from '@spectro/types';

import { BrowserInteractionCapture } from '../src/interaction.js';
import type {
  BrowserInteractionObservation,
  BrowserInteractionRuntime,
  BrowserInteractionSubscriptionOptions,
} from '../src/interaction-runtime.js';

class FakeInteractionRuntime implements BrowserInteractionRuntime {
  listener: ((observation: BrowserInteractionObservation) => void) | undefined;
  options: BrowserInteractionSubscriptionOptions | undefined;
  cleanups = 0;

  subscribe(
    listener: (observation: BrowserInteractionObservation) => void,
    _report: (error: unknown) => void,
    options: BrowserInteractionSubscriptionOptions,
  ): () => void {
    this.listener = listener;
    this.options = options;
    return () => {
      this.listener = undefined;
      this.cleanups += 1;
    };
  }

  emit(observation: BrowserInteractionObservation): void {
    this.listener?.(observation);
  }
}

function createHarness(options: ConstructorParameters<typeof BrowserInteractionCapture>[2] = {}) {
  const runtime = new FakeInteractionRuntime();
  const captured: CaptureInput<'interaction'>[] = [];
  const errors: unknown[] = [];
  let activities = 0;
  const plugin = new BrowserInteractionCapture(
    {
      activity: () => {
        activities += 1;
      },
      capture: (input) => {
        captured.push(input);
        return `event_${captured.length}`;
      },
      report: (error) => errors.push(error),
    },
    runtime,
    options,
  );
  return { captured, errors, plugin, runtime, activities: () => activities };
}

describe('BrowserInteractionCapture', () => {
  it('maps only bounded target metadata and omits coordinates by default', () => {
    const harness = createHarness();
    harness.plugin.start();
    harness.runtime.emit({
      kind: 'click',
      target: { monitorId: 'checkout_button', tag: 'BUTTON', role: 'button' },
      coordinates: { x: 42, y: 84 },
    });

    expect(harness.captured).toEqual([
      {
        type: 'interaction',
        name: 'element_click',
        payload: {
          target: { monitorId: 'checkout_button', tag: 'button', role: 'button' },
        },
      },
    ]);
    expect(harness.activities()).toBe(1);
  });

  it('supports submit opt-out and explicit coordinate capture', () => {
    const harness = createHarness({ captureFormSubmits: false, captureCoordinates: true });
    harness.plugin.start();
    expect(harness.runtime.options).toEqual({
      captureClicks: true,
      captureFormSubmits: false,
      captureCoordinates: true,
    });

    harness.runtime.emit({
      kind: 'submit',
      target: { monitorId: 'checkout_form', tag: 'form' },
    });
    harness.runtime.emit({
      kind: 'click',
      target: { monitorId: 'checkout_button' },
      coordinates: { x: 10, y: 20 },
    });

    expect(harness.captured).toEqual([
      {
        type: 'interaction',
        name: 'element_click',
        payload: {
          target: { monitorId: 'checkout_button' },
          coordinates: { x: 10, y: 20 },
        },
      },
    ]);
  });

  it('rejects invalid monitor IDs, tokens, and coordinates before capture', () => {
    const harness = createHarness({ captureCoordinates: true });
    harness.plugin.start();
    harness.runtime.emit({
      kind: 'click',
      target: { monitorId: 'private@example.com', tag: 'button' },
    });
    harness.runtime.emit({
      kind: 'click',
      target: { monitorId: 'safe', tag: 'private value', role: 'private value' },
      coordinates: { x: Number.NaN, y: 20 },
    });

    expect(harness.captured).toEqual([
      {
        type: 'interaction',
        name: 'element_click',
        payload: { target: { monitorId: 'safe' } },
      },
    ]);
    expect(harness.activities()).toBe(1);
  });

  it('starts once, cleans once, and reports host failures', () => {
    const runtime = new FakeInteractionRuntime();
    const errors: unknown[] = [];
    const failure = new Error('activity unavailable');
    const plugin = new BrowserInteractionCapture(
      {
        activity() {
          throw failure;
        },
        capture: () => undefined,
        report: (error) => errors.push(error),
      },
      runtime,
    );
    plugin.start();
    plugin.start();

    expect(() =>
      runtime.emit({ kind: 'click', target: { monitorId: 'safe_button' } }),
    ).not.toThrow();
    expect(errors).toEqual([failure]);
    plugin.stop();
    plugin.stop();
    expect(runtime.cleanups).toBe(1);
  });
});
