import { SpectroClient } from '@spectro/core';
import type { JSONObject } from '@spectro/protocol';
import type { FlushResult, SpectroClientOptions, SpectroClientPublic } from '@spectro/types';

import { FetchTransport } from './transport.js';

let client: SpectroClientPublic | undefined;

export function init(options: SpectroClientOptions): SpectroClientPublic | undefined {
  try {
    client = new SpectroClient(options, new FetchTransport(options));
    return client;
  } catch (error) {
    client = undefined;
    const normalized =
      error instanceof Error ? error : new Error('Unknown Spectro initialization error');
    try {
      (options as SpectroClientOptions | undefined)?.onError?.(normalized);
    } catch {
      // A customer callback cannot be allowed to escape into the host application.
    }
    return undefined;
  }
}

export function track(name: string, properties: JSONObject = {}): string | undefined {
  if (!client) {
    return undefined;
  }
  return client.track(name, properties);
}

export async function flush(): Promise<FlushResult> {
  if (!client) {
    return { sent: 0, remaining: 0 };
  }
  return client.flush();
}

export { FetchTransport } from './transport.js';
export type { FetchTransportOptions } from './transport.js';
export type { JSONObject, SpectroClientOptions, SpectroClientPublic };
