import { describe, expect, it } from 'vitest';

import { SpectroClient, type Transport } from '@spectro/core';
import type { Envelope, SpectroEvent } from '@spectro/protocol';

import { SessionPageLifecycle } from '../src/lifecycle.js';
import type { BrowserLifecycleRuntime, RawPageSnapshot } from '../src/runtime.js';

class MemoryTransport implements Transport {
  readonly envelopes: Envelope[] = [];

  async send(envelope: Envelope): Promise<{ accepted: number }> {
    this.envelopes.push(envelope);
    return { accepted: envelope.items.length };
  }
}

class FakeBrowserRuntime implements BrowserLifecycleRuntime {
  page: RawPageSnapshot = {
    href: 'https://user:secret@app.example/checkout?token=private#summary',
    title: ' Checkout ',
    referrer: 'https://search.example/results?q=private',
  };
  readonly storage = new Map<string, string>();
  readonly navigationListeners = new Set<() => void>();
  readonly activityListeners = new Set<() => void>();
  throwOnReadPage = false;
  throwOnStorage = false;

  readPage(): RawPageSnapshot {
    if (this.throwOnReadPage) throw new Error('location unavailable');
    return this.page;
  }

  readSessionItem(key: string): string | null {
    if (this.throwOnStorage) throw new Error('storage unavailable');
    return this.storage.get(key) ?? null;
  }

  writeSessionItem(key: string, value: string): void {
    if (this.throwOnStorage) throw new Error('storage unavailable');
    this.storage.set(key, value);
  }

  subscribeToNavigation(listener: () => void): () => void {
    this.navigationListeners.add(listener);
    return () => this.navigationListeners.delete(listener);
  }

  subscribeToActivity(listener: () => void): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  navigate(page: RawPageSnapshot): void {
    this.page = page;
    for (const listener of this.navigationListeners) listener();
  }

  activate(): void {
    for (const listener of this.activityListeners) listener();
  }
}

function createHarness(runtime: FakeBrowserRuntime, initialNow = 1_789_368_100_000) {
  let now = initialNow;
  const counters = { session: 0, page: 0 };
  const errors: Error[] = [];
  const transport = new MemoryTransport();
  const core = new SpectroClient(
    {
      projectId: 'prj_checkout',
      apiKey: 'sp_local_dev',
      environment: 'production',
      endpoint: 'https://ingest.example',
      onError: (error) => errors.push(error),
    },
    transport,
  );
  const lifecycle = new SessionPageLifecycle(
    {
      capture: (input) => core.capture(input),
      updateContext: (context) => core.updateContext(context),
      report: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    },
    runtime,
    {
      projectId: 'prj_checkout',
      environment: 'production',
      sessionTimeoutMs: 30 * 60 * 1_000,
      clock: () => now,
      idFactory: (kind) => `${kind}_${++counters[kind]}`,
    },
  );

  return {
    core,
    errors,
    lifecycle,
    transport,
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

async function flushedEvents(
  core: SpectroClient,
  transport: MemoryTransport,
): Promise<SpectroEvent[]> {
  const firstNewEnvelope = transport.envelopes.length;
  await core.flush();
  return transport.envelopes
    .slice(firstNewEnvelope)
    .flatMap((envelope) => envelope.items.map((item) => item.payload));
}

describe('SessionPageLifecycle', () => {
  it('starts a tab session and captures a privacy-safe initial page view', async () => {
    const runtime = new FakeBrowserRuntime();
    const harness = createHarness(runtime);

    harness.lifecycle.start();
    const events = await flushedEvents(harness.core, harness.transport);

    expect(events.map((event) => event.name)).toEqual(['session_start', 'page_view']);
    expect(events[0]?.context.session).toEqual({
      id: 'session_1',
      startedAt: 1_789_368_100_000,
    });
    expect(events[1]?.context.page).toEqual({
      id: 'page_1',
      url: 'https://app.example/checkout',
      path: '/checkout',
      title: 'Checkout',
      referrer: 'https://search.example/results',
    });
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('resumes an active tab session while assigning a fresh page lifecycle', async () => {
    const runtime = new FakeBrowserRuntime();
    runtime.storage.set(
      'spectro.session.v1:prj_checkout:production',
      JSON.stringify({
        id: 'ses_existing',
        startedAt: 1_789_368_000_000,
        lastActivityAt: 1_789_368_090_000,
      }),
    );
    const harness = createHarness(runtime);

    harness.lifecycle.start();
    const events = await flushedEvents(harness.core, harness.transport);

    expect(events.map((event) => event.name)).toEqual(['page_view']);
    expect(events[0]?.context).toMatchObject({
      session: { id: 'ses_existing', startedAt: 1_789_368_000_000 },
      page: { id: 'page_1' },
    });
    expect(runtime.storage.get('spectro.session.v1:prj_checkout:production')).toContain(
      '1789368100000',
    );
  });

  it('rotates page context on a sanitized SPA route transition', async () => {
    const runtime = new FakeBrowserRuntime();
    const harness = createHarness(runtime);
    harness.lifecycle.start();

    runtime.navigate({
      href: 'https://app.example/orders/42?auth=private#/details?token=private',
      title: 'Order',
      referrer: '',
    });
    harness.core.track('order_opened');
    const events = await flushedEvents(harness.core, harness.transport);

    expect(events.map((event) => event.name)).toEqual([
      'session_start',
      'page_view',
      'page_route_change',
      'order_opened',
    ]);
    expect(events[2]).toMatchObject({
      context: {
        session: { id: 'session_1' },
        page: {
          id: 'page_2',
          url: 'https://app.example/orders/42#/details',
          path: '/orders/42#/details',
        },
      },
      payload: {
        action: 'route_change',
        from: 'https://app.example/checkout',
        to: 'https://app.example/orders/42#/details',
      },
    });
    expect(events[3]?.context.page?.id).toBe('page_2');
  });

  it('starts a new session and page after the inactivity timeout', async () => {
    const runtime = new FakeBrowserRuntime();
    const harness = createHarness(runtime);
    harness.lifecycle.start();
    await flushedEvents(harness.core, harness.transport);

    harness.advance(30 * 60 * 1_000);
    runtime.activate();
    const events = await flushedEvents(harness.core, harness.transport);

    expect(events.map((event) => event.name)).toEqual(['session_start', 'page_view']);
    expect(events[0]?.context.session?.id).toBe('session_2');
    expect(events[1]?.context.page?.id).toBe('page_2');
  });

  it('falls back to in-memory continuity when session storage is unavailable', async () => {
    const runtime = new FakeBrowserRuntime();
    runtime.throwOnStorage = true;
    const harness = createHarness(runtime);

    expect(() => harness.lifecycle.start()).not.toThrow();
    runtime.activate();
    const events = await flushedEvents(harness.core, harness.transport);

    expect(events.map((event) => event.name)).toEqual(['session_start', 'page_view']);
    expect(harness.errors).toEqual([]);
  });

  it('contains lifecycle failures and removes listeners when stopped', async () => {
    const runtime = new FakeBrowserRuntime();
    const harness = createHarness(runtime);
    harness.lifecycle.start();
    await flushedEvents(harness.core, harness.transport);

    harness.advance(30 * 60 * 1_000);
    runtime.throwOnReadPage = true;
    expect(() => runtime.activate()).not.toThrow();
    expect(harness.errors[0]?.message).toBe('location unavailable');

    harness.lifecycle.stop();
    expect(runtime.navigationListeners.size).toBe(0);
    expect(runtime.activityListeners.size).toBe(0);
    runtime.throwOnReadPage = false;
    runtime.navigate({ href: 'https://app.example/after', title: 'After', referrer: '' });
    expect(await flushedEvents(harness.core, harness.transport)).toEqual([]);
  });
});
