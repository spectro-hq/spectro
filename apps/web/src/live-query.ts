import { z } from 'zod';
import { apiReadHeaders } from './auth-client.js';
import { eventListPageSchema, EventQueryError, type ExplorerSearch } from './event-query.js';

const livePageSchema = eventListPageSchema.extend({
  from: z.number().int().nonnegative().safe(),
  to: z.number().int().nonnegative().safe(),
  observedAt: z.number().int().nonnegative().safe(),
});
export type LivePage = z.infer<typeof livePageSchema>;
export interface ObservationResult {
  readonly data: LivePage['data'];
  readonly observedAt: number;
  readonly truncated: boolean;
}
export async function fetchObservation(input: {
  readonly search: ExplorerSearch;
  readonly token: string;
  readonly from?: number;
  readonly signal: AbortSignal;
}): Promise<ObservationResult> {
  const parameters = new URLSearchParams({ environment: input.search.environment });
  if (input.from !== undefined) parameters.set('from', String(input.from));
  for (const key of ['type', 'name', 'sessionId'] as const) {
    const value = input.search[key];
    if (value) parameters.set(key, value);
  }
  const data: LivePage['data'] = [];
  let observedAt = 0;
  let truncated = false;
  let bytes = 0;
  for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
    // oxlint-disable-next-line no-await-in-loop -- The next cursor is only available after the preceding page completes.
    const response = await fetch(
      `/v1/projects/${encodeURIComponent(input.search.project)}/live?${parameters}`,
      {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: apiReadHeaders(input.token),
        signal: input.signal,
      },
    );
    if (!response.ok)
      throw new EventQueryError('Live observation could not be updated.', response.status);
    // oxlint-disable-next-line no-await-in-loop -- Validate this page before fetching its cursor successor.
    const text = await response.text();
    bytes += new TextEncoder().encode(text).byteLength;
    if (bytes > 8 * 1024 * 1024) {
      truncated = true;
      break;
    }
    const page = livePageSchema.parse(JSON.parse(text));
    if (
      page.data.some(
        (item) =>
          item.event.context.project.id !== input.search.project ||
          item.event.context.environment !== input.search.environment,
      )
    ) {
      throw new Error('Observation scope mismatch');
    }
    // Anchor the next overlap to the snapshot, not the end of a multi-page drain.
    if (pageNumber === 0) observedAt = page.to;
    data.push(...page.data);
    if (!page.nextCursor) {
      truncated = false;
      break;
    }
    parameters.set('from', String(page.from));
    parameters.set('to', String(page.to));
    parameters.set('cursor', page.nextCursor);
    truncated = true;
  }
  return { data, observedAt, truncated };
}
