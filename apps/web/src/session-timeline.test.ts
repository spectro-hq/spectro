import { describe, expect, it } from 'vitest';

import type { EventListItem } from './event-query.js';
import { formatSessionMetric, orderEventsChronologically } from './session-timeline.js';

function item(id: string, timestamp: number): EventListItem {
  return {
    event: {
      id,
      type: 'session',
      name: 'session_start',
      version: 1,
      timestamp,
      context: {
        sdk: { name: '@spectro/browser', version: '0.1.0' },
        project: { id: 'prj_test' },
        environment: 'test',
      },
      payload: {},
    },
    processing: { version: 1, envelopeSentAt: timestamp, processedAt: timestamp },
  };
}

describe('orderEventsChronologically', () => {
  it('uses ascending event IDs to preserve capture order when timestamps match', () => {
    const page = item('01a0d1f9-497d-716d-b3ee-cbb026ed2015', 1_000);
    const session = item('01a0d1f9-497c-75e6-9575-1cf6d173a90f', 1_000);
    const later = item('01a0d1f9-4989-70ac-940b-6ba50c3dd147', 1_001);
    expect(orderEventsChronologically([later, page, session])).toEqual([session, page, later]);
  });
});

describe('formatSessionMetric', () => {
  it('keeps performance readings legible without long floating-point tails', () => {
    expect(formatSessionMetric(198.90000000596046, 'ms')).toBe('199 ms');
    expect(formatSessionMetric(0.123456789, 'score')).toBe('0.12');
  });
});
