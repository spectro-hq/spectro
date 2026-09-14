import { describe, expect, it } from 'vitest';

import type { CaptureInput } from '@spectro/types';

import { BrowserNetworkCapture } from '../src/network.js';
import type {
  BrowserNetworkObservation,
  BrowserNetworkRuntime,
  BrowserNetworkSubscriptionOptions,
} from '../src/network-runtime.js';

class FakeNetworkRuntime implements BrowserNetworkRuntime {
  listener: ((observation: BrowserNetworkObservation) => void) | undefined;
  options: BrowserNetworkSubscriptionOptions | undefined;
  subscriptions = 0;
  cleanups = 0;

  subscribe(
    listener: (observation: BrowserNetworkObservation) => void,
    _report: (error: unknown) => void,
    options: BrowserNetworkSubscriptionOptions,
  ): () => void {
    this.listener = listener;
    this.options = options;
    this.subscriptions += 1;
    return () => {
      this.listener = undefined;
      this.cleanups += 1;
    };
  }

  emit(value: BrowserNetworkObservation): void {
    this.listener?.(value);
  }
}

function observation(
  overrides: Partial<BrowserNetworkObservation> = {},
): BrowserNetworkObservation {
  return {
    requestUrl: 'https://user:password@api.example/orders?token=private#secret',
    navigationUrl: 'https://app.example/checkout?cart=private',
    method: 'post',
    start: 12.5,
    duration: 87.25,
    initiator: 'fetch',
    status: 503,
    success: false,
    ...overrides,
  };
}

function createHarness(
  options: ConstructorParameters<typeof BrowserNetworkCapture>[3] = {},
  endpoint = 'https://ingest.spectro.dev/',
) {
  const runtime = new FakeNetworkRuntime();
  const captured: Array<{
    input: CaptureInput<'network'>;
    navigationUrl?: string;
  }> = [];
  const errors: unknown[] = [];
  const plugin = new BrowserNetworkCapture(
    {
      capture(input, navigationUrl) {
        captured.push({ input, ...(navigationUrl === undefined ? {} : { navigationUrl }) });
        return `event_${captured.length}`;
      },
      report: (error) => errors.push(error),
    },
    runtime,
    endpoint,
    options,
  );
  return { captured, errors, plugin, runtime };
}

describe('BrowserNetworkCapture', () => {
  it('maps a request without credentials, query, fragment, headers, or bodies', () => {
    const harness = createHarness();
    harness.plugin.start();
    harness.runtime.emit(observation());

    expect(harness.captured).toEqual([
      {
        navigationUrl: 'https://app.example/checkout',
        input: {
          type: 'network',
          name: 'fetch_request',
          payload: {
            request: { method: 'POST', url: 'https://api.example/orders' },
            response: { status: 503 },
            timing: { start: 12.5, duration: 87.25 },
            initiator: 'fetch',
            success: false,
          },
        },
      },
    ]);
    const serialized = JSON.stringify(harness.captured);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('private');
  });

  it('excludes the Spectro ingestion URL and malformed observations', () => {
    const harness = createHarness();
    harness.plugin.start();
    harness.runtime.emit(
      observation({ requestUrl: 'https://ingest.spectro.dev/v1/envelope?attempt=2' }),
    );
    harness.runtime.emit(observation({ method: 'NOT VALID' }));
    harness.runtime.emit(observation({ duration: Number.NaN }));
    harness.runtime.emit(observation({ requestUrl: 'data:text/plain,secret' }));

    expect(harness.captured).toEqual([]);
  });

  it('excludes a same-origin relative ingestion endpoint', () => {
    const harness = createHarness({}, '/telemetry');
    harness.plugin.start();
    harness.runtime.emit(
      observation({ requestUrl: 'https://app.example/telemetry/v1/envelope?attempt=2' }),
    );

    expect(harness.captured).toEqual([]);
  });

  it('supports initiator opt-outs and keeps Resource Timing opt-in', () => {
    const harness = createHarness({ captureFetch: false, captureResourceTiming: true });
    harness.plugin.start();
    expect(harness.runtime.options).toEqual({
      captureFetch: false,
      captureXhr: true,
      captureResourceTiming: true,
    });

    harness.runtime.emit(observation({ initiator: 'fetch' }));
    harness.runtime.emit(observation({ initiator: 'xhr', status: 204, success: true }));
    const resource = observation({ initiator: 'resource', method: 'GET', success: true });
    delete resource.status;
    harness.runtime.emit(resource);

    expect(harness.captured.map(({ input }) => input.name)).toEqual([
      'xhr_request',
      'resource_request',
    ]);
    expect(harness.captured[1]?.input.payload).not.toHaveProperty('response');
  });

  it('starts once and cleans the runtime subscription', () => {
    const harness = createHarness();
    harness.plugin.start();
    harness.plugin.start();
    expect(harness.runtime.subscriptions).toBe(1);

    harness.plugin.stop();
    harness.plugin.stop();
    expect(harness.runtime.cleanups).toBe(1);
  });

  it('contains capture failures and reports them through the host', () => {
    const runtime = new FakeNetworkRuntime();
    const errors: unknown[] = [];
    const failure = new Error('capture unavailable');
    const plugin = new BrowserNetworkCapture(
      {
        capture() {
          throw failure;
        },
        report: (error) => errors.push(error),
      },
      runtime,
      'https://ingest.example',
    );
    plugin.start();

    expect(() => runtime.emit(observation())).not.toThrow();
    expect(errors).toEqual([failure]);
  });
});
