import { z } from 'zod';

export const issueStatusSchema = z.enum(['open', 'resolved', 'ignored']);
export type IssueStatus = z.infer<typeof issueStatusSchema>;

export const issueLifecyclePathSchema = z.object({
  projectId: z.string().regex(/^prj_[A-Za-z0-9_-]{1,120}$/),
  fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
});

export const issueLifecycleBodySchema = z.object({
  environment: z.string().min(1).max(64),
  status: issueStatusSchema,
});

export const issueLifecycleHistoryQuerySchema = z.object({
  environment: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface IssueLifecycleRecord {
  readonly fingerprint: string;
  readonly status: IssueStatus;
  readonly updatedAt: string;
}

export interface IssueLifecycleHistoryRecord {
  readonly id: string;
  readonly fingerprint: string;
  readonly previousStatus?: IssueStatus;
  readonly status: IssueStatus;
  readonly actorId?: string;
  readonly changedAt: string;
}

export interface IssueLifecycleStore {
  getMany(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly fingerprints: readonly string[];
  }): Promise<ReadonlyMap<string, IssueLifecycleRecord>>;
  set(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly fingerprint: string;
    readonly status: IssueStatus;
    readonly actorId?: string;
  }): Promise<IssueLifecycleRecord>;
  history(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly fingerprint: string;
    readonly limit: number;
  }): Promise<readonly IssueLifecycleHistoryRecord[]>;
}
