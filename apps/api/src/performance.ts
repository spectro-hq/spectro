import { z } from 'zod';

const MAX_QUERY_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const integerInputSchema = z
  .union([z.number(), z.string().regex(/^\d+$/, 'must be an unsigned integer')])
  .transform(Number)
  .pipe(z.number().int().nonnegative().safe());

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

export const performanceListQuerySchema = z
  .object({
    environment: z.string().min(1).max(64),
    from: integerInputSchema,
    to: integerInputSchema,
    metric: performanceMetricSchema,
    pagePath: z.string().min(1).max(2_048),
    release: z.string().min(1).max(128),
    limit: integerInputSchema.pipe(z.number().min(1).max(100)).default(50),
    cursor: z.string().min(1).max(4_096),
  })
  .partial({ metric: true, pagePath: true, release: true, cursor: true })
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

const performanceCursorSchema = z
  .object({
    lastSeen: z.number().int().nonnegative().safe(),
    metric: performanceMetricSchema,
    pagePath: z.string().max(2_048),
  })
  .strict();

export type PerformanceMetric = z.infer<typeof performanceMetricSchema>;

export interface PerformanceCursor {
  readonly lastSeen: number;
  readonly metric: PerformanceMetric;
  readonly pagePath: string;
}

export interface PerformanceListQuery {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly metric?: PerformanceMetric;
  readonly pagePath?: string;
  readonly release?: string;
  readonly limit: number;
  readonly cursor?: PerformanceCursor;
}

export interface PerformanceGroup {
  readonly metric: PerformanceMetric;
  readonly unit: 'ms' | 'score';
  readonly pagePath?: string;
  readonly sampleCount: number;
  readonly affectedSessionCount: number;
  readonly average: number;
  readonly p75: number;
  readonly p95: number;
  readonly goodCount: number;
  readonly needsImprovementCount: number;
  readonly poorCount: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly latestEventId: string;
  readonly latestRelease?: string;
}

export interface PerformanceListPage {
  readonly data: readonly PerformanceGroup[];
  readonly nextCursor?: string;
}

export interface PerformanceQueryStore {
  list(query: PerformanceListQuery): Promise<PerformanceListPage>;
}

export class InvalidPerformanceCursorError extends Error {
  constructor() {
    super('Invalid performance query cursor');
    this.name = 'InvalidPerformanceCursorError';
  }
}

export function encodePerformanceCursor(cursor: PerformanceCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodePerformanceCursor(value: string): PerformanceCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const result = performanceCursorSchema.safeParse(decoded);
    if (!result.success) throw new InvalidPerformanceCursorError();
    return result.data;
  } catch (error) {
    if (error instanceof InvalidPerformanceCursorError) throw error;
    throw new InvalidPerformanceCursorError();
  }
}
