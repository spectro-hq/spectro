import { describe, expect, it } from 'vitest';

import type { CaptureInput } from '@spectro/types';

import { BrowserErrorCapture } from '../src/error.js';
import type { BrowserErrorObservation, BrowserErrorRuntime } from '../src/error-runtime.js';

class FakeErrorRuntime implements BrowserErrorRuntime {
  readonly listeners = new Set<(observation: BrowserErrorObservation) => void>();

  subscribe(listener: (observation: BrowserErrorObservation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(observation: BrowserErrorObservation): void {
    for (const listener of this.listeners) listener(observation);
  }
}

function createHarness(runtime = new FakeErrorRuntime()) {
  const captured: CaptureInput<'error'>[] = [];
  const reported: Error[] = [];
  let activityCount = 0;
  const plugin = new BrowserErrorCapture(
    {
      activity() {
        activityCount += 1;
      },
      capture(input) {
        captured.push(input);
        return `event_${captured.length}`;
      },
      report(error) {
        reported.push(error instanceof Error ? error : new Error(String(error)));
      },
    },
    runtime,
  );
  return { captured, plugin, reported, runtime, activityCount: () => activityCount };
}

describe('BrowserErrorCapture', () => {
  it('normalizes runtime errors into bounded structured frames with safe URLs', () => {
    const harness = createHarness();
    harness.plugin.start();

    harness.runtime.emit({
      mechanism: 'runtime',
      value: {
        name: 'CheckoutError',
        message: 'Checkout failed',
        stack: [
          'CheckoutError: Checkout failed',
          '    at submitOrder (https://user:password@app.example/assets/app.js?token=private:12:34)',
          'load@https://cdn.example/chunk.js#secret:5:6',
          'unsupported native frame',
        ].join('\n'),
      },
      source: {
        url: 'https://user:password@app.example/assets/app.js?token=private#secret',
        line: 12,
        column: 34,
      },
    });

    expect(harness.captured).toEqual([
      {
        type: 'error',
        name: 'runtime_error',
        payload: {
          mechanism: 'runtime',
          name: 'CheckoutError',
          message: 'Checkout failed',
          stack: [
            {
              filename: 'https://app.example/assets/app.js',
              function: 'submitOrder',
              line: 12,
              column: 34,
            },
            {
              filename: 'https://cdn.example/chunk.js',
              function: 'load',
              line: 5,
              column: 6,
            },
          ],
          handled: false,
          source: { url: 'https://app.example/assets/app.js', line: 12, column: 34 },
        },
      },
    ]);
    expect(JSON.stringify(harness.captured)).not.toMatch(/password|private|secret/u);
    expect(harness.activityCount()).toBe(1);
  });

  it('uses safe stable fallbacks for opaque rejection reasons', () => {
    const harness = createHarness();
    const opaqueReason = Object.create(null);
    Object.defineProperty(opaqueReason, 'message', {
      get() {
        throw new Error('getter should stay contained');
      },
    });
    harness.plugin.start();

    expect(() => harness.runtime.emit({ mechanism: 'promise', value: opaqueReason })).not.toThrow();

    expect(harness.captured[0]).toEqual({
      type: 'error',
      name: 'unhandled_rejection',
      payload: {
        mechanism: 'promise',
        message: 'Unhandled promise rejection',
        handled: false,
      },
    });
    expect(harness.reported).toEqual([]);
  });

  it('captures only a safe resource tag and sanitized source URL', () => {
    const harness = createHarness();
    harness.plugin.start();

    harness.runtime.emit({
      mechanism: 'resource',
      tagName: 'SCRIPT<script>',
      url: 'https://user:password@cdn.example/app.js?authorization=private#secret',
    });

    expect(harness.captured[0]).toEqual({
      type: 'error',
      name: 'resource_error',
      payload: {
        mechanism: 'resource',
        name: 'ResourceLoadError',
        message: 'Failed to load resource',
        handled: false,
        source: { url: 'https://cdn.example/app.js' },
      },
    });
  });

  it('supports manual capture with bounded fingerprint hints', () => {
    const harness = createHarness();

    const eventId = harness.plugin.captureException(new Error('Manual failure'), {
      handled: false,
      fingerprint: ['x'.repeat(300), ...Array.from({ length: 11 }, (_, index) => `part-${index}`)],
    });

    expect(eventId).toBe('event_1');
    expect(harness.captured[0]).toMatchObject({
      type: 'error',
      name: 'manual_error',
      payload: {
        mechanism: 'manual',
        message: 'Manual failure',
        handled: false,
      },
    });
    expect(harness.captured[0]?.payload.fingerprint).toHaveLength(10);
    expect(harness.captured[0]?.payload.fingerprint?.[0]).toHaveLength(256);
    expect(harness.activityCount()).toBe(1);
  });

  it('contains host capture and reporting failures', () => {
    const runtime = new FakeErrorRuntime();
    const plugin = new BrowserErrorCapture(
      {
        activity() {},
        capture() {
          throw new Error('capture failed');
        },
        report() {
          throw new Error('reporting failed');
        },
      },
      runtime,
    );
    plugin.start();

    expect(() => runtime.emit({ mechanism: 'runtime', value: new Error('failure') })).not.toThrow();
    expect(() => plugin.captureException(new Error('failure'))).not.toThrow();
  });

  it('honors automatic capture options and detaches cleanly', () => {
    const runtime = new FakeErrorRuntime();
    const captured: CaptureInput<'error'>[] = [];
    const plugin = new BrowserErrorCapture(
      {
        activity() {},
        capture(input) {
          captured.push(input);
          return undefined;
        },
        report() {},
      },
      runtime,
      {
        captureRuntimeErrors: false,
        captureUnhandledRejections: false,
        captureResourceErrors: true,
      },
    );
    plugin.start();

    runtime.emit({ mechanism: 'runtime', value: new Error('ignored') });
    runtime.emit({ mechanism: 'promise', value: 'ignored' });
    runtime.emit({ mechanism: 'resource', tagName: 'img' });
    expect(captured.map((event) => event.name)).toEqual(['resource_error']);

    plugin.stop();
    expect(runtime.listeners.size).toBe(0);
    runtime.emit({ mechanism: 'resource', tagName: 'script' });
    expect(captured).toHaveLength(1);
  });
});
