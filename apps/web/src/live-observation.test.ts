import { describe, expect, it } from 'vitest';
import { createIllustrativePage } from './illustrative-events.js';
import {
  emptyArrivalBuffer,
  observeArrivals,
  revealArrivals,
  observationFrom,
} from './live-observation.js';

const items = createIllustrativePage(1_800_000_000_000, 'prj_test', 'test').data;
describe('bounded arrival observation', () => {
  it('deduplicates overlap and replay by ID, retaining discovery rather than occurrence order', () => {
    const first = items[0]!;
    const late = items.at(-1)!;
    const state = observeArrivals(emptyArrivalBuffer(), [first, first], 100, false);
    const next = observeArrivals(state, [late, first], 200, false);
    expect(next.displayed.map((row) => row.item.event.id)).toEqual([late.event.id, first.event.id]);
    expect(next.displayed.map((row) => row.observedAt)).toEqual([200, 100]);
    expect(next.evicted).toBe(0);
  });
  it('freezes displayed rows while buffering arrivals and reveals them explicitly', () => {
    const state = observeArrivals(emptyArrivalBuffer(), items.slice(0, 2), 100, false);
    const paused = observeArrivals(state, items.slice(1, 4), 200, true);
    expect(paused.displayed).toEqual(state.displayed);
    expect(paused.pending.map((row) => row.item.event.id)).toEqual(
      items.slice(2, 4).map((item) => item.event.id),
    );
    const revealed = revealArrivals(paused);
    expect(revealed.displayed).toEqual([...paused.pending, ...state.displayed]);
    expect(revealed.pending).toEqual([]);
  });
  it('bounds both row and UTF-8 payload bytes and reports eviction without moving paused rows', () => {
    const state = observeArrivals(emptyArrivalBuffer(), items.slice(0, 2), 100, false, 3);
    const paused = observeArrivals(state, items.slice(2, 6), 200, true, 3);
    expect(paused.displayed).toEqual(state.displayed);
    expect(paused.pending).toHaveLength(1);
    expect(paused.evicted).toBe(3);
    const measured = observeArrivals(emptyArrivalBuffer(), [items[0]!], 100, false);
    const byteBound = observeArrivals(
      emptyArrivalBuffer(),
      items,
      200,
      false,
      500,
      measured.displayed[0]!.bytes,
    );
    expect(byteBound.displayed.reduce((sum, row) => sum + row.bytes, 0)).toBeLessThanOrEqual(
      measured.displayed[0]!.bytes,
    );
    expect(byteBound.evicted).toBeGreaterThan(0);
  });
  it('keeps retained payloads capped at 500 rows under sustained traffic', () => {
    const traffic = Array.from({ length: 1500 }, (_, index) => ({
      ...items[0]!,
      event: { ...items[0]!.event, id: `test-${index}` },
    }));
    const state = observeArrivals(emptyArrivalBuffer(), traffic, 100, false);
    expect(state.displayed).toHaveLength(500);
    expect(state.seen).toHaveLength(1000);
    expect(state.evicted).toBe(1000);
    expect(state.displayed[0]?.item.event.id).toBe('test-0');
  });
  it('restarts observation rather than catching up an unlimited absence', () => {
    expect(observationFrom(undefined, 100_000)).toBeUndefined();
    expect(observationFrom(100_000, 110_000)).toBe(40_000);
    expect(observationFrom(100_000, 161_000)).toBeUndefined();
  });
});
