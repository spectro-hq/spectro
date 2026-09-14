import type { SpectroEvent } from '@spectro/protocol';

export class EventQueue {
  readonly #events: SpectroEvent[] = [];

  enqueue(event: SpectroEvent): void {
    this.#events.push(event);
  }

  drain(limit = 100): SpectroEvent[] {
    return this.#events.splice(0, limit);
  }

  prepend(events: SpectroEvent[]): void {
    this.#events.unshift(...events);
  }

  get size(): number {
    return this.#events.length;
  }
}
