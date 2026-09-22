import { z } from 'zod';

import { isTimeRange, type DataSource, type TimeRange } from './event-query.js';

export const networkInitiatorSchema = z.enum(['fetch', 'xhr', 'resource']);

const networkGroupSchema = z.object({
  initiator: networkInitiatorSchema,
  method: z.string(),
  url: z.string(),
  pagePath: z.string().optional(),
  requestCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  affectedSessionCount: z.number().int().nonnegative(),
  averageDuration: z.number().nonnegative(),
  p75Duration: z.number().nonnegative(),
  p95Duration: z.number().nonnegative(),
  status2xxCount: z.number().int().nonnegative(),
  status3xxCount: z.number().int().nonnegative(),
  status4xxCount: z.number().int().nonnegative(),
  status5xxCount: z.number().int().nonnegative(),
  transportFailureCount: z.number().int().nonnegative(),
  firstSeen: z.number().int().nonnegative(),
  lastSeen: z.number().int().nonnegative(),
  latestEventId: z.string(),
  latestStatus: z.number().int().nonnegative().optional(),
  latestRelease: z.string().optional(),
});

const networkPageSchema = z.object({
  data: z.array(networkGroupSchema),
  nextCursor: z.string().optional(),
});

export type NetworkInitiator = z.infer<typeof networkInitiatorSchema>;
export type NetworkGroup = z.infer<typeof networkGroupSchema>;
export type NetworkPage = z.infer<typeof networkPageSchema>;

export function formatNetworkTarget(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
    return `${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}

export interface NetworkSearch {
  readonly project: string;
  readonly environment: string;
  readonly range: TimeRange;
  readonly source: DataSource;
  readonly initiator?: NetworkInitiator | undefined;
  readonly method?: string | undefined;
  readonly success?: boolean | undefined;
  readonly pagePath?: string | undefined;
  readonly release?: string | undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

export function parseNetworkSearch(search: Record<string, unknown>): NetworkSearch {
  const project =
    typeof search.project === 'string' && /^prj_[A-Za-z0-9_-]{1,120}$/.test(search.project)
      ? search.project
      : 'prj_checkout';
  const environment = boundedString(search.environment, 64) ?? 'production';
  const range =
    typeof search.range === 'string' && isTimeRange(search.range) ? search.range : '24h';
  const initiator = networkInitiatorSchema.safeParse(search.initiator);
  const method = boundedString(search.method, 16);
  const pagePath = boundedString(search.pagePath, 2_048);
  const release = boundedString(search.release, 128);
  return {
    project,
    environment,
    range,
    source: search.source === 'live' ? 'live' : 'illustrative',
    ...(initiator.success ? { initiator: initiator.data } : {}),
    ...(method && /^[A-Z]{1,16}$/.test(method) ? { method } : {}),
    ...(search.success === true || search.success === 'true' ? { success: true } : {}),
    ...(search.success === false || search.success === 'false' ? { success: false } : {}),
    ...(pagePath ? { pagePath } : {}),
    ...(release ? { release } : {}),
  };
}

export interface NetworkQueryInput {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly initiator?: NetworkInitiator;
  readonly method?: string;
  readonly success?: boolean;
  readonly pagePath?: string;
  readonly release?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export function buildNetworkQueryUrl(input: NetworkQueryInput): string {
  const parameters = new URLSearchParams({
    environment: input.environment,
    from: String(input.from),
    to: String(input.to),
    limit: String(input.limit ?? 50),
  });
  for (const [key, value] of [
    ['initiator', input.initiator],
    ['method', input.method],
    ['success', input.success === undefined ? undefined : String(input.success)],
    ['pagePath', input.pagePath],
    ['release', input.release],
    ['cursor', input.cursor],
  ] as const) {
    if (value !== undefined) parameters.set(key, value);
  }
  return `/v1/projects/${encodeURIComponent(input.projectId)}/network?${parameters.toString()}`;
}

export async function fetchNetworkPage(input: {
  readonly query: NetworkQueryInput;
  readonly token: string;
  readonly signal?: AbortSignal;
}): Promise<NetworkPage> {
  const response = await fetch(buildNetworkQueryUrl(input.query), {
    headers: { authorization: `Bearer ${input.token}` },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    let message = `Network query failed with status ${response.status}.`;
    const body: unknown = await response.json().catch(() => undefined);
    const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    if (error.success) message = error.data.error.message;
    throw new Error(message);
  }
  return networkPageSchema.parse(await response.json());
}
