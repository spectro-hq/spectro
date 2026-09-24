import { serializedByteLength } from '@spectro/protocol';
import type { DurableEventQueue, EventQueueScope, QueuedEventRecord } from '@spectro/types';

const DATABASE_NAME = 'spectro-browser-outbox-v1';
const OBJECT_STORE_NAME = 'events';
const DEFAULT_MAX_EVENTS = 100;
const DEFAULT_MAX_BYTES = 1 * 1_024 * 1_024;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_ATTEMPTS = 8;

export interface IndexedDbOutboxOptions {
  maxEvents?: number;
  maxBytes?: number;
  ttlMs?: number;
}

interface StoredEvent extends QueuedEventRecord {
  key: string;
  scope: string;
  storedAt: number;
  bytes: number;
}

function scopeKey(scope: EventQueueScope): string {
  return JSON.stringify([scope.projectId, scope.environment]);
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  const requested = value ?? fallback;
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error('IndexedDB outbox limits must be positive safe integers');
  }
  return Math.min(requested, maximum);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed')),
      {
        once: true,
      },
    );
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
      {
        once: true,
      },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed')),
      {
        once: true,
      },
    );
  });
}

function ordered<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  const result: T[] = [];
  for (const value of values) {
    let index = 0;
    while (index < result.length) {
      const current = result[index];
      if (current === undefined || compare(current, value) > 0) break;
      index += 1;
    }
    result.splice(index, 0, value);
  }
  return result;
}

export class IndexedDbEventOutbox implements DurableEventQueue {
  readonly #maxEvents: number;
  readonly #maxBytes: number;
  readonly #ttlMs: number;
  #database: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbOutboxOptions = {}) {
    this.#maxEvents = boundedLimit(options.maxEvents, DEFAULT_MAX_EVENTS, DEFAULT_MAX_EVENTS);
    this.#maxBytes = boundedLimit(options.maxBytes, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
    this.#ttlMs = boundedLimit(options.ttlMs, DEFAULT_TTL_MS, DEFAULT_TTL_MS);
  }

  async load(scope: EventQueueScope): Promise<readonly QueuedEventRecord[]> {
    const database = await this.#open();
    const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
    const completion = transactionResult(transaction);
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    const records = (await requestResult(
      store.index('scope').getAll(IDBKeyRange.only(scopeKey(scope))),
    )) as StoredEvent[];
    const now = Date.now();
    const valid = records.filter(
      (record) =>
        record.priority === 'immediate' &&
        Number.isSafeInteger(record.attempts) &&
        record.attempts >= 0 &&
        record.storedAt + this.#ttlMs > now &&
        record.attempts < MAX_ATTEMPTS,
    );
    for (const record of records) {
      if (!valid.some((candidate) => candidate.key === record.key)) store.delete(record.key);
    }
    await completion;
    return ordered(valid, (left, right) => left.event.timestamp - right.event.timestamp).map(
      ({ event, priority, attempts }) => ({ event, priority, attempts }),
    );
  }

  async save(scope: EventQueueScope, records: readonly QueuedEventRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const database = await this.#open();
    const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
    const completion = transactionResult(transaction);
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    const key = scopeKey(scope);
    const existing = (await requestResult(
      store.index('scope').getAll(IDBKeyRange.only(key)),
    )) as StoredEvent[];
    const byKey = new Map(existing.map((record) => [record.key, record]));
    const now = Date.now();

    for (const record of records) {
      const recordKey = `${key}:${record.event.id}`;
      byKey.set(recordKey, {
        ...record,
        key: recordKey,
        scope: key,
        storedAt: byKey.get(recordKey)?.storedAt ?? now,
        bytes: serializedByteLength(record.event),
      });
    }

    const candidates = ordered(
      [...byKey.values()].filter(
        (record) => record.storedAt + this.#ttlMs > now && record.attempts < MAX_ATTEMPTS,
      ),
      (left, right) => left.storedAt - right.storedAt,
    );
    const retained: StoredEvent[] = [];
    let retainedBytes = 0;
    for (let recordIndex = candidates.length - 1; recordIndex >= 0; recordIndex -= 1) {
      const record = candidates[recordIndex];
      if (record === undefined) continue;
      if (retained.length >= this.#maxEvents || retainedBytes + record.bytes > this.#maxBytes) {
        continue;
      }
      retained.push(record);
      retainedBytes += record.bytes;
    }
    const retainedKeys = new Set(retained.map((record) => record.key));
    for (const record of existing) {
      if (!retainedKeys.has(record.key)) store.delete(record.key);
    }
    for (const record of retained) store.put(record);
    await completion;
    return Math.max(0, candidates.length - retained.length);
  }

  async remove(scope: EventQueueScope, eventIds: readonly string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const database = await this.#open();
    const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
    const completion = transactionResult(transaction);
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    const key = scopeKey(scope);
    for (const eventId of eventIds) store.delete(`${key}:${eventId}`);
    await completion;
  }

  #open(): Promise<IDBDatabase> {
    if (this.#database !== undefined) return this.#database;
    this.#database = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.addEventListener(
        'upgradeneeded',
        () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
            const store = database.createObjectStore(OBJECT_STORE_NAME, { keyPath: 'key' });
            store.createIndex('scope', 'scope', { unique: false });
          }
        },
        { once: true },
      );
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener(
        'error',
        () => reject(request.error ?? new Error('IndexedDB open failed')),
        {
          once: true,
        },
      );
      request.addEventListener('blocked', () => reject(new Error('IndexedDB open was blocked')), {
        once: true,
      });
    });
    return this.#database;
  }
}
