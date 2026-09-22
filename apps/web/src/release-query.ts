import { z } from 'zod';

import { isTimeRange, type DataSource, type TimeRange } from './event-query.js';

const releaseHealthSchema = z.object({
  release: z.string().min(1).max(128),
  eventCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  affectedSessionCount: z.number().int().nonnegative(),
  poorPerformanceCount: z.number().int().nonnegative(),
  networkFailureCount: z.number().int().nonnegative(),
  firstSeen: z.number().int().nonnegative(),
  lastSeen: z.number().int().nonnegative(),
  latestEventId: z.string(),
});

const releasePageSchema = z.object({
  data: z.array(releaseHealthSchema),
  nextCursor: z.string().optional(),
});

export type ReleaseHealth = z.infer<typeof releaseHealthSchema>;
export type ReleasePage = z.infer<typeof releasePageSchema>;

export interface ReleaseSearch {
  readonly project: string;
  readonly environment: string;
  readonly range: TimeRange;
  readonly source: DataSource;
}

export function parseReleaseSearch(search: Record<string, unknown>): ReleaseSearch {
  const project =
    typeof search.project === 'string' && /^prj_[A-Za-z0-9_-]{1,120}$/.test(search.project)
      ? search.project
      : 'prj_checkout';
  const environment =
    typeof search.environment === 'string' &&
    search.environment.length > 0 &&
    search.environment.length <= 64
      ? search.environment
      : 'production';
  const range =
    typeof search.range === 'string' && isTimeRange(search.range) ? search.range : '24h';
  return {
    project,
    environment,
    range,
    source: search.source === 'live' ? 'live' : 'illustrative',
  };
}

export function buildReleaseQueryUrl(input: {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly cursor?: string;
  readonly limit?: number;
}): string {
  const parameters = new URLSearchParams({
    environment: input.environment,
    from: String(input.from),
    to: String(input.to),
    limit: String(input.limit ?? 20),
  });
  if (input.cursor) parameters.set('cursor', input.cursor);
  return `/v1/projects/${encodeURIComponent(input.projectId)}/releases?${parameters.toString()}`;
}

export async function fetchReleasePage(input: {
  readonly query: Parameters<typeof buildReleaseQueryUrl>[0];
  readonly token: string;
  readonly signal?: AbortSignal;
}): Promise<ReleasePage> {
  const response = await fetch(buildReleaseQueryUrl(input.query), {
    headers: { authorization: `Bearer ${input.token}` },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    let message = `Release query failed with status ${response.status}.`;
    const body: unknown = await response.json().catch(() => undefined);
    const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    if (error.success) message = error.data.error.message;
    throw new Error(message);
  }
  return releasePageSchema.parse(await response.json());
}
