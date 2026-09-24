import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { EVENT_VERSION, type SpectroEvent } from '@spectro/protocol';
import type { EventQueueScope, QueuedEventRecord } from '@spectro/types';

import { IndexedDbEventOutbox } from '../src/outbox.js';

const scope: EventQueueScope = { projectId: 'prj_checkout', environment: 'production' };

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function record(
  id: string,
  priority: QueuedEventRecord['priority'] = 'immediate',
): QueuedEventRecord {
  const event: SpectroEvent<'error'> = {
    id,
    type: 'error',
    name: 'runtime_error',
    version: EVENT_VERSION,
    timestamp: 1_789_368_123_456,
    context: {
      sdk: { name: '@spectro/browser', version: '0.1.0' },
      project: { id: scope.projectId },
      environment: scope.environment,
      session: { id: 'ses_01' },
    },
    payload: { mechanism: 'runtime', message: 'checkout failed', handled: false },
  };
  return { event, priority, attempts: 0 };
}

describe('IndexedDbEventOutbox', () => {
  it('restores urgent events across adapter instances, scopes them, and removes accepted events', async () => {
    const first = new IndexedDbEventOutbox();
    const urgentOne = record('01994f34-b106-79a3-9865-d835ac0347a9');
    const batch = record('01994f34-b106-79a3-9865-d835ac0347aa', 'batch');
    const urgentTwo = record('01994f34-b106-79a3-9865-d835ac0347ab');

    await expect(first.save(scope, [urgentOne, batch, urgentTwo])).resolves.toBe(0);

    const restarted = new IndexedDbEventOutbox();
    await expect(restarted.load(scope)).resolves.toEqual([urgentOne, urgentTwo]);
    await expect(
      restarted.load({ projectId: scope.projectId, environment: 'staging' }),
    ).resolves.toEqual([]);

    await restarted.remove(scope, [urgentOne.event.id]);
    await expect(new IndexedDbEventOutbox().load(scope)).resolves.toEqual([urgentTwo]);
  });

  it('bounds retained records and reports how many were dropped', async () => {
    const outbox = new IndexedDbEventOutbox({ maxEvents: 2 });
    const first = record('01994f34-b106-79a3-9865-d835ac0347a9');
    const second = record('01994f34-b106-79a3-9865-d835ac0347aa');
    const third = record('01994f34-b106-79a3-9865-d835ac0347ab');

    await expect(outbox.save(scope, [first, second, third])).resolves.toBe(1);

    await expect(new IndexedDbEventOutbox().load(scope)).resolves.toEqual([second, third]);
  });
});
