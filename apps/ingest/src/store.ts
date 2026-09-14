import type { Envelope, SpectroEvent } from '@spectro/protocol';
import type { AdmissionSink } from '@spectro/pipeline';

export type EventStore = AdmissionSink;

export class InMemoryEventStore implements EventStore {
  readonly #events: SpectroEvent[] = [];

  async append(envelope: Envelope): Promise<void> {
    this.#events.push(...envelope.items.map((item) => item.payload));
  }

  all(): readonly SpectroEvent[] {
    return this.#events;
  }
}
