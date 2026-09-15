import postgres, { type Sql } from 'postgres';

import type { IssueLifecycleRecord, IssueLifecycleStore } from './issue-lifecycle.js';

interface LifecycleRow {
  readonly fingerprint: string;
  readonly status: 'open' | 'resolved' | 'ignored';
  readonly updated_at: Date;
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
  }): Promise<IssueLifecycleRecord> {
    const [row] = await this.#sql<LifecycleRow[]>`
      INSERT INTO issue_lifecycle (project_id, environment, fingerprint, status)
      VALUES (${input.projectId}, ${input.environment}, ${input.fingerprint}, ${input.status})
      ON CONFLICT (project_id, environment, fingerprint)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      RETURNING fingerprint, status, updated_at
    `;
    if (row === undefined) throw new Error('Issue lifecycle upsert returned no row');
    return {
      fingerprint: row.fingerprint,
      status: row.status,
      updatedAt: row.updated_at.toISOString(),
    };
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
