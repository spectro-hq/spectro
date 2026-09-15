import type { EventType } from '@spectro/protocol';
import { z } from 'zod';

const eventTypeSchema = z.enum([
  'session',
  'page',
  'error',
  'performance',
  'network',
  'interaction',
  'custom',
]);

const contextSchema = z
  .object({
    sdk: z.object({ name: z.string(), version: z.string() }),
    project: z.object({ id: z.string() }),
    environment: z.string(),
    session: z.object({ id: z.string(), startedAt: z.number().optional() }).optional(),
    user: z
      .object({
        id: z.string().optional(),
        anonymousId: z.string(),
        traits: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    page: z
      .object({
        id: z.string(),
        url: z.string(),
        path: z.string(),
        title: z.string().optional(),
        referrer: z.string().optional(),
      })
      .optional(),
    release: z.object({ version: z.string() }).optional(),
    trace: z
      .object({
        traceId: z.string().optional(),
        spanId: z.string().optional(),
        parentSpanId: z.string().optional(),
      })
      .optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const eventListItemSchema = z.object({
  event: z.object({
    id: z.string(),
    type: eventTypeSchema,
    name: z.string(),
    version: z.number(),
    timestamp: z.number(),
    context: contextSchema,
    payload: z.record(z.string(), z.unknown()),
  }),
  processing: z.object({
    version: z.number(),
    envelopeSentAt: z.number(),
    processedAt: z.number(),
    errorFingerprint: z.string().optional(),
  }),
});

const eventListPageSchema = z.object({
  data: z.array(eventListItemSchema),
  nextCursor: z.string().optional(),
});

export type EventListItem = z.infer<typeof eventListItemSchema>;
export type EventListPage = z.infer<typeof eventListPageSchema>;

export const TIME_RANGES = {
  '15m': { label: 'Last 15 minutes', milliseconds: 15 * 60 * 1_000 },
  '30m': { label: 'Last 30 minutes', milliseconds: 30 * 60 * 1_000 },
  '1h': { label: 'Last hour', milliseconds: 60 * 60 * 1_000 },
  '6h': { label: 'Last 6 hours', milliseconds: 6 * 60 * 60 * 1_000 },
  '24h': { label: 'Last 24 hours', milliseconds: 24 * 60 * 60 * 1_000 },
  '7d': { label: 'Last 7 days', milliseconds: 7 * 24 * 60 * 60 * 1_000 },
} as const;

export type TimeRange = keyof typeof TIME_RANGES;
export type DataSource = 'illustrative' | 'live';

export interface ExplorerSearch {
  readonly project: string;
  readonly environment: string;
  readonly range: TimeRange;
  readonly source: DataSource;
  readonly type?: EventType | undefined;
  readonly name?: string | undefined;
  readonly release?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly pageId?: string | undefined;
  readonly event?: string | undefined;
}

function optionalBoundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

export function parseExplorerSearch(search: Record<string, unknown>): ExplorerSearch {
  const project =
    typeof search.project === 'string' && /^prj_[A-Za-z0-9_-]{1,120}$/.test(search.project)
      ? search.project
      : 'prj_checkout';
  const environment = optionalBoundedString(search.environment, 64) ?? 'production';
  const range =
    typeof search.range === 'string' && search.range in TIME_RANGES
      ? (search.range as TimeRange)
      : '30m';
  const typeResult = eventTypeSchema.safeParse(search.type);
  const name = optionalBoundedString(search.name, 64);
  const release = optionalBoundedString(search.release, 128);
  const sessionId = optionalBoundedString(search.sessionId, 128);
  const pageId = optionalBoundedString(search.pageId, 128);
  const event = optionalBoundedString(search.event, 64);

  return {
    project,
    environment,
    range,
    source: search.source === 'live' ? 'live' : 'illustrative',
    ...(typeResult.success ? { type: typeResult.data } : {}),
    ...(name !== undefined && isEventName(name) ? { name } : {}),
    ...(release === undefined ? {} : { release }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(pageId === undefined ? {} : { pageId }),
    ...(event === undefined ? {} : { event }),
  };
}

export interface EventQueryInput {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly type?: EventType;
  readonly name?: string;
  readonly release?: string;
  readonly sessionId?: string;
  readonly pageId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export function buildEventQueryUrl(input: EventQueryInput): string {
  const parameters = new URLSearchParams({
    environment: input.environment,
    from: String(input.from),
    to: String(input.to),
    limit: String(input.limit ?? 50),
  });

  for (const [key, value] of [
    ['type', input.type],
    ['name', input.name],
    ['release', input.release],
    ['sessionId', input.sessionId],
    ['pageId', input.pageId],
    ['cursor', input.cursor],
  ] as const) {
    if (value !== undefined) {
      parameters.set(key, value);
    }
  }

  return `/v1/projects/${encodeURIComponent(input.projectId)}/events?${parameters.toString()}`;
}

export class EventQueryError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'EventQueryError';
    this.status = status;
  }
}

export async function fetchEventPage(input: {
  readonly query: EventQueryInput;
  readonly token: string;
  readonly signal?: AbortSignal;
}): Promise<EventListPage> {
  const response = await fetch(buildEventQueryUrl(input.query), {
    headers: { authorization: `Bearer ${input.token}` },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (!response.ok) {
    let message = `Event query failed with status ${response.status}.`;
    const body: unknown = await response.json().catch(() => undefined);
    const errorBody = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    if (errorBody.success) {
      message = errorBody.data.error.message;
    }
    throw new EventQueryError(message, response.status);
  }

  return eventListPageSchema.parse(await response.json());
}

export function isEventType(value: string): value is EventType {
  return eventTypeSchema.safeParse(value).success;
}

export function isTimeRange(value: string): value is TimeRange {
  return value in TIME_RANGES;
}

export function isEventName(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value);
}
