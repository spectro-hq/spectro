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

export interface IssueLifecycleRecord {
  readonly fingerprint: string;
  readonly status: IssueStatus;
  readonly updatedAt: string;
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
  }): Promise<IssueLifecycleRecord>;
}
