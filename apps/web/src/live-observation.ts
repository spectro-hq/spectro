import type { EventListItem } from './event-query.js';

export const LIVE_INTERVAL_MS = 3_000;
export const LIVE_OVERLAP_MS = 60_000;
export const LIVE_MAX_ROWS = 500;
export const LIVE_MAX_BYTES = 8 * 1024 * 1024;
export interface Arrival {
  readonly item: EventListItem;
  readonly observedAt: number;
  readonly bytes: number;
}
export interface ArrivalBuffer {
  readonly displayed: readonly Arrival[];
  readonly pending: readonly Arrival[];
  readonly seen: readonly string[];
  readonly evicted: number;
}
export function emptyArrivalBuffer(): ArrivalBuffer {
  return { displayed: [], pending: [], seen: [], evicted: 0 };
}
export function observeArrivals(
  state: ArrivalBuffer,
  items: readonly EventListItem[],
  observedAt: number,
  paused: boolean,
  maxRows = LIVE_MAX_ROWS,
  maxBytes = LIVE_MAX_BYTES,
): ArrivalBuffer {
  const seen = new Set([
    ...state.seen,
    ...state.displayed.map((row) => row.item.event.id),
    ...state.pending.map((row) => row.item.event.id),
  ]);
  const fresh: Arrival[] = [];
  for (const item of items) {
    if (seen.has(item.event.id)) continue;
    seen.add(item.event.id);
    fresh.push({
      item,
      observedAt,
      bytes: new TextEncoder().encode(JSON.stringify(item)).byteLength,
    });
  }
  // Poll results arrive newest-first. Groups remain in discovery order, not occurrence order.
  let displayed = paused ? [...state.displayed] : [...fresh, ...state.pending, ...state.displayed];
  let pending = paused ? [...fresh, ...state.pending] : [];
  let bytes = [...displayed, ...pending].reduce((sum, row) => sum + row.bytes, 0);
  let evicted = state.evicted;
  while (displayed.length + pending.length > maxRows || bytes > maxBytes) {
    // A reading pause never moves existing rows. Drop pending arrivals when capacity is full.
    const removed = paused ? pending.pop() : displayed.pop();
    if (!removed) break;
    bytes -= removed.bytes;
    evicted++;
  }
  return { displayed, pending, seen: [...seen].slice(-1000), evicted };
}
export function revealArrivals(state: ArrivalBuffer): ArrivalBuffer {
  return { ...state, displayed: [...state.pending, ...state.displayed], pending: [] };
}
export function observationFrom(
  lastObservedAt: number | undefined,
  now: number,
): number | undefined {
  return lastObservedAt === undefined || now - lastObservedAt > LIVE_OVERLAP_MS
    ? undefined
    : Math.max(0, lastObservedAt - LIVE_OVERLAP_MS);
}
