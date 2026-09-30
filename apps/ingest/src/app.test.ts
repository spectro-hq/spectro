import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectroClient, type Transport } from '@spectro/core';
import type { Envelope } from '@spectro/protocol';

import { createIngestApp } from './app.js';
import { InMemoryEventStore } from './store.js';
import type { IngestWriteKeyAuthorizer } from './write-key-authorizer.js';

const apps: ReturnType<typeof createIngestApp>[] = [];

function writeKeyEnvelope(
  events: readonly {
    readonly id: string;
    readonly projectId?: string;
    readonly environment?: string;
  }[],
) {
  return {
    version: 1,
    sentAt: Date.now(),
    items: events.map(({ id, projectId = 'prj_checkout', environment = 'production' }) => ({
      type: 'event',
      payload: {
        id,
        type: 'custom',
        name: 'write_key_test',
        version: 1,
        timestamp: Date.now(),
        context: {
          sdk: { name: '@spectro/browser', version: '0.1.0' },
          project: { id: projectId },
          environment,
        },
        payload: { properties: {} },
      },
    })),
  };
}

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

  it('accepts a valid hosted key only for its allowed origin and exact project scope', async () => {
    const store = new InMemoryEventStore();
    const authorize = vi.fn<IngestWriteKeyAuthorizer['authorize']>(async (key) =>
      key === `spk_${'A'.repeat(43)}`
        ? {
            projectId: 'prj_checkout',
            environment: 'production',
            allowedOrigins: ['https://app.example.com'],
          }
        : undefined,
    );
    const app = createIngestApp({ writeKeyAuthorizer: { authorize }, store });
    apps.push(app);
    const headers = {
      'x-spectro-key': `spk_${'A'.repeat(43)}`,
      origin: 'https://app.example.com',
    };
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers,
      payload: writeKeyEnvelope([{ id: '01994f34-b106-79a3-9865-d835ac0347a9' }]),
    });

    expect(accepted.statusCode).toBe(202);
    expect(store.all()).toHaveLength(1);
    expect(authorize).toHaveBeenCalledWith(headers['x-spectro-key']);
  });

  it('rejects disallowed or missing browser origins before persistence', async () => {
    const store = new InMemoryEventStore();
    const app = createIngestApp({
      writeKeyAuthorizer: {
        async authorize() {
          return {
            projectId: 'prj_checkout',
            environment: 'production',
            allowedOrigins: ['https://app.example.com'],
          };
        },
      },
      store,
    });
    apps.push(app);
    const payload = writeKeyEnvelope([{ id: '01994f34-b106-79a3-9865-d835ac0347aa' }]);
    for (const headers of [
      { 'x-spectro-key': 'spk_test', origin: 'https://attacker.example' },
      { 'x-spectro-key': 'spk_test' },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- exercise disallowed and absent origin separately.
      const response = await app.inject({ method: 'POST', url: '/v1/envelope', headers, payload });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'origin_denied' } });
    }
    expect(store.all()).toHaveLength(0);
  });

  it('rejects an entire envelope if any event escapes the key project or environment', async () => {
    const store = new InMemoryEventStore();
    const app = createIngestApp({
      writeKeyAuthorizer: {
        async authorize() {
          return {
            projectId: 'prj_checkout',
            environment: 'production',
            allowedOrigins: [],
          };
        },
      },
      store,
    });
    apps.push(app);
    const headers = { 'x-spectro-key': 'spk_test' };
    const outsideProject = await app.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers,
      payload: writeKeyEnvelope([
        { id: '01994f34-b106-79a3-9865-d835ac0347ab' },
        { id: '01994f34-b106-79a3-9865-d835ac0347ac', projectId: 'prj_another' },
      ]),
    });
    expect(outsideProject.statusCode).toBe(403);
    expect(outsideProject.json()).toMatchObject({ error: { code: 'project_scope_mismatch' } });

    const outsideEnvironment = await app.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers,
      payload: writeKeyEnvelope([
        { id: '01994f34-b106-79a3-9865-d835ac0347ad' },
        { id: '01994f34-b106-79a3-9865-d835ac0347ae', environment: 'staging' },
      ]),
    });
    expect(outsideEnvironment.statusCode).toBe(403);
    expect(outsideEnvironment.json()).toMatchObject({ error: { code: 'project_scope_mismatch' } });
    expect(store.all()).toHaveLength(0);
  });

  it('rejects revoked keys and fails closed when key lookup is unavailable', async () => {
    let active = true;
    const store = new InMemoryEventStore();
    const app = createIngestApp({
      writeKeyAuthorizer: {
        async authorize() {
          if (!active) return undefined;
          return { projectId: 'prj_checkout', environment: 'production', allowedOrigins: [] };
        },
      },
      store,
    });
    apps.push(app);
    const request = {
      method: 'POST' as const,
      url: '/v1/envelope',
      headers: { 'x-spectro-key': 'spk_test' },
      payload: writeKeyEnvelope([{ id: '01994f34-b106-79a3-9865-d835ac0347af' }]),
    };
    expect((await app.inject(request)).statusCode).toBe(202);
    active = false;
    const revoked = await app.inject({
      ...request,
      payload: writeKeyEnvelope([{ id: '01994f34-b106-79a3-9865-d835ac0347b0' }]),
    });
    expect(revoked.statusCode).toBe(401);
    expect(store.all()).toHaveLength(1);

    const unavailableApp = createIngestApp({
      writeKeyAuthorizer: {
        async authorize() {
          throw new Error('database-secret');
        },
      },
      store: new InMemoryEventStore(),
    });
    apps.push(unavailableApp);
    const unavailable = await unavailableApp.inject(request);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain('database-secret');
    expect(unavailable.json()).toMatchObject({ error: { code: 'authorization_unavailable' } });
  });

  it('returns a stable retryable error when durable admission fails', async () => {
    const app = createIngestApp({
      apiKey: 'sp_test',
      store: {
        async append() {
          throw new Error('nats://operator:private-secret@localhost:4222');
        },
      },
    });
    apps.push(app);
    const event = {
      id: '01994f34-b106-79a3-9865-d835ac0347a9',
      type: 'custom',
      name: 'admission_test',
      version: 1,
      timestamp: Date.now(),
      context: {
        sdk: { name: '@spectro/browser', version: '0.1.0' },
        project: { id: 'prj_test' },
        environment: 'production',
      },
      payload: { properties: {} },
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers: { 'x-spectro-key': 'sp_test' },
      payload: { version: 1, sentAt: Date.now(), items: [{ type: 'event', payload: event }] },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'admission_unavailable',
        message: 'Durable event admission is temporarily unavailable.',
      },
    });
    expect(response.body).not.toContain('private-secret');
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
