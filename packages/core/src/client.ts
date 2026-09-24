import {
  ENVELOPE_VERSION,
  EVENT_NAME_PATTERN,
  EVENT_VERSION,
  MAX_EVENT_BYTES,
  serializedByteLength,
  validateEvent,
  type Envelope,
  type EventContext,
  type JSONObject,
} from '@spectro/protocol';
import { MAX_KEEPALIVE_ENVELOPE_BYTES } from '@spectro/types';
import type {
  CaptureInput,
  CaptureOptions,
  ClientContextInput,
  DurableEventQueue,
  EventQueueScope,
  FlushOptions,
  FlushResult,
  QueuedEventRecord,
  SpectroClientOptions,
  SpectroClientPublic,
} from '@spectro/types';
import { v7 as uuidv7 } from 'uuid';

import { createEventContext } from './context.js';
import { SpectroValidationError } from './errors.js';
import { normalizeProperties } from './normalize.js';
import { EventQueue } from './queue.js';
import type { Transport } from './transport.js';

export interface SpectroClientRuntimeOptions {
  durableQueue?: DurableEventQueue;
  onImmediateEvent?: () => void;
  onBatchReady?: () => void;
  onTransportFailure?: (error: unknown, options: FlushOptions) => void;
}

const BATCH_FLUSH_THRESHOLD = 50;

function sanitizePayload(input: CaptureInput): unknown {
  if (input.type === 'custom') {
    return { properties: normalizeProperties(input.payload.properties) };
  }
  if (input.type === 'performance' && input.payload.attribution) {
    return { ...input.payload, attribution: normalizeProperties(input.payload.attribution) };
  }
  return input.payload;
}

export class SpectroClient implements SpectroClientPublic {
  readonly #options: SpectroClientOptions;
  #contextOverrides: ClientContextInput = {};
  readonly #queue = new EventQueue();
  readonly #transport: Transport;
  readonly #runtime: SpectroClientRuntimeOptions;
  readonly #scope: EventQueueScope;
  readonly #ready: Promise<void>;
  #persistenceWrites: Promise<void> = Promise.resolve();
  #flushInFlight: Promise<FlushResult> | undefined;
  #followUpOptions: FlushOptions | undefined;

  constructor(
    options: SpectroClientOptions,
    transport: Transport,
    runtime: SpectroClientRuntimeOptions = {},
  ) {
    this.#options = options;
    this.#transport = transport;
    this.#runtime = runtime;
    this.#scope = { projectId: options.projectId, environment: options.environment };
    this.#ready = this.#restoreQueue();
  }

  getContext(): EventContext {
    return createEventContext({ ...this.#options, ...this.#contextOverrides });
  }

  updateContext(context: ClientContextInput): void {
    this.#contextOverrides = { ...this.#contextOverrides, ...context };
  }

  capture(input: CaptureInput, options: CaptureOptions = {}): string | undefined {
    try {
      if (!EVENT_NAME_PATTERN.test(input.name)) {
        throw new SpectroValidationError(`Event name must match ${EVENT_NAME_PATTERN.source}`);
      }

      const candidate: unknown = {
        id: uuidv7(),
        type: input.type,
        name: input.name,
        version: EVENT_VERSION,
        timestamp: input.timestamp ?? Date.now(),
        context: createEventContext({
          ...this.#options,
          ...this.#contextOverrides,
          ...input.context,
        }),
        payload: sanitizePayload(input),
      };

      const validation = validateEvent(candidate);
      if (!validation.success) {
        throw new SpectroValidationError(
          validation.issues.map((issue) => `${issue.path} ${issue.message}`).join('; '),
        );
      }

      if (serializedByteLength(validation.data) > MAX_EVENT_BYTES) {
        throw new SpectroValidationError(`Event exceeds the ${MAX_EVENT_BYTES}-byte limit`);
      }

      const priority = options.priority ?? eventPriority(validation.data);
      const enqueued = this.#queue.enqueue(validation.data, priority);
      if (enqueued.dropped > 0) {
        this.#report(
          new Error(`Spectro event queue dropped ${enqueued.dropped} event(s) at capacity`),
        );
      }
      this.#removePersisted(
        enqueued.droppedRecords
          .filter(({ priority: droppedPriority }) => droppedPriority === 'immediate')
          .map(({ event }) => event.id),
      );
      if (!enqueued.accepted) {
        this.#report(new Error('Spectro event queue is full; the captured event was dropped'));
        return undefined;
      }
      if (priority === 'immediate') {
        this.#persist([{ event: validation.data, priority, attempts: 0 }]);
        this.#runtime.onImmediateEvent?.();
      } else if (this.#queue.size >= BATCH_FLUSH_THRESHOLD) {
        this.#runtime.onBatchReady?.();
      }
      return validation.data.id;
    } catch (error) {
      this.#report(error);
      return undefined;
    }
  }

  track(name: string, properties: JSONObject = {}): string | undefined {
    return this.capture({
      type: 'custom',
      name,
      payload: { properties },
    });
  }

  flush(options: FlushOptions = {}): Promise<FlushResult> {
    if (this.#flushInFlight !== undefined) {
      this.#followUpOptions = mergeFlushOptions(this.#followUpOptions, options);
      const inFlight = this.#flushInFlight;
      return inFlight.then((result) => {
        const followUp = this.#followUpOptions;
        this.#followUpOptions = undefined;
        if (followUp === undefined) return result;
        if (result.remaining === 0) return result;
        return this.flush(followUp);
      });
    }

    const operation = this.#flushOnce(options);
    const tracked = operation.finally(() => {
      if (this.#flushInFlight === tracked) this.#flushInFlight = undefined;
    });
    this.#flushInFlight = tracked;
    return tracked;
  }

  async #flushOnce(options: FlushOptions): Promise<FlushResult> {
    await this.#ready;
    await this.#persistenceWrites;
    const maximumBytes = options.keepalive ? MAX_KEEPALIVE_ENVELOPE_BYTES : undefined;
    const records = this.#queue.drain(100, maximumBytes, options.priority);
    if (records.length === 0) {
      return { sent: 0, remaining: this.#queue.size };
    }

    const envelope: Envelope = {
      version: ENVELOPE_VERSION,
      sentAt: Date.now(),
      items: records.map(({ event }) => ({ type: 'event', payload: event })),
    };

    try {
      const result = await this.#transport.send(envelope, options);
      await this.#runtime.durableQueue
        ?.remove(
          this.#scope,
          records.map(({ event }) => event.id),
        )
        .catch((error: unknown) => this.#report(error));
      return { sent: result.accepted, remaining: this.#queue.size };
    } catch (error) {
      const failure = this.#queue.retry(records);
      if (failure.dropped > 0) {
        this.#report(
          new Error(`Spectro stopped retrying ${failure.dropped} event(s) after repeated failures`),
        );
      }
      this.#persist(failure.retried.filter(({ priority }) => priority === 'immediate'));
      this.#removePersisted(
        failure.droppedRecords
          .filter(({ priority }) => priority === 'immediate')
          .map(({ event }) => event.id),
      );
      this.#runtime.onTransportFailure?.(error, options);
      this.#report(error);
      return { sent: 0, remaining: this.#queue.size };
    }
  }

  async #restoreQueue(): Promise<void> {
    const durableQueue = this.#runtime.durableQueue;
    if (durableQueue === undefined) return;
    try {
      const records = await durableQueue.load(this.#scope);
      const valid = records.filter(({ event }) => {
        const result = validateEvent(event);
        return result.success && serializedByteLength(result.data) <= MAX_EVENT_BYTES;
      });
      const restored = this.#queue.restore(valid);
      if (restored < valid.length) {
        this.#report(
          new Error(`Spectro could only restore ${restored} of ${valid.length} queued event(s)`),
        );
      }
      if (valid.length < records.length) {
        const invalidIds = records
          .filter(({ event }) => !valid.some((record) => record.event.id === event.id))
          .map(({ event }) => event.id);
        await durableQueue.remove(this.#scope, invalidIds);
      }
      if (valid.some(({ priority }) => priority === 'immediate')) {
        this.#runtime.onImmediateEvent?.();
      }
    } catch (error) {
      this.#report(error);
    }
  }

  #persist(records: readonly QueuedEventRecord[]): void {
    const durableQueue = this.#runtime.durableQueue;
    if (durableQueue === undefined || records.length === 0) return;
    this.#persistenceWrites = this.#persistenceWrites
      .then(async () => {
        await this.#ready;
        const dropped = await durableQueue.save(this.#scope, records);
        if (dropped > 0) {
          this.#report(
            new Error(`Spectro persistent outbox dropped ${dropped} event(s) at capacity`),
          );
        }
      })
      .catch((error: unknown) => this.#report(error));
  }

  #removePersisted(eventIds: readonly string[]): void {
    if (eventIds.length === 0) return;
    const durableQueue = this.#runtime.durableQueue;
    if (durableQueue === undefined) return;
    this.#persistenceWrites = this.#persistenceWrites
      .then(async () => {
        await this.#ready;
        await durableQueue.remove(this.#scope, eventIds);
      })
      .catch((error: unknown) => this.#report(error));
  }

  #report(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error('Unknown Spectro SDK error');
    try {
      this.#options.onError?.(normalized);
    } catch {
      // A customer callback cannot be allowed to escape into the host application.
    }
  }
}

function eventPriority(event: import('@spectro/protocol').SpectroEvent): 'immediate' | 'batch' {
  if (event.type === 'error') {
    const { mechanism, handled } = event.payload;
    if (
      !handled &&
      (mechanism === 'runtime' || mechanism === 'promise' || mechanism === 'manual')
    ) {
      return 'immediate';
    }
  }
  if (event.type === 'network' && !event.payload.success) {
    const status = event.payload.response?.status;
    if (status === 408 || (status !== undefined && status >= 500)) return 'immediate';
  }
  return 'batch';
}

function mergeFlushOptions(current: FlushOptions | undefined, next: FlushOptions): FlushOptions {
  return {
    ...(current?.keepalive || next.keepalive ? { keepalive: true } : {}),
    ...(current?.priority === 'immediate' || next.priority === 'immediate'
      ? { priority: 'immediate' }
      : current?.priority === 'batch' || next.priority === 'batch'
        ? { priority: 'batch' }
        : {}),
  };
}
