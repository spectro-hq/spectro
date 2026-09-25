import type { AdmissionSource } from '@spectro/pipeline';

import type { EventProcessor, ProcessEnvelopeResult } from './processor.js';

export type ProcessorWorkResult =
  | { status: 'idle' }
  | ({ status: 'processed'; envelopeId: string } & ProcessEnvelopeResult);

export interface ProcessorRetryNotice {
  envelopeId: string;
  retryDelayMs: number;
}

export class ProcessorWorker {
  readonly #source: AdmissionSource;
  readonly #processor: EventProcessor;
  readonly #retryDelayMs: number;
  readonly #onRetry: ((notice: ProcessorRetryNotice) => void) | undefined;

  constructor(
    source: AdmissionSource,
    processor: EventProcessor,
    retryDelayMs: number = 1_000,
    onRetry?: (notice: ProcessorRetryNotice) => void,
  ) {
    this.#source = source;
    this.#processor = processor;
    this.#retryDelayMs = retryDelayMs;
    this.#onRetry = onRetry;
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
      try {
        this.#onRetry?.({
          envelopeId: delivery.admitted.envelopeId,
          retryDelayMs: this.#retryDelayMs,
        });
      } catch {
        // A diagnostic hook must not replace the processing error or change delivery.
      }
      throw error;
    }
  }
}
