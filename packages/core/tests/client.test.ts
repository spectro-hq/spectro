import { describe, expect, it } from 'vitest';

import type { Envelope } from '@spectro/protocol';
import type {
  DurableEventQueue,
  EventQueueScope,
  FlushOptions,
  QueuedEventRecord,
} from '@spectro/types';

import { SpectroClient, SpectroValidationError, type Transport } from '../src/index.js';

class MemoryTransport implements Transport {
  envelopes: Envelope[] = [];
  options: FlushOptions[] = [];

  async send(envelope: Envelope, options: FlushOptions = {}): Promise<{ accepted: number }> {
    this.envelopes.push(envelope);
    this.options.push(options);
    return { accepted: envelope.items.length };
  }
}

class MemoryDurableQueue implements DurableEventQueue {
  records: QueuedEventRecord[] = [];
  scopes: EventQueueScope[] = [];

  async load(scope: EventQueueScope): Promise<readonly QueuedEventRecord[]> {
    this.scopes.push(scope);
    return this.records;
  }

  async save(scope: EventQueueScope, records: readonly QueuedEventRecord[]): Promise<number> {
    this.scopes.push(scope);
    for (const record of records) {
      this.records = this.records.filter(({ event }) => event.id !== record.event.id);
      this.records.push(record);
    }
    return 0;
  }

  async remove(scope: EventQueueScope, eventIds: readonly string[]): Promise<void> {
    this.scopes.push(scope);
    this.records = this.records.filter(({ event }) => !eventIds.includes(event.id));
  }
}

function createClient(transport: Transport, onError?: (error: Error) => void): SpectroClient {
  return new SpectroClient(
    {
      projectId: 'prj_checkout',
      apiKey: 'sp_local_dev',
      environment: 'production',
      endpoint: 'http://localhost:4401',
      release: '1.8.2',
      session: { id: 'ses_01' },
      ...(onError ? { onError } : {}),
    },
    transport,
  );
}

describe('SpectroClient', () => {
  it('builds, queues, and flushes a contextual custom event', async () => {
    const transport = new MemoryTransport();
    const client = createClient(transport);

    const eventId = client.track('checkout_started', { amount: 399 });
    const result = await client.flush();

    expect(eventId).toBeDefined();
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toEqual({ sent: 1, remaining: 0 });
    expect(transport.envelopes[0]?.items[0]?.payload).toMatchObject({
      id: eventId,
      type: 'custom',
      name: 'checkout_started',
      context: {
        project: { id: 'prj_checkout' },
        environment: 'production',
        release: { version: '1.8.2' },
        session: { id: 'ses_01' },
      },
      payload: { properties: { amount: 399 } },
    });
  });

  it('restores drained events when transport fails', async () => {
    let attempts = 0;
    const errors: Error[] = [];
    const transport: Transport = {
      async send(envelope) {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return { accepted: envelope.items.length };
      },
    };
    const client = createClient(transport, (error) => errors.push(error));
    client.track('checkout_started');

    await expect(client.flush()).resolves.toEqual({ sent: 0, remaining: 1 });
    expect(errors[0]?.message).toBe('offline');
    await expect(client.flush()).resolves.toEqual({ sent: 1, remaining: 0 });
  });

  it('persists unhandled errors before immediate delivery and removes them after acceptance', async () => {
    const transport = new MemoryTransport();
    const durableQueue = new MemoryDurableQueue();
    let immediateRequests = 0;
    const client = new SpectroClient(
      {
        projectId: 'prj_checkout',
        apiKey: 'sp_local_dev',
        environment: 'production',
        endpoint: 'http://localhost:4401',
        session: { id: 'ses_01' },
      },
      transport,
      { durableQueue, onImmediateEvent: () => immediateRequests++ },
    );

    const id = client.capture({
      type: 'error',
      name: 'runtime_error',
      payload: { mechanism: 'runtime', message: 'checkout failed', handled: false },
    });

    expect(id).toBeDefined();
    expect(immediateRequests).toBe(1);
    await expect(client.flush({ priority: 'immediate' })).resolves.toEqual({
      sent: 1,
      remaining: 0,
    });
    expect(transport.options[0]).toEqual({ priority: 'immediate' });
    expect(durableQueue.records).toEqual([]);
    expect(durableQueue.scopes).toContainEqual({
      projectId: 'prj_checkout',
      environment: 'production',
    });
  });

  it('keeps handled/resource errors in the batch lane unless explicitly overridden', async () => {
    const transport = new MemoryTransport();
    const client = createClient(transport);

    client.capture({
      type: 'error',
      name: 'resource_error',
      payload: { mechanism: 'resource', message: 'script failed', handled: true },
    });
    client.capture(
      {
        type: 'error',
        name: 'handled_error',
        payload: { mechanism: 'manual', message: 'handled error', handled: true },
      },
      { priority: 'immediate' },
    );

    await client.flush({ priority: 'immediate' });
    expect(transport.envelopes[0]?.items).toHaveLength(1);
    expect(transport.envelopes[0]?.items[0]?.payload.name).toBe('handled_error');
    await client.flush();
    expect(transport.envelopes[1]?.items[0]?.payload.name).toBe('resource_error');
  });

  it('bounds keepalive flushes and leaves the rest queued for a later flush', async () => {
    const transport = new MemoryTransport();
    const client = createClient(transport);
    for (let index = 0; index < 40; index += 1) {
      client.track('batch_event', { value: `${index}${'x'.repeat(2_047)}` });
    }

    const firstFlush = await client.flush({ keepalive: true });
    expect(firstFlush.sent).toBeGreaterThan(0);
    expect(firstFlush.remaining).toBeGreaterThan(0);
    expect(transport.envelopes[0]?.items.length).toBe(firstFlush.sent);
    const laterFlush = await client.flush();
    expect(laterFlush.sent + firstFlush.sent).toBe(40);
    expect(laterFlush.remaining).toBe(0);
    expect(transport.envelopes).toHaveLength(2);
  });

  it('reports and drops invalid event names without throwing into the host', () => {
    const errors: Error[] = [];
    const client = createClient(new MemoryTransport(), (error) => errors.push(error));

    expect(client.track('checkoutStarted')).toBeUndefined();
    expect(errors[0]).toBeInstanceOf(SpectroValidationError);
  });

  it('reports unsupported and cyclic custom values without throwing into the host', () => {
    const errors: Error[] = [];
    const client = createClient(new MemoryTransport(), (error) => errors.push(error));
    const properties: Record<string, unknown> = {};
    properties.self = properties;

    expect(client.track('cyclic_event', properties as never)).toBeUndefined();
    expect(errors[0]?.message).toContain('cyclic');
  });

  it('contains failures thrown by the customer error hook', () => {
    const client = createClient(new MemoryTransport(), () => {
      throw new Error('customer callback failed');
    });

    expect(() => client.track('invalidName')).not.toThrow();
  });

  it('removes sensitive custom properties, user traits, and tags before transport', async () => {
    const transport = new MemoryTransport();
    const client = new SpectroClient(
      {
        projectId: 'prj_checkout',
        apiKey: 'sp_local_dev',
        environment: 'production',
        endpoint: 'http://localhost:4401',
        user: {
          anonymousId: 'anon_01',
          traits: { plan: 'pro', cookie: 'session=secret' },
        },
        tags: { region: 'cn', authorization: 'Bearer secret' },
      },
      transport,
    );

    client.capture({
      type: 'custom',
      name: 'checkout_started',
      payload: {
        properties: {
          amount: 399,
          user_password: 'secret',
          document_cookie: 'session=secret',
          auth_header: 'Bearer secret',
          request: { request_payload: 'private', method: 'POST' },
        },
      },
    });
    await client.flush();

    const captured = transport.envelopes[0]?.items[0]?.payload;
    expect(captured?.payload).toEqual({
      properties: { amount: 399, request: { method: 'POST' } },
    });
    expect(captured?.context.user?.traits).toEqual({ plan: 'pro' });
    expect(captured?.context.tags).toEqual({ region: 'cn' });
  });

  it('applies updated session and page context to later events only', async () => {
    const transport = new MemoryTransport();
    const client = createClient(transport);

    client.track('before_route');
    client.updateContext({
      session: { id: 'ses_02', startedAt: 1_789_368_100_000 },
      page: {
        id: 'page_02',
        url: 'https://shop.example/checkout',
        path: '/checkout',
      },
    });
    client.track('after_route');
    await client.flush();

    const events = transport.envelopes[0]?.items.map((item) => item.payload);
    expect(events?.[0]?.context).toMatchObject({ session: { id: 'ses_01' } });
    expect(events?.[0]?.context.page).toBeUndefined();
    expect(events?.[1]?.context).toMatchObject({
      session: { id: 'ses_02', startedAt: 1_789_368_100_000 },
      page: { id: 'page_02', path: '/checkout' },
    });
  });

  it('applies event-local context without mutating the active client context', async () => {
    const transport = new MemoryTransport();
    const client = createClient(transport);

    client.updateContext({
      page: { id: 'page_current', url: 'https://shop.example/current', path: '/current' },
    });
    client.capture({
      type: 'performance',
      name: 'web_vital_lcp',
      payload: { metric: 'lcp', value: 1_200, unit: 'ms' },
      context: {
        page: { id: 'page_previous', url: 'https://shop.example/previous', path: '/previous' },
      },
    });
    client.track('after_metric');
    await client.flush();

    const events = transport.envelopes[0]?.items.map((item) => item.payload);
    expect(events?.[0]?.context.page?.id).toBe('page_previous');
    expect(events?.[1]?.context.page?.id).toBe('page_current');
  });
});
