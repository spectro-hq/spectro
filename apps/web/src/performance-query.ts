import { z } from 'zod';

import { isTimeRange, type DataSource, type TimeRange } from './event-query.js';

export const performanceMetricSchema = z.enum([
  'lcp',
  'inp',
  'cls',
  'fcp',
  'ttfb',
  'long_task',
  'navigation',
  'resource_timing',
]);

const performanceGroupSchema = z.object({
  metric: performanceMetricSchema,
  unit: z.enum(['ms', 'score']),
  pagePath: z.string().optional(),
  sampleCount: z.number().int().nonnegative(),
  affectedSessionCount: z.number().int().nonnegative(),
  average: z.number().nonnegative(),
  p75: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  goodCount: z.number().int().nonnegative(),
  needsImprovementCount: z.number().int().nonnegative(),
  poorCount: z.number().int().nonnegative(),
  firstSeen: z.number().int().nonnegative(),
  lastSeen: z.number().int().nonnegative(),
  latestEventId: z.string(),
  latestRelease: z.string().optional(),
});

const performancePageSchema = z.object({
  data: z.array(performanceGroupSchema),
  nextCursor: z.string().optional(),
});

export type PerformanceMetric = z.infer<typeof performanceMetricSchema>;
export type PerformanceGroup = z.infer<typeof performanceGroupSchema>;
export type PerformancePage = z.infer<typeof performancePageSchema>;

export interface PerformanceSearch {
  readonly project: string;
  readonly environment: string;
  readonly range: TimeRange;
  readonly source: DataSource;
  readonly metric?: PerformanceMetric | undefined;
  readonly pagePath?: string | undefined;
  readonly release?: string | undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

export function parsePerformanceSearch(search: Record<string, unknown>): PerformanceSearch {
  const project =
    typeof search.project === 'string' && /^prj_[A-Za-z0-9_-]{1,120}$/.test(search.project)
      ? search.project
      : 'prj_checkout';
  const environment = boundedString(search.environment, 64) ?? 'production';
  const range =
    typeof search.range === 'string' && isTimeRange(search.range) ? search.range : '24h';
  const metric = performanceMetricSchema.safeParse(search.metric);
  const pagePath = boundedString(search.pagePath, 2_048);
  const release = boundedString(search.release, 128);
  return {
    project,
    environment,
    range,
    source: search.source === 'live' ? 'live' : 'illustrative',
    ...(metric.success ? { metric: metric.data } : {}),
    ...(pagePath ? { pagePath } : {}),
    ...(release ? { release } : {}),
  };
}

export interface PerformanceQueryInput {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly metric?: PerformanceMetric;
  readonly pagePath?: string;
  readonly release?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export function buildPerformanceQueryUrl(input: PerformanceQueryInput): string {
  const parameters = new URLSearchParams({
    environment: input.environment,
    from: String(input.from),
    to: String(input.to),
    limit: String(input.limit ?? 50),
  });
  for (const [key, value] of [
    ['metric', input.metric],
    ['pagePath', input.pagePath],
    ['release', input.release],
    ['cursor', input.cursor],
  ] as const) {
    if (value !== undefined) parameters.set(key, value);
  }
  return `/v1/projects/${encodeURIComponent(input.projectId)}/performance?${parameters.toString()}`;
}

export async function fetchPerformancePage(input: {
  readonly query: PerformanceQueryInput;
  readonly token: string;
  readonly signal?: AbortSignal;
}): Promise<PerformancePage> {
  const response = await fetch(buildPerformanceQueryUrl(input.query), {
    headers: { authorization: `Bearer ${input.token}` },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    let message = `Performance query failed with status ${response.status}.`;
    const body: unknown = await response.json().catch(() => undefined);
    const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    if (error.success) message = error.data.error.message;
    throw new Error(message);
  }
  return performancePageSchema.parse(await response.json());
}
