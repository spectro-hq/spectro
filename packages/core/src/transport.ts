import type { Envelope } from '@spectro/protocol';
import type { TransportResult } from '@spectro/types';

export interface Transport {
  send(envelope: Envelope): Promise<TransportResult>;
}
