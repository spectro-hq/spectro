import {
  ENVELOPE_VERSION,
  MAX_ENVELOPE_BYTES,
  serializedByteLength,
  type Envelope,
  type SpectroEvent,
} from '@spectro/protocol';
import type { DeliveryPriority, QueuedEventRecord } from '@spectro/types';

const MAX_QUEUED_EVENTS = 500;
const MAX_QUEUED_BYTES = 4 * 1_024 * 1_024;
const MAX_DELIVERY_ATTEMPTS = 8;
const MAX_CONTEXT_EVENTS = 8;
const CONTEXT_WINDOW_MS = 10_000;

interface QueueEntry extends QueuedEventRecord {
  bytes: number;
}

export interface EnqueueResult {
  accepted: boolean;
  dropped: number;
  droppedRecords: QueuedEventRecord[];
}

export interface FailedDrainResult {
  retried: QueuedEventRecord[];
  dropped: number;
  droppedRecords: QueuedEventRecord[];
}

export interface PrependResult {
  dropped: number;
  droppedRecords: QueuedEventRecord[];
}

function eventBytes(event: SpectroEvent): number {
  return serializedByteLength(event);
}

function sessionId(event: SpectroEvent): string | undefined {
  return event.context.session?.id;
}

function pageId(event: SpectroEvent): string | undefined {
  return event.context.page?.id;
}

export class EventQueue {
  readonly #events: QueueEntry[] = [];
  #bytes = 0;

  enqueue(event: SpectroEvent, priority: DeliveryPriority = 'batch', attempts = 0): EnqueueResult {
    const bytes = eventBytes(event);
    let dropped = 0;
    const droppedRecords: QueuedEventRecord[] = [];
    while (this.#events.length >= MAX_QUEUED_EVENTS || this.#bytes + bytes > MAX_QUEUED_BYTES) {
      const evictionIndex = this.#events.findIndex((entry) => entry.priority === 'batch');
      const index = evictionIndex >= 0 ? evictionIndex : priority === 'immediate' ? 0 : -1;
      if (index < 0) return { accepted: false, dropped: dropped + 1, droppedRecords };
      const evicted = this.#removeAt(index);
      droppedRecords.push({
        event: evicted.event,
        priority: evicted.priority,
        attempts: evicted.attempts,
      });
      dropped += 1;
    }

    this.#events.push({ event, priority, attempts, bytes });
    this.#bytes += bytes;
    return { accepted: true, dropped, droppedRecords };
  }

  restore(records: readonly QueuedEventRecord[]): number {
    let restored = 0;
    for (const record of records) {
      if (this.#events.some((entry) => entry.event.id === record.event.id)) continue;
      const result = this.enqueue(record.event, record.priority, record.attempts);
      if (result.accepted) restored += 1;
    }
    return restored;
  }

  drain(
    limit = 100,
    maximumBytes = MAX_ENVELOPE_BYTES,
    priority: DeliveryPriority | undefined = undefined,
  ): QueuedEventRecord[] {
    const selected = priority === 'immediate' ? this.#selectImmediate() : undefined;
    const candidates = selected ?? this.#events.map((_entry, index) => index);
    const indices: number[] = [];
    const envelope: Envelope = { version: ENVELOPE_VERSION, sentAt: Date.now(), items: [] };

    for (const index of candidates) {
      if (indices.length >= limit) break;
      const entry = this.#events[index];
      if (entry === undefined) continue;
      envelope.items.push({ type: 'event', payload: entry.event });
      if (serializedByteLength(envelope) > maximumBytes) {
        envelope.items.pop();
        continue;
      }
      indices.push(index);
    }

    const selectedIndices = new Set(indices);
    const removed = this.#events.filter((_entry, index) => selectedIndices.has(index));
    const retained = this.#events.filter((_entry, index) => !selectedIndices.has(index));
    this.#events.splice(0, this.#events.length, ...retained);
    for (const entry of removed) this.#bytes -= entry.bytes;
    return removed.map(({ event, priority: deliveryPriority, attempts }) => ({
      event,
      priority: deliveryPriority,
      attempts,
    }));
  }

  prepend(records: readonly QueuedEventRecord[]): PrependResult {
    let dropped = 0;
    const droppedRecords: QueuedEventRecord[] = [];
    for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
      const record = records[recordIndex];
      if (record === undefined) continue;
      const bytes = eventBytes(record.event);
      while (this.#events.length >= MAX_QUEUED_EVENTS || this.#bytes + bytes > MAX_QUEUED_BYTES) {
        const evictionIndex = this.#events.findIndex((entry) => entry.priority === 'batch');
        const index = evictionIndex >= 0 ? evictionIndex : 0;
        if (this.#events.length === 0) {
          dropped += 1;
          droppedRecords.push(record);
          break;
        }
        const evicted = this.#removeAt(index);
        droppedRecords.push({
          event: evicted.event,
          priority: evicted.priority,
          attempts: evicted.attempts,
        });
        dropped += 1;
      }
      if (bytes > MAX_QUEUED_BYTES) {
        dropped += 1;
        droppedRecords.push(record);
        continue;
      }
      this.#events.unshift({ ...record, bytes });
      this.#bytes += bytes;
    }
    return { dropped, droppedRecords };
  }

  retry(records: readonly QueuedEventRecord[]): FailedDrainResult {
    const retried: QueuedEventRecord[] = [];
    const droppedRecords: QueuedEventRecord[] = [];
    let dropped = 0;
    for (const record of records) {
      const attempts = record.attempts + 1;
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        dropped += 1;
        droppedRecords.push({ ...record, attempts });
      } else {
        retried.push({ ...record, attempts });
      }
    }
    const prepended = this.prepend(retried);
    dropped += prepended.dropped;
    droppedRecords.push(...prepended.droppedRecords);
    return { retried, dropped, droppedRecords };
  }

  get size(): number {
    return this.#events.length;
  }

  #selectImmediate(): number[] {
    const urgent = this.#events.flatMap((entry, index) =>
      entry.priority === 'immediate' ? [index] : [],
    );
    const selected = new Set(urgent);

    for (const urgentIndex of urgent) {
      const urgentEntry = this.#events[urgentIndex];
      if (urgentEntry === undefined) continue;
      const urgentEvent = urgentEntry.event;
      const urgentSession = sessionId(urgentEvent);
      const urgentPage = pageId(urgentEvent);
      if (urgentSession === undefined || urgentPage === undefined) continue;
      let contextCount = 0;
      for (
        let index = urgentIndex - 1;
        index >= 0 && contextCount < MAX_CONTEXT_EVENTS;
        index -= 1
      ) {
        const entry = this.#events[index];
        if (
          entry?.priority === 'batch' &&
          sessionId(entry.event) === urgentSession &&
          pageId(entry.event) === urgentPage &&
          entry.event.timestamp <= urgentEvent.timestamp &&
          urgentEvent.timestamp - entry.event.timestamp <= CONTEXT_WINDOW_MS
        ) {
          selected.add(index);
          contextCount += 1;
        }
      }
    }

    const ordered: number[] = [];
    for (let index = 0; index < this.#events.length; index += 1) {
      if (selected.has(index) && this.#events[index]?.priority === 'immediate') ordered.push(index);
    }
    for (let index = 0; index < this.#events.length; index += 1) {
      if (selected.has(index) && this.#events[index]?.priority === 'batch') ordered.push(index);
    }
    return ordered;
  }

  #removeAt(index: number): QueueEntry {
    const [entry] = this.#events.splice(index, 1);
    if (entry === undefined) throw new Error('Queue entry disappeared');
    this.#bytes -= entry.bytes;
    return entry;
  }
}
