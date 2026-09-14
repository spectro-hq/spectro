import type { AdmissionSource } from '@spectro/pipeline';

import type { EventProcessor, ProcessEnvelopeResult } from './processor.js';

export type ProcessorWorkResult =
  | { status: 'idle' }
  | ({ status: 'processed'; envelopeId: string } & ProcessEnvelopeResult);

export class ProcessorWorker {
  readonly #source: AdmissionSource;
  readonly #processor: EventProcessor;
  readonly #retryDelayMs: number;

  constructor(source: AdmissionSource, processor: EventProcessor, retryDelayMs: number = 1_000) {
    this.#source = source;
    this.#processor = processor;
    this.#retryDelayMs = retryDelayMs;
  }

  async runOnce(expiresMs?: number): Promise<ProcessorWorkResult> {
    const delivery = await this.#source.next(expiresMs);
    if (delivery === undefined) {
      return { status: 'idle' };
    }

    try {
      const result = await this.#processor.process(delivery.admitted.envelope);
      delivery.acknowledge();
      return {
        status: 'processed',
        envelopeId: delivery.admitted.envelopeId,
        ...result,
      };
    } catch (error) {
      delivery.retry(this.#retryDelayMs);
      throw error;
    }
  }
}
