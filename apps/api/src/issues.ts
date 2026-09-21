import { z } from 'zod';

const MAX_QUERY_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/;

const integerInputSchema = z
  .union([z.number(), z.string().regex(/^\d+$/, 'must be an unsigned integer')])
  .transform(Number)
  .pipe(z.number().int().nonnegative().safe());

export const issueListQuerySchema = z
  .object({
    environment: z.string().min(1).max(64),
    from: integerInputSchema,
    to: integerInputSchema,
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    release: z.string().min(1).max(128),
    status: z.enum(['open', 'resolved', 'ignored']),
    limit: integerInputSchema.pipe(z.number().min(1).max(100)).default(50),
    cursor: z.string().min(1).max(512),
  })
  .partial({ name: true, release: true, status: true, cursor: true })
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

export const errorFingerprintSchema = z.string().regex(FINGERPRINT_PATTERN);

const issueCursorSchema = z
  .object({ lastSeen: z.number().int().nonnegative().safe(), fingerprint: errorFingerprintSchema })
  .strict();

export interface IssueCursor {
  readonly lastSeen: number;
  readonly fingerprint: string;
}

export interface IssueListQuery {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly name?: string;
  readonly release?: string;
  readonly limit: number;
  readonly cursor?: IssueCursor;
}

export interface ErrorIssueSummary {
  readonly fingerprint: string;
  readonly name?: string;
  readonly message: string;
  readonly occurrenceCount: number;
  readonly affectedSessionCount: number;
  readonly affectedUserCount: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly latestEventId: string;
  readonly latestPagePath?: string;
  readonly latestRelease?: string;
  readonly status?: 'open' | 'resolved' | 'ignored';
  readonly statusUpdatedAt?: string;
}

export interface IssueListPage {
  readonly data: readonly ErrorIssueSummary[];
  readonly nextCursor?: string;
}

export interface IssueQueryStore {
  list(query: IssueListQuery): Promise<IssueListPage>;
}

export class InvalidIssueCursorError extends Error {
  constructor() {
    super('Invalid issue query cursor');
    this.name = 'InvalidIssueCursorError';
  }
}

export function encodeIssueCursor(cursor: IssueCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeIssueCursor(value: string): IssueCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const result = issueCursorSchema.safeParse(decoded);
    if (!result.success) throw new InvalidIssueCursorError();
    return result.data;
  } catch (error) {
    if (error instanceof InvalidIssueCursorError) throw error;
    throw new InvalidIssueCursorError();
  }
}
