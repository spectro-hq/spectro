import postgres, { type Sql } from 'postgres';

import type {
  IssueLifecycleHistoryRecord,
  IssueLifecycleRecord,
  IssueLifecycleStore,
} from './issue-lifecycle.js';

interface LifecycleRow {
  readonly fingerprint: string;
  readonly status: 'open' | 'resolved' | 'ignored';
  readonly updated_at: Date;
}

interface HistoryRow {
  readonly id: string;
  readonly fingerprint: string;
  readonly previous_status: 'open' | 'resolved' | 'ignored' | null;
  readonly status: 'open' | 'resolved' | 'ignored';
  readonly actor_id: string | null;
  readonly changed_at: Date;
}

export class PostgresIssueLifecycleStore implements IssueLifecycleStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async close(): Promise<void> {
    await this.#sql.end();
  }

  async getMany(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly fingerprints: readonly string[];
  }): Promise<ReadonlyMap<string, IssueLifecycleRecord>> {
    if (input.fingerprints.length === 0) return new Map();
    const rows = await this.#sql<LifecycleRow[]>`
      SELECT fingerprint, status, updated_at
      FROM issue_lifecycle
      WHERE project_id = ${input.projectId}
        AND environment = ${input.environment}
        AND fingerprint IN ${this.#sql(input.fingerprints)}
    `;
    return new Map(
      rows.map((row) => [
        row.fingerprint,
        {
          fingerprint: row.fingerprint,
          status: row.status,
          updatedAt: row.updated_at.toISOString(),
        },
      ]),
    );
  }

  async set(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly fingerprint: string;
    readonly status: 'open' | 'resolved' | 'ignored';
    readonly actorId?: string;
  }): Promise<IssueLifecycleRecord> {
    const row = await this.#sql.begin(async (transaction) => {
      const [previous] = await transaction<Pick<LifecycleRow, 'status' | 'updated_at'>[]>`
        SELECT status, updated_at FROM issue_lifecycle
        WHERE project_id = ${input.projectId}
          AND environment = ${input.environment}
          AND fingerprint = ${input.fingerprint}
        FOR UPDATE
      `;
      if (previous?.status === input.status) {
        return {
          fingerprint: input.fingerprint,
          status: previous.status,
          updated_at: previous.updated_at,
        };
      }
      const [updated] = await transaction<LifecycleRow[]>`
        INSERT INTO issue_lifecycle (project_id, environment, fingerprint, status)
        VALUES (${input.projectId}, ${input.environment}, ${input.fingerprint}, ${input.status})
        ON CONFLICT (project_id, environment, fingerprint)
        DO UPDATE SET status = EXCLUDED.status, updated_at = now()
        RETURNING fingerprint, status, updated_at
      `;
      await transaction`
        INSERT INTO issue_lifecycle_history (
          project_id, environment, fingerprint, previous_status, status, actor_id
        ) VALUES (
          ${input.projectId}, ${input.environment}, ${input.fingerprint},
          ${previous?.status ?? null}, ${input.status}, ${input.actorId ?? null}
        )
      `;
      return updated;
    });
    if (row === undefined) throw new Error('Issue lifecycle upsert returned no row');
    return {
      fingerprint: row.fingerprint,
      status: row.status,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async history(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly fingerprint: string;
    readonly limit: number;
  }): Promise<readonly IssueLifecycleHistoryRecord[]> {
    const rows = await this.#sql<HistoryRow[]>`
      SELECT id::text, fingerprint, previous_status, status, actor_id, changed_at
      FROM issue_lifecycle_history
      WHERE project_id = ${input.projectId}
        AND environment = ${input.environment}
        AND fingerprint = ${input.fingerprint}
      ORDER BY changed_at DESC, id DESC
      LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      ...(row.previous_status === null ? {} : { previousStatus: row.previous_status }),
      status: row.status,
      ...(row.actor_id === null ? {} : { actorId: row.actor_id }),
      changedAt: row.changed_at.toISOString(),
    }));
  }
}

export function createPostgresIssueLifecycleStore(
  environment: NodeJS.ProcessEnv,
): PostgresIssueLifecycleStore {
  const sql = postgres(
    environment.SPECTRO_POSTGRES_URL ?? 'postgres://spectro:spectro_local@127.0.0.1:5432/spectro',
    {
      max: 10,
    },
  );
  return new PostgresIssueLifecycleStore(sql);
}
