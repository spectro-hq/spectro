import type { Envelope } from '@spectro/protocol';
import type { FlushOptions, TransportResult } from '@spectro/types';

export interface Transport {
  send(envelope: Envelope, options?: FlushOptions): Promise<TransportResult>;
}
