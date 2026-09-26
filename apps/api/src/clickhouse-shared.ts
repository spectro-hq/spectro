import { z } from 'zod';

export const CLICKHOUSE_EVENTS_TABLE = 'spectro.events_v1';

export interface ClickHouseJsonEachRowClient {
  query(request: {
    readonly query: string;
    readonly query_params: Record<string, unknown>;
    readonly format: 'JSONEachRow';
  }): Promise<{ json(): Promise<unknown> }>;
}

export const nonNegativeSafeIntegerSchema = z
  .union([z.string(), z.number()])
  .transform((value, context) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      context.addIssue({ code: 'custom', message: 'must be a safe unsigned integer' });
      return z.NEVER;
    }
    return parsed;
  });

export const nonNegativeFiniteNumberSchema = z
  .union([z.string(), z.number()])
  .transform((value, context) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      context.addIssue({ code: 'custom', message: 'must be a non-negative finite number' });
      return z.NEVER;
    }
    return parsed;
  });
