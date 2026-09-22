import { z } from 'zod';

const MAX_QUERY_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const integerInputSchema = z
  .union([z.number(), z.string().regex(/^\d+$/, 'must be an unsigned integer')])
  .transform(Number)
  .pipe(z.number().int().nonnegative().safe());

export const releaseListQuerySchema = z
  .object({
    environment: z.string().min(1).max(64),
    from: integerInputSchema,
    to: integerInputSchema,
    limit: integerInputSchema.pipe(z.number().min(1).max(50)).default(20),
    cursor: z.string().min(1).max(4_096),
  })
  .partial({ cursor: true })
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

const releaseCursorSchema = z
  .object({ lastSeen: z.number().int().nonnegative().safe(), release: z.string().min(1).max(128) })
  .strict();

export interface ReleaseCursor {
  readonly lastSeen: number;
  readonly release: string;
}

export interface ReleaseListQuery {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly limit: number;
  readonly cursor?: ReleaseCursor;
}

export interface ReleaseHealth {
  readonly release: string;
  readonly eventCount: number;
  readonly errorCount: number;
  readonly affectedSessionCount: number;
  readonly poorPerformanceCount: number;
  readonly networkFailureCount: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly latestEventId: string;
}

export interface ReleaseListPage {
  readonly data: readonly ReleaseHealth[];
  readonly nextCursor?: string;
}

export interface ReleaseQueryStore {
  list(query: ReleaseListQuery): Promise<ReleaseListPage>;
}

export class InvalidReleaseCursorError extends Error {
  constructor() {
    super('Invalid release query cursor');
    this.name = 'InvalidReleaseCursorError';
  }
}

export function encodeReleaseCursor(cursor: ReleaseCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeReleaseCursor(value: string): ReleaseCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const result = releaseCursorSchema.safeParse(decoded);
    if (!result.success) throw new InvalidReleaseCursorError();
    return result.data;
  } catch (error) {
    if (error instanceof InvalidReleaseCursorError) throw error;
    throw new InvalidReleaseCursorError();
  }
}
