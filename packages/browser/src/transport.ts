import { MAX_ENVELOPE_BYTES, serializedByteLength, type Envelope } from '@spectro/protocol';
import {
  MAX_KEEPALIVE_ENVELOPE_BYTES,
  type FlushOptions,
  type TransportResult,
} from '@spectro/types';
import type { Transport } from '@spectro/core';

import { SpectroTransportError } from '@spectro/core';

export interface FetchTransportOptions {
  endpoint: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

export class FetchTransport implements Transport {
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: FetchTransportOptions) {
    this.#endpoint = options.endpoint.replace(/\/$/, '');
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async send(envelope: Envelope, options: FlushOptions = {}): Promise<TransportResult> {
    const envelopeBytes = serializedByteLength(envelope);
    if (envelopeBytes > MAX_ENVELOPE_BYTES) {
      throw new SpectroTransportError(`Envelope exceeds the ${MAX_ENVELOPE_BYTES}-byte limit`);
    }
    if (options.keepalive && envelopeBytes > MAX_KEEPALIVE_ENVELOPE_BYTES) {
      throw new SpectroTransportError(
        `Keepalive envelope exceeds the ${MAX_KEEPALIVE_ENVELOPE_BYTES}-byte limit`,
      );
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.#endpoint}/v1/envelope`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-spectro-key': this.#apiKey,
        },
        body: JSON.stringify(envelope),
        ...(options.keepalive ? { keepalive: true } : {}),
      });
    } catch (error) {
      throw new SpectroTransportError(
        `Failed to send Spectro envelope: ${error instanceof Error ? error.message : 'unknown transport error'}`,
      );
    }

    if (!response.ok) {
      throw new SpectroTransportError(
        `Spectro ingestion rejected the envelope with HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as { accepted?: unknown };
    if (typeof body.accepted !== 'number') {
      throw new SpectroTransportError('Spectro ingestion returned an invalid response');
    }

    return { accepted: body.accepted };
  }
}
