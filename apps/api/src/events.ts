import type { EventType, SpectroEvent } from '@spectro/protocol';
import { z } from 'zod';

const MAX_QUERY_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9_-]{1,120}$/;

const integerInputSchema = z
  .union([z.number(), z.string().regex(/^\d+$/, 'must be an unsigned integer')])
  .transform(Number)
  .pipe(z.number().int().nonnegative().safe());

export const eventListPathSchema = z
  .object({
    projectId: z.string().regex(PROJECT_ID_PATTERN, 'must be a valid project ID'),
  })
  .strict();

export const eventListQuerySchema = z
  .object({
    environment: z.string().min(1).max(64),
    from: integerInputSchema,
    to: integerInputSchema,
    type: z.enum(['session', 'page', 'error', 'performance', 'network', 'interaction', 'custom']),
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    release: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    pageId: z.string().min(1).max(128),
    fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
    limit: integerInputSchema.pipe(z.number().min(1).max(100)).default(50),
    cursor: z.string().min(1).max(512),
  })
  .partial({
    type: true,
    name: true,
    release: true,
    sessionId: true,
    pageId: true,
    fingerprint: true,
    cursor: true,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from > value.to) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'must be less than or equal to to',
      });
    }

    if (value.to - value.from > MAX_QUERY_RANGE_MS) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'query range must not exceed 31 days',
      });
    }
  });

const cursorSchema = z
  .object({
    timestamp: z.number().int().nonnegative().safe(),
    eventId: z.string().regex(UUID_V7_PATTERN),
  })
  .strict();

export interface EventCursor {
  readonly timestamp: number;
  readonly eventId: string;
}

export interface EventListQuery {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly type?: EventType;
  readonly name?: string;
  readonly release?: string;
  readonly sessionId?: string;
  readonly pageId?: string;
  readonly fingerprint?: string;
  readonly limit: number;
  readonly cursor?: EventCursor;
}

export interface EventProcessingMetadata {
  readonly version: number;
  readonly envelopeSentAt: number;
  readonly processedAt: number;
  readonly errorFingerprint?: string;
}

export interface EventListItem {
  readonly event: SpectroEvent;
  readonly processing: EventProcessingMetadata;
}

export interface EventListPage {
  readonly data: readonly EventListItem[];
  readonly nextCursor?: string;
}

export interface EventQueryStore {
  list(query: EventListQuery): Promise<EventListPage>;
}

export interface ProjectAuthorizer {
  authorize(input: {
    readonly authorization?: string;
    readonly projectId: string;
  }): Promise<boolean>;
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid event query cursor');
    this.name = 'InvalidCursorError';
  }
}

export function encodeEventCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeEventCursor(value: string): EventCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const result = cursorSchema.safeParse(decoded);
    if (!result.success) {
      throw new InvalidCursorError();
    }
    return result.data;
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw error;
    }
    throw new InvalidCursorError();
  }
}
