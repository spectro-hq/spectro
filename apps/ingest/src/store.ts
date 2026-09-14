import type { Envelope, SpectroEvent } from '@spectro/protocol';

export interface EventStore {
  append(envelope: Envelope): Promise<void>;
}

export class InMemoryEventStore implements EventStore {
  readonly #events: SpectroEvent[] = [];

  async append(envelope: Envelope): Promise<void> {
    this.#events.push(...envelope.items.map((item) => item.payload));
  }

  all(): readonly SpectroEvent[] {
    return this.#events;
  }
}
