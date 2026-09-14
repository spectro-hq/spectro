import { afterEach, describe, expect, it } from 'vitest';

import { SpectroClient, type Transport } from '@spectro/core';
import type { Envelope } from '@spectro/protocol';

import { createIngestApp } from './app.js';
import { InMemoryEventStore } from './store.js';

const apps: ReturnType<typeof createIngestApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('POST /v1/envelope', () => {
  it('accepts the complete track-to-storage vertical slice', async () => {
    const store = new InMemoryEventStore();
    const app = createIngestApp({ apiKey: 'sp_test', store });
    apps.push(app);

    const transport: Transport = {
      async send(envelope: Envelope) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/envelope',
          headers: { 'x-spectro-key': 'sp_test' },
          payload: envelope,
        });
        if (response.statusCode !== 202) {
          throw new Error(`ingestion failed: ${response.statusCode}`);
        }
        return response.json<{ accepted: number }>();
      },
    };

    const client = new SpectroClient(
      {
        projectId: 'prj_checkout',
        apiKey: 'sp_test',
        environment: 'production',
        endpoint: 'http://localhost:4401',
        release: '1.8.2',
      },
      transport,
    );

    const id = client.track('checkout_started', { amount: 399, currency: 'CNY' });
    await expect(client.flush()).resolves.toEqual({ sent: 1, remaining: 0 });

    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({
      id,
      type: 'custom',
      name: 'checkout_started',
      payload: { properties: { amount: 399, currency: 'CNY' } },
    });
  });

  it('rejects missing credentials without reflecting them', async () => {
    const app = createIngestApp({ apiKey: 'sp_test' });
    apps.push(app);

    const response = await app.inject({ method: 'POST', url: '/v1/envelope', payload: {} });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('sp_test');
  });

  it('rejects malformed envelopes atomically', async () => {
    const store = new InMemoryEventStore();
    const app = createIngestApp({ apiKey: 'sp_test', store });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers: { 'x-spectro-key': 'sp_test' },
      payload: { version: 1, sentAt: Date.now(), items: [{ type: 'event', payload: {} }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_envelope' } });
    expect(store.all()).toHaveLength(0);
  });

  it('rejects deeply nested custom properties before persistence', async () => {
    const store = new InMemoryEventStore();
    const app = createIngestApp({ apiKey: 'sp_test', store });
    apps.push(app);
    const event = {
      id: '01994f34-b106-79a3-9865-d835ac0347a9',
      type: 'custom',
      name: 'nested_event',
      version: 1,
      timestamp: Date.now(),
      context: {
        sdk: { name: '@spectro/browser', version: '0.1.0' },
        project: { id: 'prj_test' },
        environment: 'production',
      },
      payload: { properties: { a: { b: { c: { d: { e: { f: 'too deep' } } } } } } },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers: { 'x-spectro-key': 'sp_test' },
      payload: { version: 1, sentAt: Date.now(), items: [{ type: 'event', payload: event }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_envelope' } });
    expect(store.all()).toHaveLength(0);
  });

  it('rejects hostile structural depth before recursive schema validation', async () => {
    const store = new InMemoryEventStore();
    const app = createIngestApp({ apiKey: 'sp_test', store });
    apps.push(app);
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 100; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    const response = await app.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers: { 'x-spectro-key': 'sp_test' },
      payload: root,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_nesting' } });
    expect(store.all()).toHaveLength(0);
  });
});
