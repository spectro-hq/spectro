import type { EventListItem } from './event-query.js';

export function orderEventsChronologically(events: readonly EventListItem[]): EventListItem[] {
  const ordered: EventListItem[] = [];
  for (const item of events) {
    const insertionIndex = ordered.findIndex(
      (candidate) =>
        candidate.event.timestamp > item.event.timestamp ||
        (candidate.event.timestamp === item.event.timestamp &&
          candidate.event.id.localeCompare(item.event.id) > 0),
    );
    if (insertionIndex === -1) ordered.push(item);
    else ordered.splice(insertionIndex, 0, item);
  }
  return ordered;
}

export function formatSessionMetric(value: number, unit: unknown): string {
  const displayValue =
    unit === 'ms'
      ? Math.round(value).toLocaleString()
      : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
  return `${displayValue}${unit === 'ms' ? ' ms' : unit === 'score' ? '' : typeof unit === 'string' ? ` ${unit}` : ''}`;
}
