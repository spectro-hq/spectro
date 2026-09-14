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
import type {
  CaptureInput,
  ClientContextInput,
  FlushResult,
  SpectroClientOptions,
  SpectroClientPublic,
} from '@spectro/types';
import { v7 as uuidv7 } from 'uuid';

import { createEventContext } from './context.js';
import { SpectroValidationError } from './errors.js';
import { normalizeProperties } from './normalize.js';
import { EventQueue } from './queue.js';
import type { Transport } from './transport.js';

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

  constructor(options: SpectroClientOptions, transport: Transport) {
    this.#options = options;
    this.#transport = transport;
  }

  getContext(): EventContext {
    return createEventContext({ ...this.#options, ...this.#contextOverrides });
  }

  updateContext(context: ClientContextInput): void {
    this.#contextOverrides = { ...this.#contextOverrides, ...context };
  }

  capture(input: CaptureInput): string | undefined {
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

      this.#queue.enqueue(validation.data);
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

  async flush(): Promise<FlushResult> {
    const events = this.#queue.drain();
    if (events.length === 0) {
      return { sent: 0, remaining: 0 };
    }

    const envelope: Envelope = {
      version: ENVELOPE_VERSION,
      sentAt: Date.now(),
      items: events.map((payload) => ({ type: 'event', payload })),
    };

    try {
      const result = await this.#transport.send(envelope);
      return { sent: result.accepted, remaining: this.#queue.size };
    } catch (error) {
      this.#queue.prepend(events);
      this.#report(error);
      return { sent: 0, remaining: this.#queue.size };
    }
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
