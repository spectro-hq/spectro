import { createHash, randomBytes } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { organizationRoleAllows, type OrganizationRole } from './organization-permissions.js';
import {
  ProjectWriteKeyAccessDeniedError,
  ProjectWriteKeyNotFoundError,
  type CreatedProjectWriteKey,
  type ProjectWriteKeyStore,
  type ProjectWriteKeySummary,
} from './project-write-keys.js';

interface ProjectScopeInput {
  readonly userId: string;
  readonly projectId: string;
  readonly environment: string;
}

interface KeyRow {
  readonly id: string;
  readonly environment: string;
  readonly label: string;
  readonly key_hint: string;
  readonly allowed_origins: readonly string[];
  readonly created_at: Date;
  readonly revoked_at: Date | null;
}

function summarize(row: KeyRow): ProjectWriteKeySummary {
  return {
    id: row.id,
    environment: row.environment,
    label: row.label,
    keyHint: row.key_hint,
    allowedOrigins: row.allowed_origins,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

async function requireProjectAdmin(sql: TransactionSql, input: ProjectScopeInput): Promise<void> {
  const [membership] = await sql<{ readonly role: OrganizationRole }[]>`
    SELECT membership.role
    FROM project_environments AS environment
    JOIN projects AS project ON project.id = environment.project_id
    JOIN organization_memberships AS membership
      ON membership.organization_id = project.organization_id
    JOIN console_users AS person ON person.id = membership.user_id
    WHERE project.id = ${input.projectId}
      AND environment.name = ${input.environment}
      AND person.id = ${input.userId}
      AND person.disabled_at IS NULL
    FOR SHARE OF membership, person
  `;
  if (membership === undefined || !organizationRoleAllows(membership.role, 'project:manage')) {
    throw new ProjectWriteKeyAccessDeniedError();
  }
}

export class PostgresProjectWriteKeyStore implements ProjectWriteKeyStore {
  readonly #sql: Sql;

  // The API server owns the shared control-plane pool.
  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async list(input: ProjectScopeInput): Promise<readonly ProjectWriteKeySummary[]> {
    return this.#sql.begin(async (sql) => {
      await requireProjectAdmin(sql, input);
      const rows = await sql<KeyRow[]>`
        SELECT id, environment, label, key_hint, allowed_origins, created_at, revoked_at
        FROM project_write_keys
        WHERE project_id = ${input.projectId} AND environment = ${input.environment}
        ORDER BY created_at DESC, id
      `;
      return rows.map(summarize);
    });
  }

  async create(
    input: ProjectScopeInput & {
      readonly label: string;
      readonly allowedOrigins: readonly string[];
    },
  ): Promise<CreatedProjectWriteKey> {
    const id = `key_${randomBytes(16).toString('base64url')}`;
    const key = `spk_${randomBytes(32).toString('base64url')}`;
    const verifier = createHash('sha256').update(key, 'utf8').digest();
    const keyHint = `${key.slice(0, 12)}…${key.slice(-4)}`;
    return this.#sql.begin(async (sql) => {
      await requireProjectAdmin(sql, input);
      const [project] = await sql<{ readonly organization_id: string }[]>`
        SELECT organization_id FROM projects WHERE id = ${input.projectId}
      `;
      if (project === undefined) throw new ProjectWriteKeyAccessDeniedError();
      const [row] = await sql<KeyRow[]>`
        INSERT INTO project_write_keys (
          id, project_id, environment, label, verifier, key_hint,
          allowed_origins, created_by
        ) VALUES (
          ${id}, ${input.projectId}, ${input.environment}, ${input.label}, ${verifier},
          ${keyHint}, ${sql.json(input.allowedOrigins)}, ${input.userId}
        )
        RETURNING id, environment, label, key_hint, allowed_origins, created_at, revoked_at
      `;
      if (row === undefined) throw new Error('Write key was not created');
      await sql`
        INSERT INTO workspace_audit_log (organization_id, actor_id, action, resource_id)
        VALUES (${project.organization_id}, ${input.userId}, 'api_key.created', ${id})
      `;
      return { key, metadata: summarize(row) };
    });
  }

  async revoke(input: ProjectScopeInput & { readonly keyId: string }): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await requireProjectAdmin(sql, input);
      const [project] = await sql<{ readonly organization_id: string }[]>`
        SELECT organization_id FROM projects WHERE id = ${input.projectId}
      `;
      if (project === undefined) throw new ProjectWriteKeyAccessDeniedError();
      const [key] = await sql<{ readonly id: string }[]>`
        UPDATE project_write_keys
        SET revoked_at = now()
        WHERE id = ${input.keyId}
          AND project_id = ${input.projectId}
          AND environment = ${input.environment}
          AND revoked_at IS NULL
        RETURNING id
      `;
      if (key === undefined) {
        const [existing] = await sql<{ readonly id: string }[]>`
          SELECT id FROM project_write_keys
          WHERE id = ${input.keyId}
            AND project_id = ${input.projectId}
            AND environment = ${input.environment}
        `;
        if (existing === undefined) throw new ProjectWriteKeyNotFoundError();
        return;
      }
      await sql`
        INSERT INTO workspace_audit_log (organization_id, actor_id, action, resource_id)
        VALUES (${project.organization_id}, ${input.userId}, 'api_key.revoked', ${input.keyId})
      `;
    });
  }
}
