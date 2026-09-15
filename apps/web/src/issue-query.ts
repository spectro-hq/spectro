import { z } from 'zod';

import { isEventName, isTimeRange, type DataSource, type TimeRange } from './event-query.js';

const issueSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string().optional(),
  message: z.string(),
  occurrenceCount: z.number().int().nonnegative(),
  affectedSessionCount: z.number().int().nonnegative(),
  affectedUserCount: z.number().int().nonnegative(),
  firstSeen: z.number().int().nonnegative(),
  lastSeen: z.number().int().nonnegative(),
  latestEventId: z.string(),
  latestPagePath: z.string().optional(),
  latestRelease: z.string().optional(),
});

const issuePageSchema = z.object({
  data: z.array(issueSchema),
  nextCursor: z.string().optional(),
});

export type ErrorIssue = z.infer<typeof issueSchema>;
export type IssuePage = z.infer<typeof issuePageSchema>;

export interface IssueSearch {
  readonly project: string;
  readonly environment: string;
  readonly range: TimeRange;
  readonly source: DataSource;
  readonly name?: string | undefined;
  readonly release?: string | undefined;
  readonly issue?: string | undefined;
}

function optionalBoundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

export function parseIssueSearch(search: Record<string, unknown>): IssueSearch {
  const project =
    typeof search.project === 'string' && /^prj_[A-Za-z0-9_-]{1,120}$/.test(search.project)
      ? search.project
      : 'prj_checkout';
  const environment = optionalBoundedString(search.environment, 64) ?? 'production';
  const range =
    typeof search.range === 'string' && isTimeRange(search.range) ? search.range : '24h';
  const name = optionalBoundedString(search.name, 64);
  const release = optionalBoundedString(search.release, 128);
  const issue = optionalBoundedString(search.issue, 32);

  return {
    project,
    environment,
    range,
    source: search.source === 'live' ? 'live' : 'illustrative',
    ...(name !== undefined && isEventName(name) ? { name } : {}),
    ...(release === undefined ? {} : { release }),
    ...(issue !== undefined && /^[0-9a-f]{32}$/.test(issue) ? { issue } : {}),
  };
}

export interface IssueQueryInput {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly name?: string;
  readonly release?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export function buildIssueQueryUrl(input: IssueQueryInput): string {
  const parameters = new URLSearchParams({
    environment: input.environment,
    from: String(input.from),
    to: String(input.to),
    limit: String(input.limit ?? 50),
  });
  for (const [key, value] of [
    ['name', input.name],
    ['release', input.release],
    ['cursor', input.cursor],
  ] as const) {
    if (value !== undefined) parameters.set(key, value);
  }
  return `/v1/projects/${encodeURIComponent(input.projectId)}/issues?${parameters.toString()}`;
}

export async function fetchIssuePage(input: {
  readonly query: IssueQueryInput;
  readonly token: string;
  readonly signal?: AbortSignal;
}): Promise<IssuePage> {
  const response = await fetch(buildIssueQueryUrl(input.query), {
    headers: { authorization: `Bearer ${input.token}` },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (!response.ok) {
    let message = `Issue query failed with status ${response.status}.`;
    const body: unknown = await response.json().catch(() => undefined);
    const errorBody = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    if (errorBody.success) message = errorBody.data.error.message;
    throw new Error(message);
  }
  return issuePageSchema.parse(await response.json());
}
