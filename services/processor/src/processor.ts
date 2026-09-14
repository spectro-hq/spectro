import type { Envelope, SpectroEvent } from '@spectro/protocol';

import { createErrorFingerprint } from './fingerprint.js';

export const PROCESSING_VERSION = 1 as const;

export interface ProcessingMetadata {
  version: typeof PROCESSING_VERSION;
  envelopeSentAt: number;
  processedAt: number;
  errorFingerprint?: string;
}

export interface ProcessedEvent {
  event: SpectroEvent;
  processing: ProcessingMetadata;
}

export interface ProcessedEventWriter {
  /** Resolves only after every event in the batch is durably committed. */
  append(events: readonly ProcessedEvent[]): Promise<void>;
}

export interface ProcessEnvelopeResult {
  processed: number;
}

export type ProcessorClock = () => number;

function processEvent(
  event: SpectroEvent,
  envelopeSentAt: number,
  processedAt: number,
): ProcessedEvent {
  const common = { version: PROCESSING_VERSION, envelopeSentAt, processedAt } as const;
  if (event.type !== 'error') {
    return { event, processing: common };
  }

  return {
    event,
    processing: {
      ...common,
      errorFingerprint: createErrorFingerprint(event.payload),
    },
  };
}

export class EventProcessor {
  readonly #writer: ProcessedEventWriter;
  readonly #clock: ProcessorClock;

  constructor(writer: ProcessedEventWriter, clock: ProcessorClock = Date.now) {
    this.#writer = writer;
    this.#clock = clock;
  }

  async process(envelope: Envelope): Promise<ProcessEnvelopeResult> {
    const processedAt = this.#clock();
    const events = envelope.items.map((item) =>
      processEvent(item.payload, envelope.sentAt, processedAt),
    );
    await this.#writer.append(events);
    return { processed: events.length };
  }
}
