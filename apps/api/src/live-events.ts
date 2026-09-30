import { createHash } from 'node:crypto';
import { z } from 'zod';
import { eventListQuerySchema, type EventListItem } from './events.js';

export const LIVE_WINDOW_MS = 5 * 60_000;
export const LIVE_OVERLAP_MS = 60_000;
const integer = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().safe());
export const liveQuerySchema = z
  .object({
    environment: z.string().min(1).max(64),
    from: integer.optional(),
    to: integer.optional(),
    type: eventListQuerySchema.shape.type,
    name: eventListQuerySchema.shape.name,
    sessionId: eventListQuerySchema.shape.sessionId,
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export interface LiveQuery {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly type?: string;
  readonly name?: string;
  readonly sessionId?: string;
  readonly cursor?: { readonly processedAt: number; readonly eventId: string };
}
export interface LivePage {
  readonly data: readonly EventListItem[];
  readonly from: number;
  readonly to: number;
  readonly observedAt: number;
  readonly nextCursor?: string;
}
export interface LiveEventStore {
  list(query: LiveQuery): Promise<Omit<LivePage, 'observedAt'>>;
}
const cursorSchema = z
  .object({
    version: z.literal(1),
    scope: z.string().length(64),
    processedAt: integer,
    eventId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  })
  .strict();
function scope(query: LiveQuery): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        query.projectId,
        query.environment,
        query.from,
        query.to,
        query.type ?? null,
        query.name ?? null,
        query.sessionId ?? null,
      ]),
    )
    .digest('hex');
}
export function liveCursor(query: LiveQuery, item: EventListItem): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      scope: scope(query),
      processedAt: item.processing.processedAt,
      eventId: item.event.id,
    }),
  ).toString('base64url');
}
export function resolveLiveQuery(projectId: string, input: unknown, now: number): LiveQuery {
  const parsed = liveQuerySchema.parse(input);
  const from = parsed.from ?? Math.max(0, now - LIVE_OVERLAP_MS);
  const to = parsed.to ?? now;
  if (from > to || to - from > LIVE_WINDOW_MS || to > now + 5_000) {
    throw new Error('Invalid observation window');
  }
  const query: LiveQuery = {
    projectId,
    environment: parsed.environment,
    from,
    to,
    ...(parsed.type ? { type: parsed.type } : {}),
    ...(parsed.name ? { name: parsed.name } : {}),
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
  };
  if (!parsed.cursor) return query;
  if (parsed.from === undefined || parsed.to === undefined)
    throw new Error('Cursor needs a window');
  const cursor = cursorSchema.parse(
    JSON.parse(Buffer.from(parsed.cursor, 'base64url').toString('utf8')),
  );
  if (cursor.scope !== scope(query) || cursor.processedAt < from || cursor.processedAt > to) {
    throw new Error('Cursor scope mismatch');
  }
  return { ...query, cursor: { processedAt: cursor.processedAt, eventId: cursor.eventId } };
}
