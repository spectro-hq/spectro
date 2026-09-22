import { z } from 'zod';

const MAX_QUERY_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const integerInputSchema = z
  .union([z.number(), z.string().regex(/^\d+$/, 'must be an unsigned integer')])
  .transform(Number)
  .pipe(z.number().int().nonnegative().safe());

export const networkInitiatorSchema = z.enum(['fetch', 'xhr', 'resource']);
const methodSchema = z.string().regex(/^[A-Z]{1,16}$/, 'must be an uppercase HTTP method');
const booleanInputSchema = z
  .union([z.boolean(), z.literal('true'), z.literal('false')])
  .transform((value) => value === true || value === 'true');

export const networkListQuerySchema = z
  .object({
    environment: z.string().min(1).max(64),
    from: integerInputSchema,
    to: integerInputSchema,
    initiator: networkInitiatorSchema,
    method: methodSchema,
    success: booleanInputSchema,
    pagePath: z.string().min(1).max(2_048),
    release: z.string().min(1).max(128),
    limit: integerInputSchema.pipe(z.number().min(1).max(100)).default(50),
    cursor: z.string().min(1).max(8_192),
  })
  .partial({
    initiator: true,
    method: true,
    success: true,
    pagePath: true,
    release: true,
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

const networkCursorSchema = z
  .object({
    lastSeen: z.number().int().nonnegative().safe(),
    initiator: networkInitiatorSchema,
    method: methodSchema,
    url: z.string().max(2_048),
    pagePath: z.string().max(2_048),
  })
  .strict();

export type NetworkInitiator = z.infer<typeof networkInitiatorSchema>;

export interface NetworkCursor {
  readonly lastSeen: number;
  readonly initiator: NetworkInitiator;
  readonly method: string;
  readonly url: string;
  readonly pagePath: string;
}

export interface NetworkListQuery {
  readonly projectId: string;
  readonly environment: string;
  readonly from: number;
  readonly to: number;
  readonly initiator?: NetworkInitiator;
  readonly method?: string;
  readonly success?: boolean;
  readonly pagePath?: string;
  readonly release?: string;
  readonly limit: number;
  readonly cursor?: NetworkCursor;
}

export interface NetworkGroup {
  readonly initiator: NetworkInitiator;
  readonly method: string;
  readonly url: string;
  readonly pagePath?: string;
  readonly requestCount: number;
  readonly failureCount: number;
  readonly affectedSessionCount: number;
  readonly averageDuration: number;
  readonly p75Duration: number;
  readonly p95Duration: number;
  readonly status2xxCount: number;
  readonly status3xxCount: number;
  readonly status4xxCount: number;
  readonly status5xxCount: number;
  readonly transportFailureCount: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly latestEventId: string;
  readonly latestStatus?: number;
  readonly latestRelease?: string;
}

export interface NetworkListPage {
  readonly data: readonly NetworkGroup[];
  readonly nextCursor?: string;
}

export interface NetworkQueryStore {
  list(query: NetworkListQuery): Promise<NetworkListPage>;
}

export class InvalidNetworkCursorError extends Error {
  constructor() {
    super('Invalid network query cursor');
    this.name = 'InvalidNetworkCursorError';
  }
}

export function encodeNetworkCursor(cursor: NetworkCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeNetworkCursor(value: string): NetworkCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const result = networkCursorSchema.safeParse(decoded);
    if (!result.success) throw new InvalidNetworkCursorError();
    return result.data;
  } catch (error) {
    if (error instanceof InvalidNetworkCursorError) throw error;
    throw new InvalidNetworkCursorError();
  }
}
